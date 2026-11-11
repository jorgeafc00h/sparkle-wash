// OllamaSettingsCard — config inputs for the local Ollama OCR provider.
//
// Lives inside the OcrProviderSettingsCard tabbed wrapper. Reads + writes
// only the `ollama` block of the OcrSettings bundle. Includes a "Probar
// conexión" button that pings Ollama's `/api/tags` endpoint so the user
// gets immediate feedback on whether the daemon is running and the
// configured model is pulled.

import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Cpu } from 'lucide-react';
import { Input } from '@/components/common/Input';
import { Button } from '@/components/common/Button';
import { useToast } from '@/components/common/Toast';
import {
  OcrSettingsService,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  type OllamaConfig,
} from '@/services/ocr/OcrSettingsService';

const SUGGESTED_MODELS = [
  {
    id: 'llama3.2-vision:11b',
    label: 'Llama 3.2 Vision 11B (recomendado)',
    note: 'Mejor calidad de extracción para facturas y tickets. Requiere ~8 GB de RAM/VRAM.',
  },
  {
    id: 'llama3.2-vision:90b',
    label: 'Llama 3.2 Vision 90B',
    note: 'Calidad superior pero requiere GPU dedicada con ≥48 GB VRAM.',
  },
  {
    id: 'llava:13b',
    label: 'LLaVA 13B',
    note: 'Alternativa más liviana. Calidad inferior con texto denso.',
  },
  {
    id: 'bakllava:latest',
    label: 'BakLLaVA',
    note: 'Variante basada en Mistral 7B + visión. Rápida en CPU.',
  },
];

