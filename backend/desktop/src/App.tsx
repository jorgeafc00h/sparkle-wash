import { useEffect } from 'react';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { RouterProvider } from 'react-router-dom';
import { ThreeDSChallengeModal } from '@/components/modals/ThreeDSChallengeModal';
import { GoogleSignInPendingDialog } from '@/components/auth/GoogleSignInPendingDialog';
import { StorageWriteFailureBanner } from '@/components/common/StorageWriteFailureBanner';
import { store, persistor, useAppDispatch, useAppSelector } from './store';
import { router } from './routes';
import { ToastProvider } from './components/common/Toast';
import { TelemetryService } from './services/telemetry/TelemetryService';
import { LocalLogger } from './services/logging/LocalLogger';
import { initializeSubscription } from './store/slices/subscriptionSlice';
import AuthProviderService from './services/auth/AuthProviderService';
import { setAuthenticatedUser } from './store/slices/authSlice';
import { setIsUITesting } from './store/slices/appSlice';
import { initCarwash } from './store/slices/carwashSlice';
import { useSyncV2Lifecycle } from './hooks/useSyncV2';

function AppLoading() {
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16, background: '#f8fafc',
    }}>
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none"
        style={{ animation: 'spin 0.8s linear infinite' }}
        xmlns="http://www.w3.org/2000/svg">
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <circle cx="18" cy="18" r="15" stroke="#e2e8f0" strokeWidth="3"/>
        <path d="M18 3 A15 15 0 0 1 33 18" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round"/>
      </svg>
      <p style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif", fontSize: 14, color: '#64748b', margin: 0 }}>
        Car Spa
      </p>
    </div>
  );
}

function AppWithTelemetry() {
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
  const isGuestMode = useAppSelector((s) => s.auth.isGuestMode);
  const authUserId = useAppSelector((s) => s.auth.user?.id ?? null);
  const authToken = useAppSelector((s) => s.auth.token);
  // Device Sync v2 session lifecycle (gated to Pro+Sync/Enterprise).
  useSyncV2Lifecycle();

  useEffect(() => {
    // main.cjs forwards the --uitesting launch arg as ?uitesting=1 so UI-test
    // runs disable telemetry (and ad eligibility) without touching app state files.
    if (new URLSearchParams(window.location.search).get('uitesting') === '1') {
      dispatch(setIsUITesting(true));
    }
    const state = store.getState();
    const isUITesting = state.app.isUITesting;
    TelemetryService.initialize(import.meta.env.PROD, isUITesting);

    // Initialize local file logger (no-op in web/test mode)
    LocalLogger.initialize();

    // Capture unhandled promise rejections for local debugging
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      LocalLogger.error('app', 'Unhandled promise rejection', event.reason);
    };
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => window.removeEventListener('unhandledrejection', onUnhandledRejection);
  }, []);

  // SparkleWash: load settings/session and start the sync service in the background.
  useEffect(() => {
    void dispatch(initCarwash());
  }, [dispatch]);

  useEffect(() => {
    if (!isAuthenticated && !isGuestMode) return;
    void dispatch(initializeSubscription());
  }, [authToken, authUserId, dispatch, isAuthenticated, isGuestMode]);

  useEffect(() => {
    if (!isAuthenticated || authToken) return;

    let cancelled = false;
    void AuthProviderService.getSession().then((session) => {
      if (cancelled || !session) return;
      dispatch(setAuthenticatedUser({
        user: session.user,
        accessToken: session.token,
        refreshToken: session.refreshToken ?? undefined,
        linkedProviders: session.linkedProviders,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [authToken, dispatch, isAuthenticated]);

  useEffect(() => {
    const onFocus = () => {
      const state = store.getState();
      if (!state.auth.isAuthenticated && !state.auth.isGuestMode) return;
      void dispatch(initializeSubscription());
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onFocus();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [dispatch]);

  return (
    <ToastProvider>
      <RouterProvider router={router} />
      <ThreeDSChallengeModal />
      <GoogleSignInPendingDialog />
      <StorageWriteFailureBanner />
    </ToastProvider>
  );
}

export default function App() {
  return (
    <Provider store={store}>
      <PersistGate loading={<AppLoading />} persistor={persistor}>
        <AppWithTelemetry />
      </PersistGate>
    </Provider>
  );
}
