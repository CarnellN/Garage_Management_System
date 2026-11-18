import { Link, Navigate, Outlet, useNavigate } from "react-router-dom";
import { PORTAL_ROLES, useAuth } from "../lib/auth";

const NAV = {
  customer: [["Dashboard", "/customer"], ["Vehicles", "/customer/vehicles"], ["Appointments", "/customer/book"], ["History", "/customer/history"]],
  admin: [["Dashboard", "/admin"], ["Appointments", "/admin/appointments"], ["Customers", "/admin/customers"], ["Services", "/admin/services"]],
};

export function PortalLayout({ role }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user || !PORTAL_ROLES[role].includes(user.role)) return <Navigate to={`/${role}-login`} replace />;

  return (
    <div className={`app ${role}`}>
      <header>
        <h1>Garage Management System - {role === "admin" ? "Admin" : "Customer"}</h1>
        <nav>
          {NAV[role].map(([label, to]) => <Link key={to} to={to}>{label}</Link>)}
          <a href="#logout" onClick={async (e) => { e.preventDefault(); await logout(); navigate("/"); }}>Logout</a>
        </nav>
      </header>
      <main><Outlet /></main>
      <footer>© 2026 Garage Management System</footer>
    </div>
  );
}
