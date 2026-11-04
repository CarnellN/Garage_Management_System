import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "../lib/store";

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
  const { setRole } = useStore();
  const navigate = useNavigate();
  const [f, setF] = useState({ email: "", password: "" });
  const submit = (e) => {
    e.preventDefault();
    // Demo only: replace with a real API call
    setRole(role);
    navigate(`/${role}`);
  };
  return (
    <form className="center-box" onSubmit={submit}>
      <h2>{role === "admin" ? "Admin" : "Customer"} Login</h2>
      <input type="email" required placeholder="Enter email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <input type="password" required placeholder="Enter password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      <button className="btn block">Login</button>
      {role === "customer" && <p>Don't have an account? <Link to="/register">Register here</Link></p>}
    </form>
  );
}

export function Register() {
  const { saveCustomer } = useStore();
  const navigate = useNavigate();
  const [f, setF] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setError("Passwords do not match.");
    saveCustomer({ name: f.name, email: f.email, phone: "", registered: new Date().toISOString().slice(0, 10) });
    navigate("/customer-login");
  };
  return (
    <form className="center-box" onSubmit={submit}>
      <h2>Customer Registration</h2>
      <input required placeholder="Full Name" value={f.name} onChange={set("name")} />
      <input required type="email" placeholder="Email" value={f.email} onChange={set("email")} />
      <input required type="password" placeholder="Password" value={f.password} onChange={set("password")} />
      <input required type="password" placeholder="Confirm Password" value={f.confirm} onChange={set("confirm")} />
      {error && <p className="error">{error}</p>}
      <button className="btn block">Complete Registration</button>
    </form>
  );
}
