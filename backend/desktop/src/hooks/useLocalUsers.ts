// Permission helpers for components. With user control off every check passes.

import { useMemo } from 'react';
import { useAppSelector } from '@/store';
import { selectPermissionSubject } from '@/store/selectors/localUsersSelectors';
import { canAccessPath, hasPermission } from '@/services/localUsers/permissions';
import type { ScreenPermission } from '@/types/localUsers';

/** Whether the current operator may use a screen/action. */
export function useCan(permission: ScreenPermission): boolean {
  const subject = useAppSelector(selectPermissionSubject);
  return hasPermission(subject, permission);
}

/** Stable predicate for checking several permissions/paths in one render. */
export function usePermissionCheck() {
  const subject = useAppSelector(selectPermissionSubject);
  return useMemo(
    () => ({
      can: (permission: ScreenPermission) => hasPermission(subject, permission),
      canOpen: (pathname: string) => canAccessPath(subject, pathname),
    }),
    [subject],
  );
}
