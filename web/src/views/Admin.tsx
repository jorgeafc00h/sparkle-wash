import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Building2, Camera, Check, CheckCircle2, Copy, KeyRound, LogIn, LogOut, Mail, Plus, Power, ScanLine, ShieldCheck, Trash2, UserPlus,
  Users, Wifi, WifiOff, X,
} from "lucide-react";
import { CarwashFields, type CarwashErrors } from "../components/CarwashForm";
import { Empty, ErrorBanner } from "../components/ui";
import { errorText, useFormat, useI18n } from "../i18n";
import { ApiError } from "../lib/api";
import type { MessageKey } from "../i18n/es";
import { useApi, useToast } from "../lib/context";
import { mdnsHost, needsFirmwareUpdate, suggestCameraId } from "../lib/cameras";
import { formatDuration } from "../lib/format";
import { usePoll } from "../lib/hooks";
import { validateCarwash } from "../lib/regions";
import { useSession } from "../lib/session";
import type { CameraRole, Device, DeviceWithKey, Role, TenantInput } from "../lib/types";
import { API_BASE } from "../SignIn";

export const ADMIN_SECTIONS = ["autolavado", "camaras", "equipo", "empleados"] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];
const SECTION_LABEL: Record<AdminSection, MessageKey> = {
  autolavado: "admin.tab.carwash", camaras: "admin.tab.cameras", equipo: "admin.tab.team", empleados: "admin.tab.employees",
};
const SECTION_ICON = { autolavado: Building2, camaras: Camera, equipo: ShieldCheck, empleados: Users };
const ROLES: Role[] = ["viewer", "operator", "admin"];
const CAMERA_ROLES: CameraRole[] = ["entry", "bay", "exit"];
const CAMERA_ROLE_ICON = { entry: LogIn, bay: ScanLine, exit: LogOut };

export function AdminView({ section, onSection }: { section: string; onSection: (section: AdminSection) => void }) {
  const api = useApi();
  const { t } = useI18n();
  const current: AdminSection = (ADMIN_SECTIONS as readonly string[]).includes(section) ? (section as AdminSection) : "autolavado";
  const devices = usePoll(() => api.devices(), 15_000);
  const employees = usePoll(() => api.employees(), 60_000);
  const team = usePoll(() => api.team(), 60_000);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKey(event: React.KeyboardEvent) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = ADMIN_SECTIONS.indexOf(current);
    const next = (index + (event.key === "ArrowRight" ? 1 : ADMIN_SECTIONS.length - 1)) % ADMIN_SECTIONS.length;
    onSection(ADMIN_SECTIONS[next]);
    tabs.current[next]?.focus();
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">{t("admin.title")}</h1>
          <p className="page-sub">{t("admin.subtitle")}</p>
        </div>
      </header>
      <Onboarding devices={devices.data?.filter((d) => !d.disabled).length} team={team.data ? team.data.members.length + team.data.invitations.length : undefined}
        employees={employees.data?.length} onSection={onSection} />
      <div className="admin-tabs" role="tablist" aria-label={t("admin.title")} onKeyDown={onKey}>
        {ADMIN_SECTIONS.map((id, i) => {
          const Icon = SECTION_ICON[id];
          return (
            <button key={id} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`admin-tab-${id}`}
              aria-selected={current === id} aria-controls="admin-panel" tabIndex={current === id ? 0 : -1} onClick={() => onSection(id)}>
              <Icon size={17} aria-hidden />{t(SECTION_LABEL[id])}
            </button>
          );
        })}
      </div>
      <section id="admin-panel" role="tabpanel" aria-labelledby={`admin-tab-${current}`}>
        {current === "autolavado" && <CarwashTab />}
        {current === "camaras" && <CamerasTab devices={devices.data} error={devices.error} refresh={devices.refresh} />}
        {current === "equipo" && <TeamTab team={team.data} error={team.error} refresh={team.refresh} />}
        {current === "empleados" && <EmployeesTab employees={employees.data} error={employees.error} refresh={employees.refresh} />}
      </section>
    </>
  );
}

