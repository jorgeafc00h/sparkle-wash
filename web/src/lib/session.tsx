import { createContext, useContext, type ReactNode } from "react";
import type { Role, Session } from "./types";

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ session, children }: { session: Session | null; children: ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);

/** What the signed-in role may do. While the session loads, nothing is allowed (buttons stay hidden, not flicker). */
export function usePermissions() {
  const role: Role | undefined = useSession()?.role;
  return { canOperate: role === "operator" || role === "admin", isAdmin: role === "admin", role };
}
