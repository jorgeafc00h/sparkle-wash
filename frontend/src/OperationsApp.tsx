import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCatalog, type ServiceCatalog } from './api/packages';
import { parseArrivals, parseEmployees, parseInventory, parseJobs, parseSummary, type Arrival } from './api/operations';

declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize(options: { client_id: string; callback: (reply: { credential: string }) => void }): void;
      renderButton(element: HTMLElement, options: { theme: string; size: string }): void;
      disableAutoSelect(): void;
    } } };
  }
}

type Session = { sessionToken: string; role: 'viewer' | 'operator' | 'admin' };

const apiOrigin = (import.meta.env.VITE_API_ORIGIN ?? '').trim().replace(/\/+$/, '');

function requestApi(path: string, options?: RequestInit) {
  return fetch(apiOrigin + path, options);
}

async function readWorkboard(token: string, signal: AbortSignal) {
  const paths = ['/api/arrivals', '/api/jobs', '/api/jobs/summary', '/api/employees', '/api/inventory/items'];
  const responses = await Promise.all(paths.map(path => requestApi(path, { signal, headers: { Authorization: `Bearer ${token}` } })));
  if (responses.some(response => response.status === 401)) return null;
  if (responses.some(response => !response.ok)) throw new Error('Could not refresh operations');
  const [arrivals, jobs, summary, employees, inventory] = await Promise.all(responses.map(response => response.json()));
  return {
    arrivals: parseArrivals(arrivals), jobs: parseJobs(jobs), summary: parseSummary(summary),
    employees: parseEmployees(employees), inventory: parseInventory(inventory), checkedAt: new Date(),
  };
}