function Onboarding({ devices, team, employees, onSection }: {
  devices?: number; team?: number; employees?: number; onSection: (section: AdminSection) => void;
}) {
  const { t } = useI18n();
  const session = useSession();
  if (devices === undefined || team === undefined || employees === undefined) return null;
  const steps: { done: boolean; label: MessageKey; section: AdminSection }[] = [
    { done: devices > 0, label: "admin.step.camera", section: "camaras" },
    { done: team > 1, label: "admin.step.team", section: "equipo" },
    { done: employees > 0, label: "admin.step.employees", section: "empleados" },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <section className="card onboarding" aria-label={t("admin.checklist")}>
      <div>
        <h2>{t("admin.welcome", { name: session?.tenant.name ?? "" })}</h2>
        <p className="muted">{t("admin.checklist")}</p>
      </div>
      <ol>
        {steps.map((step, i) => (
          <li key={step.label}>
            <button type="button" className={`step ${step.done ? "done" : ""}`} onClick={() => onSection(step.section)}>
              <span className="step-mark" aria-hidden>{step.done ? <Check size={15} /> : i + 1}</span>
              {t(step.label)}
              {step.done && <span className="sr-only">✓</span>}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------- Autolavado ----------------
function CarwashTab() {
  const api = useApi();
  const toast = useToast();
  const { t } = useI18n();
  const [form, setForm] = useState<TenantInput | null>(null);
  const [errors, setErrors] = useState<CarwashErrors>({});
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    api.tenant().then((tenant) => setForm({
      name: tenant.name, city: tenant.city ?? "", country: tenant.country, phone: tenant.phone ?? "", timeZone: tenant.timeZone,
    })).catch(setLoadError);
  }, [api]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    const found = validateCarwash(form);
    setErrors(found);
    if (found.name || found.phone) return;
    setBusy(true);
    try {
      await api.updateTenant({ ...form, name: form.name.trim() });
      toast("ok", t("admin.saved"));
    } catch (e) {
      toast("error", errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <ErrorBanner error={loadError} />;
  if (!form) return <div className="skeleton" style={{ height: 260 }} />;
  return (
    <form className="card card-pad admin-form" onSubmit={save} noValidate>
      <CarwashFields value={form} onChange={setForm} errors={errors} />
      <div><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t("admin.saving") : t("admin.save")}</button></div>
    </form>
  );
}

// ---------------- Cámaras ----------------
function signalBars(rssi: number | null | undefined): number {
  if (rssi == null) return 0;
  if (rssi >= -60) return 4;
  if (rssi >= -70) return 3;
  if (rssi >= -80) return 2;
  return 1;
}

function CamerasTab({ devices, error, refresh }: { devices: Device[] | null; error: unknown; refresh: () => void }) {
  const { t } = useI18n();
  const [linking, setLinking] = useState(false);
  const [issued, setIssued] = useState<DeviceWithKey | null>(null);
  return (
    <>
      <div className="section-bar">
        <h2 className="section-title">{t("cameras.title")}</h2>
        <button type="button" className="btn btn-primary" onClick={() => setLinking(true)}><Plus size={18} aria-hidden />{t("cameras.add")}</button>
      </div>
      <ErrorBanner error={error} />
      {devices === null ? <div className="skeleton" style={{ height: 180 }} />
        : devices.length === 0 ? (
          <div className="card"><Empty icon={Camera} title={t("cameras.empty")}>{t("cameras.emptyBody")}</Empty></div>
        ) : (
          <div className="device-grid">
            {devices.map((device) => <DeviceCard key={device.id} device={device} onChanged={refresh} onKey={setIssued} />)}
          </div>
        )}
      {linking && <LinkDialog existing={devices ?? []} onClose={() => setLinking(false)} onCreated={(created) => { setLinking(false); setIssued(created); refresh(); }} />}
      {issued && <KeyDialog issued={issued} onClose={() => { setIssued(null); refresh(); }} />}
    </>
  );
}

function DeviceCard({ device, onChanged, onKey }: { device: Device; onChanged: () => void; onKey: (issued: DeviceWithKey) => void }) {
  const api = useApi();
  const toast = useToast();
  const { t } = useI18n();
  const f = useFormat();
  const [busy, setBusy] = useState(false);
  const RoleIcon = CAMERA_ROLE_ICON[device.role];
  const bars = signalBars(device.lastStatus?.rssi);
  const state = device.disabled ? "disabled" : device.online ? "online" : device.lastSeenAt ? "offline" : "never";

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); } catch (e) { toast("error", errorText(e, t)); } finally { setBusy(false); onChanged(); }
  }

  return (
    <article className={`card device ${device.disabled ? "is-disabled" : ""}`} aria-label={device.name}>
      <div className="device-head">
        <span className="device-icon" aria-hidden><RoleIcon size={20} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3>{device.name}</h3>
          <span className="subtle mono">{device.cameraId}</span>
        </div>
        <span className="pill pill-neutral">{t(`cameraRole.${device.role}`)}</span>
      </div>
      <p className={`device-state state-${state}`} role="status">
        {state === "online" ? <Wifi size={15} aria-hidden /> : <WifiOff size={15} aria-hidden />}
        {state === "online" ? t("device.online") : state === "offline" ? t("device.offline", { ago: f.ago(device.lastSeenAt) })
          : state === "never" ? t("device.never") : t("device.disabled")}
      </p>
      {state === "never" && <p className="help device-help">{t("device.neverHelp", { name: device.name })}</p>}
      {needsFirmwareUpdate(device.lastStatus?.firmware) && (
        <p className="device-update" role="note">
          <span className="pill pill-warn">{t("device.updateBadge")}</span>
          <span className="help">{t("device.updateHelp", { version: device.lastStatus?.firmware ?? "" })}</span>
        </p>
      )}
      <dl className="device-stats">
        <div>
          <dt>{t("device.signal")}</dt>
          <dd>
            <span className="bars" aria-hidden>{[1, 2, 3, 4].map((n) => <i key={n} className={n <= bars ? "on" : ""} />)}</span>
            {device.lastStatus?.rssi != null ? `${device.lastStatus.rssi} dBm` : "—"}
          </dd>
        </div>
        <div><dt>{t("device.uptime")}</dt><dd>{device.lastStatus?.uptimeMs != null ? formatDuration(device.lastStatus.uptimeMs / 1000) : "—"}</dd></div>
        <div><dt>{t("device.fps")}</dt><dd>{device.lastStatus?.fps != null ? device.lastStatus.fps.toFixed(1) : "—"}</dd></div>
        <div><dt>{t("device.reads")}</dt><dd>{device.observations}</dd></div>
        <div><dt>IP</dt><dd className="mono">{device.lastStatus?.ip ?? "—"}</dd></div>
        <div><dt>{t("device.firmware")}</dt><dd className="mono">{device.lastStatus?.firmware?.replace("sparklewash-cam/", "") ?? "—"}</dd></div>
      </dl>
      <p className="subtle device-meta">
        <KeyRound size={13} aria-hidden /> {t("device.key")} <span className="mono">{device.keyHint}</span>
      </p>
      <div className="device-actions">
        <button type="button" className="btn btn-sm" disabled={busy || device.disabled}
          onClick={() => window.confirm(t("device.rotateConfirm", { name: device.name })) &&
            void run(async () => onKey(await api.rotateDevice(device.id)))}>
          <KeyRound size={15} aria-hidden />{t("device.rotate")}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={busy}
          onClick={() => {
            if (!device.disabled && !window.confirm(t("device.disableConfirm", { name: device.name }))) return;
            void run(async () => {
              await api.setDeviceDisabled(device.id, !device.disabled);
              toast("ok", t(device.disabled ? "device.enabled" : "device.disabledToast", { name: device.name }));
            });
          }}>
          <Power size={15} aria-hidden />{device.disabled ? t("device.enable") : t("device.disable")}
        </button>
      </div>
    </article>
  );
}

function Modal({ title, onClose, children, dismissable = true }: { title: string; onClose: () => void; children: ReactNode; dismissable?: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  // Parents pass inline callbacks; keep the latest in a ref so re-renders don't re-run the focus effect.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, button, select, textarea")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissable) close.current();
      if (event.key !== "Tab" || !ref.current) return;
      // Keep focus inside the dialog.
      const focusable = [...ref.current.querySelectorAll<HTMLElement>("input, button, select, textarea, a[href]")].filter((el) => !el.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [dismissable]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (dismissable && e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="card modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head">
          <h2 id="modal-title">{title}</h2>
          {dismissable && <button type="button" className="btn btn-ghost icon-btn" aria-label={t("common.close")} onClick={onClose}><X size={18} aria-hidden /></button>}
        </div>
        {children}
      </div>
    </div>
  );
}

function LinkDialog({ existing, onClose, onCreated }: { existing: Device[]; onClose: () => void; onCreated: (created: DeviceWithKey) => void }) {
  const api = useApi();
  const { t } = useI18n();
  const firstFree = CAMERA_ROLES.find((role) => !existing.some((d) => d.role === role && !d.disabled)) ?? "bay";
  const [role, setRole] = useState<CameraRole>(firstFree);
  const [name, setName] = useState("");
  const [cameraId, setCameraId] = useState(() => suggestCameraId(firstFree, existing));
  const [touchedId, setTouchedId] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const id = cameraId.trim().toLowerCase();
    if (name.trim().length < 2 || name.trim().length > 60 || !/^[a-z0-9_-]{1,64}$/.test(id)) { setError(t("link.invalid")); return; }
    const taken = () => t("link.idTaken", { cameraId: id, suggestion: suggestCameraId(role, existing) });
    if (existing.some((d) => d.cameraId === id)) { setError(taken()); return; }
    setBusy(true);
    setError(null);
    try { onCreated(await api.createDevice({ name: name.trim(), cameraId: id, role })); }
    catch (e) { setError(e instanceof ApiError && e.status === 409 ? taken() : errorText(e, t)); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={t("link.title")} onClose={onClose}>
      <form onSubmit={submit} noValidate className="modal-body">
        <div className="field" role="radiogroup" aria-labelledby="link-role">
          <span id="link-role" className="label">{t("link.role")}</span>
          <div className="segmented">
            {CAMERA_ROLES.map((r) => {
              const Icon = CAMERA_ROLE_ICON[r];
              return (
                <button key={r} type="button" role="radio" aria-checked={role === r} className="seg"
                  onClick={() => { setRole(r); if (!touchedId) setCameraId(suggestCameraId(r, existing)); }}>
                  <Icon size={18} aria-hidden />{t(`cameraRole.${r}`)}
                </button>
              );
            })}
          </div>
          <p className="help">{t(`cameraRole.help.${role}`)}</p>
        </div>
        <div className="field">
          <label className="label" htmlFor="link-name">{t("link.name")}</label>
          <input id="link-name" className="input" value={name} maxLength={60} placeholder={t("link.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="link-id">{t("link.cameraId")}</label>
          <input id="link-id" className="input mono" value={cameraId} maxLength={64} spellCheck={false} autoCapitalize="none"
            onChange={(e) => { setTouchedId(true); setCameraId(e.target.value); }} aria-describedby="link-id-help" />
          <p id="link-id-help" className="help">{t("link.cameraIdHelp")}</p>
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t("link.cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}><KeyRound size={17} aria-hidden />{busy ? t("link.creating") : t("link.create")}</button>
        </div>
      </form>
    </Modal>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="btn btn-sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: text stays selectable */ }
    }}>
      {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}{copied ? t("link.copied") : t("link.copy")}
    </button>
  );
}

function KeyDialog({ issued, onClose }: { issued: DeviceWithKey; onClose: () => void }) {
  const { t } = useI18n();
  const apiUrl = API_BASE || window.location.origin;
  const command = `python -m sparkle_vision.gateway \\\n  --camera-url http://${mdnsHost(issued.device.cameraId)}/cam-hi.jpg \\\n  --camera-id ${issued.device.cameraId} \\\n  --api ${apiUrl} \\\n  --device-key ${issued.deviceKey}`;
  return (
    <Modal title={t("link.keyTitle", { name: issued.device.name })} onClose={onClose} dismissable={false}>
      <div className="modal-body">
        <p className="key-warning" role="alert"><KeyRound size={16} aria-hidden />{t("link.keyWarning")}</p>
        <div className="key-box">
          <code className="mono" aria-label={t("device.key")}>{issued.deviceKey}</code>
          <CopyButton text={issued.deviceKey} />
        </div>
        <p className="help">{t("link.steps", { cameraId: issued.device.cameraId })}</p>
        <div className="key-box">
          <pre className="mono" aria-label={t("link.command")}>{command}</pre>
          <CopyButton text={command.replace(/\\\n\s+/g, "")} />
        </div>
        <p className="help">{t("link.mdnsNote")}</p>
        <p className="help subtle">{t("link.stepsLegacy", { cameraId: issued.device.cameraId })}</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}><CheckCircle2 size={17} aria-hidden />{t("link.done")}</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------- Equipo ----------------
function TeamTab({ team, error, refresh }: { team: import("../lib/types").Team | null; error: unknown; refresh: () => void }) {
  const api = useApi();
  const toast = useToast();
  const { t } = useI18n();
  const f = useFormat();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    try { await action(); toast("ok", success); } catch (e) { toast("error", errorText(e, t)); } finally { setBusy(false); refresh(); }
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    const value = email.trim().toLowerCase();
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    setInvalid(!ok);
    if (!ok) return;
    await run(async () => { await api.invite(value, role); setEmail(""); }, t("team.invited", { email: value }));
  }

  return (
    <div className="grid two-col">
      <section className="card" aria-labelledby="team-members">
        <div className="card-head"><h2 id="team-members" className="card-title"><ShieldCheck size={16} aria-hidden />{t("team.members")}</h2></div>
        <ErrorBanner error={error} />
        {team === null ? <div className="card-pad"><div className="skeleton" style={{ height: 120 }} /></div> : (
          <ul className="member-list">
            {team.members.map((m) => {
              const display = m.name ?? m.email ?? m.subject;
              const isYou = m.subject === team.you;
              return (
                <li key={m.subject}>
                  <span className="avatar" aria-hidden>{display.slice(0, 2).toUpperCase()}</span>
                  <span className="member-who">
                    <strong>{display}{isYou && <span className="pill pill-info" style={{ marginLeft: 8 }}>{t("team.you")}</span>}</strong>
                    {m.email && <span className="subtle">{m.email}</span>}
                  </span>
                  <label className="sr-only" htmlFor={`role-${m.subject}`}>{t("team.roleLabel", { name: display })}</label>
                  <select id={`role-${m.subject}`} className="input role-select" value={m.role} disabled={busy}
                    onChange={(e) => void run(() => api.setMemberRole(m.subject, e.target.value as Role), t("team.roleChanged", { name: display }))}>
                    {ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                  </select>
                  {!isYou && (
                    <button type="button" className="btn btn-ghost btn-sm btn-danger icon-btn" aria-label={`${t("team.remove")} ${display}`} disabled={busy}
                      onClick={() => window.confirm(t("team.removeConfirm", { name: display })) && void run(() => api.removeMember(m.subject), t("team.removed"))}>
                      <Trash2 size={16} aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {team && team.configured.length > 0 && (
          <div className="card-pad configured">
            <h3 className="label">{t("team.configured")}</h3>
            <p className="help">{t("team.configuredHelp")}</p>
            <ul>{team.configured.map((c) => <li key={c.subject}><span className="mono">{c.subject}</span> · {t(`role.${c.role}`)}</li>)}</ul>
          </div>
        )}
      </section>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <form className="card card-pad" onSubmit={invite} noValidate aria-labelledby="invite-title" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 id="invite-title" className="card-title"><UserPlus size={16} aria-hidden />{t("team.inviteTitle")}</h2>
          <p className="help">{t("team.inviteHelp")}</p>
          <div className="field">
            <label className="label" htmlFor="invite-email">{t("team.email")}</label>
            <input id="invite-email" type="email" className={`input ${invalid ? "input-error" : ""}`} value={email} autoComplete="off"
              placeholder="persona@gmail.com" onChange={(e) => setEmail(e.target.value)} aria-invalid={invalid}
              aria-describedby={invalid ? "invite-error" : undefined} />
            {invalid && <p id="invite-error" className="error-text">{t("team.emailInvalid")}</p>}
          </div>
          <div className="field" role="radiogroup" aria-labelledby="invite-role">
            <span id="invite-role" className="label">{t("link.role")}</span>
            <div className="role-options">
              {ROLES.map((r) => (
                <button key={r} type="button" role="radio" aria-checked={role === r} className="seg role-option" onClick={() => setRole(r)}>
                  <strong>{t(`role.${r}`)}</strong><span>{t(`role.help.${r}`)}</span>
                </button>
              ))}
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}><Mail size={17} aria-hidden />{t("team.invite")}</button>
        </form>
        {team && team.invitations.length > 0 && (
          <section className="card" aria-labelledby="pending-title">
            <div className="card-head"><h2 id="pending-title" className="card-title"><Mail size={16} aria-hidden />{t("team.pending")}</h2></div>
            <ul className="member-list">
              {team.invitations.map((inv) => (
                <li key={inv.id}>
                  <span className="member-who"><strong>{inv.email}</strong><span className="subtle">{t(`role.${inv.role}`)} · {f.ago(inv.invitedAt)}</span></span>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
                    onClick={() => void run(() => api.revokeInvitation(inv.id), t("team.revoked"))}>{t("team.revoke")}</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------- Empleados ----------------
function EmployeesTab({ employees, error, refresh }: { employees: import("../lib/types").Employee[] | null; error: unknown; refresh: () => void }) {
  const api = useApi();
  const toast = useToast();
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try { await action(); if (success) toast("ok", success); } catch (e) { toast("error", errorText(e, t)); } finally { setBusy(false); refresh(); }
  }

  return (
    <section className="card" aria-labelledby="emp-title">
      <div className="card-head"><h2 id="emp-title" className="card-title"><Users size={16} aria-hidden />{t("emp.title")}</h2></div>
      <div className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p className="help">{t("emp.help")}</p>
        <form className="inline-form" noValidate onSubmit={(e) => {
          e.preventDefault();
          const trimmed = name.trim();
          if (trimmed.length < 2) return;
          void run(async () => { await api.addEmployee(trimmed); setName(""); }, t("emp.added", { name: trimmed }));
        }}>
          <label className="sr-only" htmlFor="emp-name">{t("emp.name")}</label>
          <input id="emp-name" className="input" value={name} maxLength={100} placeholder={t("emp.name")} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={busy || name.trim().length < 2}><Plus size={17} aria-hidden />{t("emp.add")}</button>
        </form>
        <ErrorBanner error={error} />
        {employees === null ? <div className="skeleton" style={{ height: 100 }} /> : employees.length === 0
          ? <p className="subtle">{t("emp.empty")}</p> : (
            <ul className="member-list flush">
              {employees.map((e) => (
                <li key={e.id} className={e.active ? "" : "is-disabled"}>
                  <span className="avatar" aria-hidden>{e.name.slice(0, 2).toUpperCase()}</span>
                  <span className="member-who"><strong>{e.name}</strong>{!e.active && <span className="subtle">{t("emp.inactive")}</span>}</span>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run(() => api.setEmployeeActive(e.id, !e.active))}>
                    {e.active ? t("emp.deactivate") : t("emp.activate")}
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}
