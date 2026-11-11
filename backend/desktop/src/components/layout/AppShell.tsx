import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useAppSelector } from '@/store';
import { selectShouldShowMainApp } from '@/store/selectors/authSelectors';
import { selectIsLocalSessionLocked, selectPermissionSubject } from '@/store/selectors/localUsersSelectors';
import { canAccessPath, firstAllowedRoute } from '@/services/localUsers/permissions';
import { LocalUserLockScreen } from '@/components/localUsers/LocalUserLockScreen';
import { AccessDenied } from '@/components/localUsers/AccessDenied';

export function AppShell() {
  const shouldShowMainApp = useAppSelector(selectShouldShowMainApp);
  const isLocked = useAppSelector(selectIsLocalSessionLocked);
  const permissionSubject = useAppSelector(selectPermissionSubject);
  const location = useLocation();

  if (!shouldShowMainApp) {
    return <Navigate to="/welcome" replace state={{ from: location.pathname }} />;
  }

  // Local user control: nobody works until someone unlocks with their PIN.
  if (isLocked) {
    return <LocalUserLockScreen />;
  }

  let content = <Outlet />;
  if (!canAccessPath(permissionSubject, location.pathname)) {
    // The home screen is just the default landing — send restricted users to
    // their first permitted screen instead of a "denied" page.
    const landing = firstAllowedRoute(permissionSubject);
    if ((location.pathname === '/home' || location.pathname === '/') && landing && landing !== location.pathname) {
      return <Navigate to={landing} replace />;
    }
    content = <AccessDenied />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-brand-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        {content}
      </main>
    </div>
  );
}
