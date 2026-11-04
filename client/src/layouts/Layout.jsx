import { Link, Navigate, Outlet, useNavigate } from "react-router-dom";
import { useStore } from "../lib/store";

const NAV = {
  customer: [["Dashboard", "/customer"], ["Vehicles", "/customer/vehicles"], ["Appointments", "/customer/book"], ["History", "/customer/history"]],
  admin: [["Dashboard", "/admin"], ["Appointments", "/admin/appointments"], ["Customers", "/admin/customers"], ["Services", "/admin/services"]],
};

export function Card({ title, children }) {
  return <section className="card">{title && <h3>{title}</h3>}{children}</section>;
}

// Wraps all pages of one role: header + page + footer, and blocks access if not logged in
export function PortalLayout({ role }) {
  const { role: current, setRole } = useStore();
  const navigate = useNavigate();
  if (current !== role) return <Navigate to={`/${role}-login`} replace />;
  const logout = () => { setRole(null); navigate("/"); };
  return (
    <div className={`app ${role}`}>
      <header>
        <h1>Garage Management System - {role === "admin" ? "Admin" : "Customer"}</h1>
        <nav>
          {NAV[role].map(([label, to]) => <Link key={to} to={to}>{label}</Link>)}
          <a href="#logout" onClick={(e) => { e.preventDefault(); logout(); }}>Logout</a>
        </nav>
      </header>
      <main><Outlet /></main>
      <footer>© 2026 Garage Management System</footer>
    </div>
  );
}

export const kes = (n) => `KES ${Number(n).toLocaleString()}`;
