import { createContext, useContext, useEffect, useState } from "react";
import { api, session } from "./api";

const Ctx = createContext();
export const useAuth = () => useContext(Ctx);

// Which backend roles may use which portal
export const PORTAL_ROLES = { customer: ["CUSTOMER"], admin: ["ADMIN", "RECEPTIONIST"] };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => session.get()?.user ?? null);

  useEffect(() => {
    const expired = () => setUser(null);
    window.addEventListener("auth-expired", expired);
    return () => window.removeEventListener("auth-expired", expired);
  }, []);

  const start = (s) => { session.set(s); setUser(s.user); };

  const logout = async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch { /* already expired */ }
    session.clear();
    setUser(null);
  };

  const login = async (email, password, portal) => {
    const s = await api("/auth/login", { method: "POST", body: { email, password } });
    if (!PORTAL_ROLES[portal].includes(s.user.role)) {
      session.set(s);
      await logout();
      throw new Error(
        s.user.role === "MECHANIC"
          ? "Mechanic accounts are not supported in this app yet."
          : `This account cannot use the ${portal} portal.`
      );
    }
    start(s);
  };

  // Registration returns a session, so the new customer is logged in straight away
  const register = async (data) => start(await api("/auth/register", { method: "POST", body: data }));

  return <Ctx.Provider value={{ user, login, logout, register }}>{children}</Ctx.Provider>;
}