export default function OperationsApp() {
  const [catalog, setCatalog] = useState<ServiceCatalog>();
  const [catalogError, setCatalogError] = useState('');
  const [session, setSession] = useState<Session>();
  const [workboard, setWorkboard] = useState<Awaited<ReturnType<typeof readWorkboard>>>(null);
  const [refreshError, setRefreshError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const googleButton = useRef<HTMLDivElement>(null);
  const actionKeys = useRef(new Map<string, string>());
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    const controller = new AbortController();
    requestApi('/api/packages', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Could not load the service menu');
      setCatalog(parseCatalog(await response.json()));
    }).catch(() => { if (!controller.signal.aborted) setCatalogError('Could not load the service menu'); });
    return () => controller.abort();
  }, []);

  const signIn = useCallback(async (idToken: string, signal: AbortSignal) => {
    setActionError('');
    try {
      const response = await requestApi('/api/auth/google', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }), signal,
      });
      if (!response.ok) throw new Error(response.status === 401 ? 'This account does not have staff access.' : 'Could not sign in.');
      const data = await response.json();
      if (typeof data.sessionToken !== 'string' || !data.sessionToken || !['viewer', 'operator', 'admin'].includes(data.role)) {
        throw new Error('Session is missing required fields');
      }
      if (!signal.aborted) {
        setRefreshError('');
        setSession({ sessionToken: data.sessionToken, role: data.role });
      }
    } catch (error) {
      if (!signal.aborted) setActionError(error instanceof Error ? error.message : 'Could not sign in.');
    }
  }, []);

  useEffect(() => {
    const button = googleButton.current;
    if (!clientId || session || !button) return;
    const controller = new AbortController();
    const initialize = () => {
      const google = window.google?.accounts.id;
      if (!google || controller.signal.aborted) return;
      google.initialize({ client_id: clientId, callback: ({ credential }) => void signIn(credential, controller.signal) });
      google.renderButton(button, { theme: 'outline', size: 'large' });
    };
    const script = document.createElement('script');
    if (window.google) initialize();
    else {
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = initialize;
      script.onerror = () => setActionError('Google sign-in could not load.');
      document.head.append(script);
    }
    return () => { controller.abort(); script.remove(); };
  }, [clientId, session, signIn]);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const data = await readWorkboard(session.sessionToken, controller.signal);
        if (controller.signal.aborted) return;
        setWorkboard(data);
        if (!data) {
          actionKeys.current.clear();
          setSession(undefined);
          setActionError('Session expired. Sign in again.');
        } else setRefreshError('');
      } catch {
        if (!controller.signal.aborted) setRefreshError('Could not refresh operations.');
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, document.hidden ? 60_000 : 15_000);
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [session, revision]);

  async function mutate(path: string, body: Record<string, string>, key: string) {
    if (!session) throw new Error('Sign in to make changes.');
    const actionKey = actionKeys.current.get(key) ?? crypto.randomUUID();
    actionKeys.current.set(key, actionKey);
    const response = await requestApi(path, {
      method: 'POST', headers: {
        Authorization: `Bearer ${session.sessionToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': actionKey,
      }, body: JSON.stringify(body),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      throw new Error(typeof failure?.error === 'string' ? failure.error : `Action failed (${response.status}).`);
    }
    actionKeys.current.delete(key);
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setActionError('');
    try { await action(); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Could not save the change.'); }
    finally { setBusy(false); setRevision(value => value + 1); }
  }

  function signOut() {
    if (session) void requestApi('/api/auth/session', {
      method: 'DELETE', headers: { Authorization: `Bearer ${session.sessionToken}` },
    }).catch(() => undefined);
    window.google?.accounts.id.disableAutoSelect();
    actionKeys.current.clear();
    setSession(undefined);
    setWorkboard(null);
    setActionError('');
  }

  const canOperate = session?.role === 'operator' || session?.role === 'admin';

  return <main className="operations">
    <header className="topbar">
      <div><p className="eyebrow">Car Spa · Operations</p><h1>Carwash workboard</h1>
        <p className="intro">Follow each car from arrival through detailing.</p></div>
      {session && <div className="header-actions">
        <span>Signed in as <strong>{session.role}</strong></span>
        <button onClick={() => setRevision(value => value + 1)}>Refresh</button>
        <button className="quiet" disabled={busy} onClick={signOut}>Sign out</button>
      </div>}
    </header>
    {actionError && <p className="notice error" role="alert">{actionError}</p>}
    {!session && <section className="signin-panel"><h2>Staff access</h2>
      {clientId ? <div ref={googleButton} /> : <p>Google sign-in is not configured.</p>}
    </section>}
    {session && <p className="notice" role="status">
      {refreshError || (workboard ? `Last updated ${workboard.checkedAt.toLocaleTimeString()}` : 'Loading operations…')}
      {refreshError && workboard && ` Showing data from ${workboard.checkedAt.toLocaleTimeString()}.`}
    </p>}
    {session && workboard && <>
      <section><h2>Whole-carwash jobs</h2><div className="summary-grid">
        <p className="card">Waiting <strong>{workboard.summary.arrived + workboard.summary.queued}</strong></p>
        <p className="card">Active <strong>{workboard.summary.inProgress}</strong></p>
        <p className="card">Completed today (UTC) <strong>{workboard.summary.completedTodayUtc}</strong></p>
      </div></section>
      <section><h2>Arrivals to review</h2><div className="card-grid">
        {workboard.arrivals.filter(arrival => !workboard.jobs.some(job => job.arrivalId === arrival.id)).map(arrival =>
          <ArrivalCard key={arrival.id} arrival={arrival} catalog={catalog} editable={canOperate} busy={busy}
            open={(plate, vehicleClass, packageId) => void run(async () => {
              if (!arrival.confirmedPlate) await mutate(`/api/arrivals/${arrival.id}/confirm`, { plate, vehicleClass }, `confirm-${arrival.id}`);
              await mutate('/api/jobs', { arrivalId: arrival.id, packageId }, `open-${arrival.id}`);
            })} />)}
      </div></section>
      <section><h2>Jobs</h2><div className="card-grid">
        {workboard.jobs.map(job => {
          const next = job.status === 'arrived' ? 'queued' : job.status === 'queued' ? 'in_progress'
            : job.status === 'in_progress' ? 'completed' : undefined;
          return <article key={job.id} className="card">
            <h3>{job.plate}</h3><p>{job.packageName} · ${job.priceUsd.toFixed(2)} · {job.status.replaceAll('_', ' ')}</p>
            <p>{Math.floor(job.elapsedSeconds / 60)} min on site · {job.assignments.map(item => item.employeeName).join(', ') || 'Unassigned'}</p>
            <details><summary>Included services</summary><ul>{job.services.map(service => <li key={service}>{service}</li>)}</ul></details>
            {canOperate && next && <>
              <button disabled={busy} onClick={() => void run(() => mutate(`/api/jobs/${job.id}/transition`, { status: next }, `transition-${job.id}-${next}`))}>
                {next === 'queued' ? 'Queue job' : next === 'in_progress' ? 'Start work' : 'Complete job'}
              </button>
              <form onSubmit={event => {
                event.preventDefault();
                const employeeId = String(new FormData(event.currentTarget).get('employeeId') ?? '');
                if (employeeId) void run(() => mutate(`/api/jobs/${job.id}/employees`, { employeeId }, `assign-${job.id}-${employeeId}`));
              }}>
                <label>Employee <select name="employeeId" defaultValue="" required>
                  <option value="" disabled>Choose employee</option>
                  {workboard.employees.filter(employee => employee.active && !job.assignments.some(item => item.employeeId === employee.id))
                    .map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
                </select></label>
                <button disabled={busy}>Assign</button>
              </form>
            </>}
          </article>;
        })}
      </div></section>
      <div className="two-column">
        <section><h2>Employees</h2><ul className="simple-list">{workboard.employees.map(employee =>
          <li key={employee.id}>{employee.name} <span>{employee.active ? 'Active' : 'Inactive'}</span></li>)}</ul></section>
        <section><h2>Resources and stock</h2><ul className="simple-list">{workboard.inventory.map(stock =>
          <li key={stock.item.id}>{stock.item.name} <span>{stock.available} {stock.item.unit} available{stock.needsReorder && ' · Reorder needed'}</span></li>)}</ul></section>
      </div>
    </>}
    <section><h2>Detailing packages</h2>
      {catalogError && <p role="alert">{catalogError}</p>}
      <div className="card-grid">{catalog?.packages.map(item => <article className="card" key={item.id}>
        <h3>{item.name}</h3><p>{item.subtitle}</p>
        <ul>{catalog.vehicleClasses.map(vehicle => <li key={vehicle.id}>{vehicle.name} · ${item.prices[vehicle.id]}</li>)}</ul>
        <details><summary>Included services</summary><ul>{item.items.map(service => <li key={service}>{service}</li>)}</ul></details>
      </article>)}</div>
    </section>
  </main>;
}

function ArrivalCard({ arrival, catalog, editable, busy, open }: {
  arrival: Arrival; catalog?: ServiceCatalog; editable: boolean; busy: boolean;
  open: (plate: string, vehicleClass: string, packageId: string) => void;
}) {
  return <article className="card">
    <h3>{arrival.confirmedPlate ?? arrival.plateCandidate ?? 'Unreadable plate'}</h3>
    <p>{arrival.cameraId} · {new Date(arrival.receivedAt).toLocaleString()}</p>
    {editable && catalog && <form onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const plate = String(data.get('plate') ?? '').trim();
      if (plate) open(plate, String(data.get('vehicleClass')), String(data.get('packageId')));
    }}>
      <label>Plate <input name="plate" required defaultValue={arrival.confirmedPlate ?? arrival.plateCandidate ?? ''} readOnly={!!arrival.confirmedPlate} /></label>
      <label>Vehicle class <select name="vehicleClass" defaultValue={arrival.vehicleClass ?? catalog.vehicleClasses[0].id}>
        {catalog.vehicleClasses.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>)}
      </select></label>
      <label>Package <select name="packageId">
        {catalog.packages.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <button disabled={busy}>Open job</button>
    </form>}
  </article>;
}
