// Settings → SparkleWash (lavado): API connection, Google sign-in, work-ticket
// printing options and a sample print. The carwash API must list this app's
// Google OAuth client id as an accepted audience.

import { useEffect, useState } from 'react';
import { CheckCircle2, LogIn, LogOut, Plug, Printer, Save } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { useToast } from '@/components/common/Toast';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { selectActiveLocalUser } from '@/store/selectors/localUsersSelectors';
import { usePosSettings } from '@/hooks/useTickets';
import {
  saveCarwashSettings,
  selectCarwashSession,
  selectCarwashSettings,
  signInCarwash,
  signInCarwashWithToken,
  signOutCarwash,
} from '@/store/slices/carwashSlice';
import { CarwashApiClient } from '@/services/carwash/CarwashApiClient';
import type { CarwashJob, CarwashSettings } from '@/services/carwash/types';
import { normalizeRegisterCode } from '@/services/tickets/ticketNumber';
import { buildWorkTicketCopies, printWorkTicket } from '@/services/printing/WorkTicketPrinting';
import { previewReceiptText } from '@/services/printing/PosPrinting';

const ROLE_LABEL: Record<string, string> = { viewer: 'Solo lectura', operator: 'Operador', admin: 'Administrador' };

function sampleJob(ticketNumber: string): CarwashJob {
  const now = new Date().toISOString();
  return {
    id: 'local-00000000-sample',
    arrivalId: 'sample',
    plate: 'P123-456',
    vehicleClass: 'sedan',
    packageId: 'sample',
    packageName: 'Lavado completo',
    services: ['Lavado exterior', 'Aspirado interior', 'Brillo de llantas'],
    priceUsd: 12,
    currency: 'USD',
    status: 'arrived',
    arrivalAt: now,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    elapsedSeconds: 0,
    activeSeconds: null,
    transitions: [],
    assignments: [{ employeeId: 'sample', employeeName: 'Empleado de prueba', assignedAt: now }],
    ticketNumber,
    customerName: 'Cliente de prueba',
    note: 'Ticket de prueba',
    payments: [],
    paidUsd: 0,
    paymentStatus: 'unpaid',
    source: 'desktop-pos',
  };
}

