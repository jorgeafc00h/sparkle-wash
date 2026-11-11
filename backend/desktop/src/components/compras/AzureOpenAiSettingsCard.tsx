// AzureOpenAiSettingsCard — config inputs for Azure OpenAI Vision (GPT-4o).
//
// Lives inside the OcrProviderSettingsCard tabbed wrapper. Reads + writes
// only the `azure` block of the OcrSettings bundle so the Ollama config
// isn't disturbed when the user saves here.

import { useEffect, useState } from 'react';
import { Eye, EyeOff, ExternalLink, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/common/Input';
import { Button } from '@/components/common/Button';
import { useToast } from '@/components/common/Toast';
import {
  OcrSettingsService,
  DEFAULT_API_VERSION,
  type AzureConfig,
} from '@/services/ocr/OcrSettingsService';

const DEFAULT_AZURE_DEPLOYMENT = 'gpt-4o-vision';

// Recommended Azure OpenAI vision-capable models. The user picks one of
// these when they create the deployment in Azure AI Foundry; the actual
// `deployment` field below is the user-chosen name (often matches the
// model id, but doesn't have to).
const SUGGESTED_AZURE_MODELS = [
  {
    id: 'gpt-4o-2024-11-20',
    label: 'gpt-4o · 2024-11-20 (recomendado)',
    note: 'Última versión estable. Mejor calidad de extracción, soporta json_schema strict.',
  },
  {
    id: 'gpt-4o-2024-08-06',
    label: 'gpt-4o · 2024-08-06',
    note: 'Versión anterior, también soporta json_schema strict. Costo idéntico.',
  },
  {
    id: 'gpt-4o-mini-2024-07-18',
    label: 'gpt-4o-mini · 2024-07-18',
    note: 'Costo ~95 % menor que gpt-4o. Calidad menor con texto denso o tickets borrosos.',
  },
];

const SUGGESTED_DEPLOYMENT_NAMES = ['gpt-4o-vision', 'gpt-4o', 'gpt-4o-mini'];

export function AzureOpenAiSettingsCard() {
  const toast = useToast();
  const [endpoint, setEndpoint] = useState('');
  const [deployment, setDeployment] = useState(DEFAULT_AZURE_DEPLOYMENT);
  const [apiKey, setApiKey] = useState('');
  const [apiVersion, setApiVersion] = useState(DEFAULT_API_VERSION);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  // What is in the keychain, to tell the user when the form (and a successful
  // "Probar conexión") has NOT been saved yet.
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const snapshotOf = (c: { endpoint: string; deployment: string; apiKey: string; apiVersion: string }) =>
    JSON.stringify([c.endpoint.trim(), c.deployment.trim(), c.apiKey.trim(), c.apiVersion.trim()]);
  const hasUnsavedChanges =
    savedSnapshot !== null && snapshotOf({ endpoint, deployment, apiKey, apiVersion }) !== savedSnapshot;

  // Hydrate from keychain on mount. If the user hasn't saved a deployment
  // name yet, leave the suggested default in place so they have a reasonable
  // starting point (matches what the inline guide tells them to use).
  useEffect(() => {
    let cancelled = false;
    OcrSettingsService.getSettings().then((s) => {
      if (cancelled) return;
      setEndpoint(s.azure.endpoint);
      setDeployment(s.azure.deployment || DEFAULT_AZURE_DEPLOYMENT);
      setApiKey(s.azure.apiKey);
      setApiVersion(s.azure.apiVersion || DEFAULT_API_VERSION);
      setSavedSnapshot(
        snapshotOf({
          endpoint: s.azure.endpoint,
          deployment: s.azure.deployment || DEFAULT_AZURE_DEPLOYMENT,
          apiKey: s.azure.apiKey,
          apiVersion: s.azure.apiVersion || DEFAULT_API_VERSION,
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (!endpoint.trim() || !apiKey.trim()) {
      toast.error('Endpoint y API key son requeridos.');
      return;
    }
    const config: AzureConfig = {
      endpoint: endpoint.trim(),
      deployment: deployment.trim(),
      apiKey: apiKey.trim(),
      apiVersion: apiVersion.trim() || DEFAULT_API_VERSION,
    };
    setSaving(true);
    try {
      await OcrSettingsService.setAzure(config);
      setSavedSnapshot(snapshotOf(config));
      toast.success('Configuración de Azure OpenAI guardada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  // Quick health check — sends a single-token chat-completions probe so the
  // user knows immediately if endpoint+key+deployment line up. Doesn't burn
  // a vision token; uses a plain text message.
  async function testConnection() {
    if (!endpoint.trim() || !apiKey.trim()) {
      toast.error('Completa endpoint y API key antes de probar.');
      return;
    }
    setTesting(true);
    try {
      const config: AzureConfig = {
        endpoint: endpoint.trim(),
        deployment: deployment.trim(),
        apiKey: apiKey.trim(),
        apiVersion: apiVersion.trim() || DEFAULT_API_VERSION,
      };
      const url = OcrSettingsService.buildChatUrl(config);
      const api = window.electronAPI;
      if (!api?.azureOpenAiFetch) {
        toast.error('Esta función solo está disponible en la app de escritorio.');
        return;
      }
      const result = await api.azureOpenAiFetch({
        url,
        apiKey: config.apiKey,
        body: {
          messages: [{ role: 'user', content: 'Responde "ok".' }],
          max_tokens: 5,
          temperature: 0,
        },
      });
      if (result.ok) {
        toast.success(
          hasUnsavedChanges
            ? 'Conexión exitosa con Azure OpenAI. Aún no se ha guardado: pulsa Guardar para conservarla.'
            : 'Conexión exitosa con Azure OpenAI.',
        );
      } else {
        let detail = result.error || `HTTP ${result.status}`;
        if (result.body) {
          try {
            const parsed = JSON.parse(result.body);
            detail = parsed?.error?.message ?? detail;
          } catch {
            // keep detail
          }
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
    <div className="space-y-4" data-testid="azure-openai-settings">
      <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 space-y-1">
        <p className="font-medium">¿Cómo obtener estos valores?</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>
            Crea un recurso de Azure OpenAI en{' '}
            <a
              href="https://ai.azure.com"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-blue-700 hover:text-blue-900 underline inline-flex items-center gap-1"
            >
              Azure AI Foundry <ExternalLink size={11} />
            </a>
            .
          </li>
          <li>
            Despliega el modelo <span className="font-mono">gpt-4o</span> versión{' '}
            <span className="font-mono">2024-11-20</span> (o más reciente).
          </li>
          <li>
            Copia el <strong>endpoint</strong>, el <strong>nombre del deployment</strong>, y la{' '}
            <strong>API key</strong> del recurso.
          </li>
        </ol>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label="Endpoint"
          placeholder="https://tu-recurso.openai.azure.com"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          data-testid="azure-openai-endpoint"
        />
        <div>
          <label className="block text-xs font-medium text-brand-700 mb-1">
            Nombre del deployment
          </label>
          <input
            type="text"
            list="azure-deployment-suggestions"
            placeholder={DEFAULT_AZURE_DEPLOYMENT}
            value={deployment}
            onChange={(e) => setDeployment(e.target.value)}
            className="w-full rounded-lg border border-brand-300 px-3 py-2 text-sm text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
            data-testid="azure-openai-deployment"
          />
          <datalist id="azure-deployment-suggestions">
            {SUGGESTED_DEPLOYMENT_NAMES.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div className="sm:col-span-2 relative">
          <Input
            label="API key"
            type={showKey ? 'text' : 'password'}
            placeholder="••••••••••••••••"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            data-testid="azure-openai-key"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-2 top-8 p-1 text-brand-400 hover:text-brand-700"
            aria-label={showKey ? 'Ocultar API key' : 'Mostrar API key'}
            tabIndex={-1}
          >
            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <Input
          label="API version"
          placeholder={DEFAULT_API_VERSION}
          value={apiVersion}
          onChange={(e) => setApiVersion(e.target.value)}
          data-testid="azure-openai-version"
        />
      </div>

      <div className="rounded-md border border-brand-100 bg-white p-3 text-xs space-y-1.5">
        <p className="font-medium text-brand-700">Modelos recomendados</p>
        <p className="text-brand-500">
          Despliega uno de estos modelos en Azure AI Foundry; el campo de arriba
          es el <em>nombre</em> que le diste al deployment (no el id del modelo).
        </p>
        {SUGGESTED_AZURE_MODELS.map((m) => (
          <div key={m.id} className="flex items-start gap-2">
            <span className="font-mono text-accent-700 shrink-0">{m.id}</span>
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
          data-testid="azure-openai-save"
        >
          Guardar
        </Button>
        <Button
          variant="secondary"
          loading={testing}
          onClick={testConnection}
          disabled={!endpoint || !apiKey}
        >
          Probar conexión
        </Button>
        {hasUnsavedChanges && (
          <span className="self-center text-xs font-medium text-amber-700" data-testid="azure-openai-unsaved">
            Cambios sin guardar
          </span>
        )}
      </div>
    </div>
  );
}

export default AzureOpenAiSettingsCard;