export function OllamaSettingsCard() {
  const toast = useToast();
  const [baseUrl, setBaseUrl] = useState(DEFAULT_OLLAMA_BASE_URL);
  const [model, setModel] = useState(DEFAULT_OLLAMA_MODEL);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  // What is saved, to tell the user when the form (and a successful "Probar
  // conexión") has NOT been saved yet.
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  // Same normalisation `save()` applies, so a trailing "/" is not a change.
  const snapshotOf = (url: string, m: string) => JSON.stringify([url.trim().replace(/\/+$/, ''), m.trim()]);
  const hasUnsavedChanges = savedSnapshot !== null && snapshotOf(baseUrl, model) !== savedSnapshot;

  useEffect(() => {
    let cancelled = false;
    OcrSettingsService.getSettings().then((s) => {
      if (cancelled) return;
      setBaseUrl(s.ollama.baseUrl || DEFAULT_OLLAMA_BASE_URL);
      setModel(s.ollama.model || DEFAULT_OLLAMA_MODEL);
      setSavedSnapshot(
        snapshotOf(s.ollama.baseUrl || DEFAULT_OLLAMA_BASE_URL, s.ollama.model || DEFAULT_OLLAMA_MODEL),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (!baseUrl.trim() || !model.trim()) {
      toast.error('Base URL y modelo son requeridos.');
      return;
    }
    const config: OllamaConfig = {
      baseUrl: baseUrl.trim().replace(/\/+$/, ''),
      model: model.trim(),
    };
    setSaving(true);
    try {
      await OcrSettingsService.setOllama(config);
      setSavedSnapshot(snapshotOf(config.baseUrl, config.model));
      toast.success('Configuración de Ollama guardada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  // Smoke test: send a tiny text-only chat completion. Uses the same
  // OpenAI-compat endpoint the real flow will use, so a passing test here
  // means OCR will at least reach the model. Doesn't validate vision
  // capability or that the image side of the model is loaded — the user
  // gets that feedback the first time they import an image.
  async function testConnection() {
    if (!baseUrl.trim() || !model.trim()) {
      toast.error('Completa base URL y modelo antes de probar.');
      return;
    }
    setTesting(true);
    try {
      const config: OllamaConfig = { baseUrl: baseUrl.trim(), model: model.trim() };
      const url = OcrSettingsService.buildOllamaChatUrl(config);
      const api = window.electronAPI;
      if (!api?.ollamaFetch) {
        toast.error('Esta función solo está disponible en la app de escritorio.');
        return;
      }
      const result = await api.ollamaFetch({
        url,
        body: {
          model: config.model,
          messages: [{ role: 'user', content: 'Responde "ok".' }],
          max_tokens: 5,
          temperature: 0,
        },
      });
      if (result.ok) {
        toast.success(
          hasUnsavedChanges
            ? 'Conexión exitosa con Ollama. Aún no se ha guardado: pulsa Guardar para conservarla.'
            : 'Conexión exitosa con Ollama.',
        );
      } else {
        let detail = result.error || `HTTP ${result.status}`;
        if (result.body) {
          try {
            const parsed = JSON.parse(result.body);
            detail =
              typeof parsed?.error === 'string'
                ? parsed.error
                : parsed?.error?.message ?? detail;
          } catch {
            // keep detail
          }
        }
        if (result.status === 0 || /connect|refused|enotfound/i.test(detail)) {
          detail = `${detail} — ¿Está Ollama corriendo? (ollama serve)`;
        }
        toast.error(`Falló la prueba: ${detail}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error en la prueba');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="ollama-settings">
      <div className="rounded-md bg-violet-50 border border-violet-200 p-3 text-xs text-violet-900 space-y-1">
        <p className="font-medium flex items-center gap-1">
          <Cpu size={12} /> Modo local con Ollama
        </p>
        <p>
          Ollama corre los modelos de visión 100% en tu máquina — sin enviar
          imágenes a la nube. Ideal para empresas con datos sensibles o sin
          conexión confiable.
        </p>
        <ol className="list-decimal list-inside space-y-0.5 mt-1">
          <li>
            Instala Ollama desde{' '}
            <a
              href="https://ollama.com/download"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-violet-700 hover:text-violet-900 underline inline-flex items-center gap-1"
            >
              ollama.com <ExternalLink size={11} />
            </a>
            .
          </li>
          <li>
            Descarga el modelo de visión:{' '}
            <code className="font-mono bg-violet-100 px-1 rounded">
              ollama pull llama3.2-vision:11b
            </code>
          </li>
          <li>
            Verifica que el daemon corre:{' '}
            <code className="font-mono bg-violet-100 px-1 rounded">ollama serve</code>{' '}
            (suele iniciarse automáticamente).
          </li>
        </ol>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label="Base URL"
          placeholder={DEFAULT_OLLAMA_BASE_URL}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          data-testid="ollama-base-url"
        />
        <div>
          <label className="block text-xs font-medium text-brand-700 mb-1">
            Modelo
          </label>
          <input
            type="text"
            list="ollama-models"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={DEFAULT_OLLAMA_MODEL}
            className="w-full rounded-lg border border-brand-300 px-3 py-2 text-sm text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
            data-testid="ollama-model"
          />
          <datalist id="ollama-models">
            {SUGGESTED_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </datalist>
        </div>
      </div>

      <div className="rounded-md border border-brand-100 bg-white p-3 text-xs space-y-1.5">
        <p className="font-medium text-brand-700">Modelos sugeridos</p>
        {SUGGESTED_MODELS.map((m) => (
          <div key={m.id} className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => setModel(m.id)}
              className="font-mono text-accent-700 hover:text-accent-900 underline shrink-0"
            >
              {m.id}
            </button>
            <span className="text-brand-500">— {m.note}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          variant="primary"
          loading={saving}
          onClick={save}
          icon={<CheckCircle2 size={16} />}
          data-testid="ollama-save"
        >
          Guardar
        </Button>
        <Button
          variant="secondary"
          loading={testing}
          onClick={testConnection}
          disabled={!baseUrl || !model}
        >
          Probar conexión
        </Button>
        {hasUnsavedChanges && (
          <span className="self-center text-xs font-medium text-amber-700" data-testid="ollama-unsaved">
            Cambios sin guardar
          </span>
        )}
      </div>
    </div>
  );
}

export default OllamaSettingsCard;
