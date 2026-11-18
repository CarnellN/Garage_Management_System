import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { errorText } from "../lib/api";

export function Welcome() {
  return (
    <div className="center-box">
      <h2 className="left">Welcome to Garage Management System</h2>
      <Link className="btn block" to="/customer-login">Customer Portal</Link>
      <Link className="btn block" to="/admin-login">Admin Portal</Link>
      <Link className="btn secondary block" to="/register">Register New Customer</Link>
    </div>
  );
}

export function Login({ role }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      await login(f.email, f.password, role);
      navigate(`/${role}`);
    } catch (err) {
      setError(errorText(err));
    } finally { setBusy(false); }
  };

  return (
    <form className="center-box" onSubmit={submit}>
      <h2>{role === "admin" ? "Admin" : "Customer"} Login</h2>
      <input type="email" required placeholder="Enter email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <input type="password" required placeholder="Enter password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      {error && <p className="error">{error}</p>}
      <button className="btn block" disabled={busy}>{busy ? "Logging in…" : "Login"}</button>
      {role === "customer" && <p>Don't have an account? <Link to="/register">Register here</Link></p>}
      <Link className="btn secondary block" to="/">← Back to portal selection</Link>
    </form>
  );
}

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (f.password.length < 12) return setError("Password must be at least 12 characters.");
    if (f.password !== f.confirm) return setError("Passwords do not match.");
    setError(""); setBusy(true);
    try {
      await register({ name: f.name.trim(), email: f.email, password: f.password });
      navigate("/customer");
    } catch (err) {
      setError(errorText(err));
    } finally { setBusy(false); }
  };

  return (
    <form className="center-box" onSubmit={submit}>
      <h2>Customer Registration</h2>
      <input required placeholder="Full Name" value={f.name} onChange={set("name")} />
      <input required type="email" placeholder="Email" value={f.email} onChange={set("email")} />
      <input required type="password" placeholder="Password (min 12 characters)" value={f.password} onChange={set("password")} />
      <input required type="password" placeholder="Confirm Password" value={f.confirm} onChange={set("confirm")} />
      {error && <p className="error">{error}</p>}
      <button className="btn block" disabled={busy}>{busy ? "Creating account…" : "Complete Registration"}</button>
      <Link className="btn secondary block" to="/">← Back to portal selection</Link>
    </form>
  );
}
