// OcrProviderSettingsCard — tabbed settings panel for the Compras OCR
// feature. Top-level toggle picks which provider runs the extraction
// (Azure OpenAI gpt-4o or local Ollama llama3.2-vision); the tab below
// shows the config for that provider so the user can edit / save it.

import { useEffect, useState } from 'react';
import { Cpu, Cloud } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { useToast } from '@/components/common/Toast';
import {
  OcrSettingsService,
  type OcrProvider,
} from '@/services/ocr/OcrSettingsService';
import { AzureOpenAiSettingsCard } from './AzureOpenAiSettingsCard';
import { OllamaSettingsCard } from './OllamaSettingsCard';

export function OcrProviderSettingsCard() {
  const toast = useToast();
  const [provider, setProvider] = useState<OcrProvider>('azure');
  const [tab, setTab] = useState<OcrProvider>('azure');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    OcrSettingsService.getSettings().then((s) => {
      if (cancelled) return;
      setProvider(s.provider);
      setTab(s.provider);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function chooseProvider(next: OcrProvider) {
    if (next === provider) return;
    setProvider(next);
    try {
      await OcrSettingsService.setActiveProvider(next);
      toast.success(
        next === 'azure'
          ? 'Proveedor activo: Azure OpenAI Vision.'
          : 'Proveedor activo: Ollama (local).',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cambiar proveedor');
      // Revert local state on failure so the UI stays in sync with storage.
      setProvider(provider);
    }
  }

  return (
    <Card className="space-y-4" data-testid="ocr-provider-settings">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-brand-800">
            OCR de facturas (Compras)
          </h2>
          <p className="text-xs text-brand-500 mt-1">
            Extrae datos de facturas y tickets desde imágenes. Elige el proveedor
            que prefieras: Azure OpenAI (rápido y preciso, en la nube) u Ollama
            (privado, en tu máquina).
          </p>
        </div>
        {hydrated && (
          <Badge variant={provider === 'azure' ? 'info' : 'purple'}>
            {provider === 'azure' ? 'Azure OpenAI' : 'Ollama'}
          </Badge>
        )}
      </div>

      {/* Active-provider radio. The choice persists immediately so the
          import flow always uses whichever provider is selected here. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ProviderOption
          icon={<Cloud size={16} />}
          title="Azure OpenAI Vision"
          subtitle="GPT-4o · nube · alta precisión"
          active={provider === 'azure'}
          onClick={() => chooseProvider('azure')}
          testId="provider-radio-azure"
        />
        <ProviderOption
          icon={<Cpu size={16} />}
          title="Ollama (local)"
          subtitle="llama3.2-vision · sin nube · privado"
          active={provider === 'ollama'}
          onClick={() => chooseProvider('ollama')}
          testId="provider-radio-ollama"
        />
      </div>

      {/* Tab strip — independent of the active-provider radio so the user
          can edit the OTHER provider's config without changing what runs
          today. (Useful when migrating a deployment between cloud and local.) */}
      <div className="border-b border-brand-200 flex gap-1">
        <TabButton
          active={tab === 'azure'}
          onClick={() => setTab('azure')}
          testId="tab-azure"
        >
          Azure OpenAI
        </TabButton>
        <TabButton
          active={tab === 'ollama'}
          onClick={() => setTab('ollama')}
          testId="tab-ollama"
        >
          Ollama
        </TabButton>
      </div>

      <div className="pt-1">
        {tab === 'azure' ? <AzureOpenAiSettingsCard /> : <OllamaSettingsCard />}
      </div>
    </Card>
  );
}

interface ProviderOptionProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  active: boolean;
  onClick: () => void;
  testId?: string;
}

function ProviderOption({
  icon,
  title,
  subtitle,
  active,
  onClick,
  testId,
}: ProviderOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`text-left rounded-lg border p-3 transition-colors ${
        active
          ? 'border-accent-500 bg-accent-50 ring-2 ring-accent-200'
          : 'border-brand-200 bg-white hover:border-brand-300 hover:bg-brand-50'
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-brand-800">
        <span className={active ? 'text-accent-700' : 'text-brand-400'}>{icon}</span>
        {title}
        {active && (
          <span className="ml-auto text-xs font-normal text-accent-700">activo</span>
        )}
      </div>
      <p className="text-xs text-brand-500 mt-1">{subtitle}</p>
    </button>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}

function TabButton({ active, onClick, children, testId }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-accent-500 text-accent-700'
          : 'border-transparent text-brand-500 hover:text-brand-700'
      }`}
      role="tab"
      aria-selected={active}
    >
      {children}
    </button>
  );
}

export default OcrProviderSettingsCard;
