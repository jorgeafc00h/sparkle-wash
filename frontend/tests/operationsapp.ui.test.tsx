import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OperationsApp from '../src/OperationsApp.tsx';

const summary = {
  total: 0, arrived: 0, queued: 0, inProgress: 0, completed: 0, cancelled: 0,
  arrivalsTodayUtc: 0, completedTodayUtc: 0, averageCompletedSeconds: null,
};

describe('staff workboard', () => {
  let credential: (reply: { credential: string }) => void;
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test.apps.googleusercontent.com');
    vi.stubGlobal('google', { accounts: { id: {
      initialize: vi.fn(options => { credential = options.callback; }),
      renderButton: vi.fn(),
      disableAutoSelect: vi.fn(),
    } } });
    request = vi.fn(async (path: string, options?: RequestInit) => {
      if (path === '/api/auth/google') return Response.json({ sessionToken: 'staff-session', role: 'operator' });
      if (path === '/api/auth/session' && options?.method === 'DELETE') return Response.json({ ok: true });
      if (path === '/api/packages') return new Response(null, { status: 503 });
      return Response.json(path === '/api/jobs/summary' ? summary : []);
    });
    vi.stubGlobal('fetch', request);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function signIn() {
    render(<OperationsApp />);
    await act(async () => credential({ credential: 'google-token' }));
  }

  test('exchanges the Google credential and loads the workboard with the returned token', async () => {
    await signIn();
    expect(request).toHaveBeenCalledWith('/api/auth/google', expect.objectContaining({
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'google-token' }),
    }));
    expect(await screen.findByRole('heading', { name: 'Whole-carwash jobs' })).toBeTruthy();
    expect(screen.getByText('operator')).toBeTruthy();
    expect(request).toHaveBeenCalledWith('/api/jobs', expect.objectContaining({
      headers: { Authorization: 'Bearer staff-session' },
    }));
  });

  test('clears the staff data and revokes the session on sign-out', async () => {
    await signIn();
    await screen.findByRole('heading', { name: 'Whole-carwash jobs' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('heading', { name: 'Staff access' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Whole-carwash jobs' })).toBeNull();
    expect(request).toHaveBeenCalledWith('/api/auth/session', expect.objectContaining({ method: 'DELETE' }));
  });

  test('keeps staff data hidden when the API rejects sign-in', async () => {
    request.mockImplementation(async () => new Response(null, { status: 401 }));
    await signIn();
    expect(await screen.findByText('This account does not have staff access.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Whole-carwash jobs' })).toBeNull();
  });

  test('rejects a malformed session response', async () => {
    request.mockImplementation(async () => Response.json({ role: 'operator' }));
    await signIn();
    expect(await screen.findByText('Session is missing required fields')).toBeTruthy();
    expect(request.mock.calls.some(([path]) => path === '/api/jobs')).toBe(false);
  });

  test('shows an error when operations cannot be loaded', async () => {
    request.mockImplementation(async (path: string) => path === '/api/auth/google'
      ? Response.json({ sessionToken: 'staff-session', role: 'viewer' })
      : new Response(null, { status: 500 }));
    await signIn();
    expect(await screen.findByText('Could not refresh operations.')).toBeTruthy();
    expect(screen.getByText('viewer')).toBeTruthy();
  });

  test('returns to staff sign-in when the server rejects the session', async () => {
    request.mockImplementation(async (path: string) => path === '/api/auth/google'
      ? Response.json({ sessionToken: 'staff-session', role: 'operator' })
      : new Response(null, { status: 401 }));
    await signIn();
    await waitFor(() => expect(screen.getByText('Session expired. Sign in again.')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Staff access' })).toBeTruthy();
  });

  test('shows setup guidance when the Google client ID is absent', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    render(<OperationsApp />);
    expect(screen.getByText('Google sign-in is not configured.')).toBeTruthy();
  });
});