export default function CarwashSettingsPage() {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const stored = useAppSelector(selectCarwashSettings) as CarwashSettings;
  const session = useAppSelector(selectCarwashSession);
  const company = useAppSelector(selectCurrentCompany);
  const cashier = useAppSelector(selectActiveLocalUser);
  const { settings: posSettings } = usePosSettings(company?.id);

  const [form, setForm] = useState<CarwashSettings>(stored);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busyAuth, setBusyAuth] = useState(false);
  const [devToken, setDevToken] = useState('');
  const [preview, setPreview] = useState('');

  useEffect(() => setForm(stored), [stored]);

  const set = <K extends keyof CarwashSettings>(key: K, value: CarwashSettings[K]) => setForm((f) => ({ ...f, [key]: value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(stored);

  function clamped(): CarwashSettings {
    return {
      ...form,
      apiBaseUrl: form.apiBaseUrl.trim().replace(/\/+$/, ''),
      registerCode: normalizeRegisterCode(form.registerCode) || 'C1',
      workTicketCopies: Math.max(1, Math.min(3, Math.round(form.workTicketCopies || 1))),
      pollSeconds: Math.max(5, Math.min(300, Math.round(form.pollSeconds || 15))),
    };
  }

  async function save() {
    setSaving(true);
    try {
      await dispatch(saveCarwashSettings(clamped())).unwrap();
      toast.success('Configuración de SparkleWash guardada');
    } catch (err) {
      toast.error(`No se pudo guardar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const client = new CarwashApiClient({ baseUrl: form.apiBaseUrl.trim() });
      await client.request('GET', '/health', { auth: false });
      setTestResult({ ok: true, message: 'Conexión correcta con la API de SparkleWash.' });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  async function login() {
    setBusyAuth(true);
    try {
      if (dirty) await dispatch(saveCarwashSettings(clamped())).unwrap();
      await dispatch(signInCarwash()).unwrap();
      toast.success('Sesión iniciada en SparkleWash');
    } catch (err) {
      toast.error(`No se pudo iniciar sesión: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyAuth(false);
    }
  }

  async function logout() {
    setBusyAuth(true);
    try {
      await dispatch(signOutCarwash()).unwrap();
      toast.info('Sesión cerrada');
    } catch (err) {
      toast.error(`No se pudo cerrar la sesión: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyAuth(false);
    }
  }

  async function loginWithToken() {
    if (!devToken.trim()) return;
    setBusyAuth(true);
    try {
      if (dirty) await dispatch(saveCarwashSettings(clamped())).unwrap();
      await dispatch(signInCarwashWithToken(devToken.trim())).unwrap();
      setDevToken('');
      toast.success('Sesión iniciada con token de desarrollo');
    } catch (err) {
      toast.error(`Token rechazado: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyAuth(false);
    }
  }

  async function printTest() {
    const job = sampleJob(`OT-${clamped().registerCode}-000000`);
    const opts = {
      company,
      registerCode: clamped().registerCode,
      cashierName: cashier?.displayName,
      footer: form.workTicketFooter,
      copies: clamped().workTicketCopies,
      vehicleClassName: 'Sedán',
    };
    setPreview(previewReceiptText(buildWorkTicketCopies(job, posSettings, { ...opts, copies: 1 })[0]));
    const result = await printWorkTicket(job, posSettings, opts);
    if (result.ok) toast.success('Ticket de prueba enviado a la impresora');
    else toast.warning(`No se imprimió: ${result.error}`);
  }

  return (
    <div data-testid="carwash-settings" className="space-y-6 max-w-3xl">
      <PageHeader title="SparkleWash (lavado)" subtitle="Conexión con la API, tickets de trabajo y cuenta" />

      <Card className="p-5 space-y-4">
        <h2 className="font-semibold text-brand-800">Conexión</h2>
        <Input
          label="URL de la API"
          id="carwash-api-url"
          data-testid="carwash-api-url"
          value={form.apiBaseUrl}
          placeholder="https://api.sparklewash.example"
          onChange={(e) => set('apiBaseUrl', e.target.value)}
        />
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" loading={testing} onClick={() => void testConnection()} data-testid="carwash-test-connection">
            <Plug size={16} /> Probar conexión
          </Button>
          {testResult && (
            <span data-testid="carwash-test-result" data-ok={testResult.ok ? 'true' : 'false'} className={`text-sm ${testResult.ok ? 'text-green-700' : 'text-red-700'}`}>
              {testResult.message}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500">
          La API de SparkleWash debe incluir el Client ID de Google de esta aplicación en sus audiencias permitidas;
          de lo contrario el inicio de sesión será rechazado.
        </p>

        <div className="border-t border-brand-100 pt-4 space-y-3">
          <h3 className="text-sm font-semibold text-brand-800">Cuenta</h3>
          {session ? (
            <div className="flex flex-wrap items-center gap-3" data-testid="carwash-session">
              <CheckCircle2 size={18} className="text-green-600" />
              <div className="text-sm">
                <p className="font-medium text-brand-900">{session.tenant?.name ?? 'SparkleWash'}</p>
                <p className="text-xs text-slate-500">{session.email ?? session.subject}</p>
              </div>
              <Badge variant="info" size="sm">{ROLE_LABEL[session.role] ?? session.role}</Badge>
              <Button variant="secondary" size="sm" loading={busyAuth} onClick={() => void logout()} data-testid="carwash-signout">
                <LogOut size={16} /> Cerrar sesión
              </Button>
            </div>
          ) : (
            <Button size="sm" loading={busyAuth} onClick={() => void login()} data-testid="carwash-signin">
              <LogIn size={16} /> Iniciar sesión con Google
            </Button>
          )}

          {import.meta.env.DEV && (
            <div className="flex items-end gap-2" data-testid="carwash-dev-token">
              <Input
                label="Token de desarrollo"
                id="carwash-dev-token-input"
                data-testid="carwash-dev-token-input"
                value={devToken}
                placeholder="Google id_token de prueba"
                onChange={(e) => setDevToken(e.target.value)}
              />
              <Button variant="secondary" size="sm" disabled={!devToken.trim()} loading={busyAuth} onClick={() => void loginWithToken()} data-testid="carwash-dev-token-submit">
                Entrar
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <h2 className="font-semibold text-brand-800">Caja y tickets de trabajo</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Código de caja"
            id="carwash-register-code"
            data-testid="carwash-register-code"
            value={form.registerCode}
            maxLength={4}
            helperText={`Las órdenes salen como OT-${normalizeRegisterCode(form.registerCode) || 'C1'}-000001`}
            onChange={(e) => set('registerCode', normalizeRegisterCode(e.target.value))}
          />
          <Input
            label="Copias por ticket (1–3)"
            id="carwash-copies"
            data-testid="carwash-copies"
            type="number"
            min={1}
            max={3}
            value={form.workTicketCopies}
            helperText="Cliente · Vehículo · Caja"
            onChange={(e) => set('workTicketCopies', Number(e.target.value))}
          />
          <Input
            label="Segundos de sondeo (sin conexión en vivo)"
            id="carwash-poll"
            data-testid="carwash-poll"
            type="number"
            min={5}
            max={300}
            value={form.pollSeconds}
            onChange={(e) => set('pollSeconds', Number(e.target.value))}
          />
          <label className="flex items-center gap-2 text-sm text-brand-700 self-end pb-2">
            <input
              type="checkbox"
              data-testid="carwash-auto-print"
              checked={form.autoPrintWorkTicket}
              onChange={(e) => set('autoPrintWorkTicket', e.target.checked)}
            />
            Imprimir el ticket al crear un servicio
          </label>
        </div>
        <Input
          label="Pie del ticket"
          id="carwash-footer"
          data-testid="carwash-footer"
          value={form.workTicketFooter}
          maxLength={120}
          onChange={(e) => set('workTicketFooter', e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void save()} data-testid="carwash-save">
            <Save size={16} /> Guardar
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void printTest()} data-testid="carwash-print-test">
            <Printer size={16} /> Imprimir ticket de prueba
          </Button>
        </div>
        {preview && (
          <pre data-testid="carwash-test-preview" className="text-[11px] leading-tight bg-slate-50 border border-brand-100 rounded p-3 overflow-x-auto font-mono">{preview}</pre>
        )}
        {!posSettings.printer && (
          <p className="text-xs text-amber-700">
            No hay impresora configurada: el ticket de prueba solo se previsualiza. Configúrala en Configuración → Impresora de tickets.
          </p>
        )}
      </Card>
    </div>
  );
}
