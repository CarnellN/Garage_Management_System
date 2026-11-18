import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorText, fetchAll } from "../lib/api";
import { useApi } from "../hooks/useApi";
import { dayRange, minutesBetween, nairobiDate, nairobiTime, slot, vehicleLabel } from "../lib/format";
import Card from "../components/Card";
import Async from "../components/Async";

export function AdminDashboard() {
  const items = [
    ["Manage Appointments", "View, add, and update appointments.", "Go to Appointments", "/admin/appointments"],
    ["Manage Customers", "View and manage customer accounts.", "Go to Customers", "/admin/customers"],
    ["Manage Services", "Add and modify available services.", "Go to Services", "/admin/services"],
  ];
  return (
    <>
      <h2>Admin Dashboard</h2>
      <div className="grid3">
        {items.map(([title, text, btn, to]) => (
          <Card key={to}><div className="tc"><h3>{title}</h3><p>{text}</p><Link className="btn" to={to}>{btn}</Link></div></Card>
        ))}
      </div>
    </>
  );
}

/* ---------- Appointments (bookings) ---------- */

// A booking only has vehicle_id, so we join vehicles and customers to show names
async function loadAppointments({ status, date }) {
  const query = { status, ...(date ? dayRange(date) : {}) };
  const [bookings, vehicles, customers] = await Promise.all([
    fetchAll("/bookings", query), fetchAll("/vehicles"), fetchAll("/customers"),
  ]);
  const car = new Map(vehicles.map((v) => [v.vehicle_id, v]));
  const cust = new Map(customers.map((c) => [c.customer_id, c]));
  return {
    vehicles: vehicles.map((v) => ({ ...v, owner: cust.get(v.customer_id)?.name })),
    rows: bookings.map((b) => ({ ...b, vehicle: car.get(b.vehicle_id), customer: cust.get(car.get(b.vehicle_id)?.customer_id) })),
  };
}

const emptyBooking = { vehicle_id: "", date: "", time: "", duration: "60" };
const STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW"];

export function AdminAppointments() {
  const [filters, setFilters] = useState({ name: "", status: "", date: "" });
  const [applied, setApplied] = useState(filters);
  const q = useApi(() => loadAppointments(applied), [applied]);
  const [form, setForm] = useState(null); // null = hidden; booking_id present = rescheduling
  const [msg, setMsg] = useState("");
  const setF = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const run = async (fn) => {
    setMsg("");
    try { await fn(); setForm(null); q.reload(); } catch (err) { setMsg(errorText(err)); }
  };
  // Changing a booking needs If-Match with its current version
  const ifMatch = (b) => ({ "If-Match": `"${b.version}"` });
  const setStatus = (b, status) =>
    run(() => api(`/bookings/${b.booking_id}/status`, { method: "PATCH", body: { status }, headers: ifMatch(b) }));
  const submit = (e) => {
    e.preventDefault();
    const t = slot(form.date, form.time, Number(form.duration));
    run(() => form.booking_id
      ? api(`/bookings/${form.booking_id}`, { method: "PATCH", body: t, headers: { "If-Match": `"${form.version}"` } })
      : api("/bookings", { method: "POST", body: { vehicle_id: Number(form.vehicle_id), ...t } }));
  };
  const editBooking = (b) => setForm({
    booking_id: b.booking_id, version: b.version,
    date: nairobiDate(b.scheduled_at), time: nairobiTime(b.scheduled_at),
    duration: String(minutesBetween(b.scheduled_at, b.ends_at)),
  });

  return (
    <>
      <div className="row"><h2>Appointment Management</h2>
        <button className="btn" onClick={() => setForm(emptyBooking)}>+ Schedule New Appointment</button></div>
      {msg && <p className="error">{msg}</p>}

      <Card title="Filter Appointments">
        <div className="filters">
          <div><label>Customer Name</label>
            <input placeholder="Enter customer name" value={filters.name} onChange={(e) => setFilters({ ...filters, name: e.target.value })} /></div>
          <div><label>Status</label>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select></div>
          <div><label>Appointment Date</label>
            <input type="date" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} /></div>
          <button className="btn secondary" onClick={() => setApplied(filters)}>Apply Filters</button>
        </div>
      </Card>

      <Async q={q}>{({ vehicles, rows }) => (
        <>
          {form && (
            <Card title={form.booking_id ? `Reschedule appointment ${form.booking_id}` : "Schedule New Appointment"}>
              <form onSubmit={submit}>
                {!form.booking_id && (
                  <select required value={form.vehicle_id} onChange={setF("vehicle_id")}>
                    <option value="">Select a vehicle</option>
                    {vehicles.map((v) => <option key={v.vehicle_id} value={v.vehicle_id}>{vehicleLabel(v)} - {v.owner}</option>)}
                  </select>
                )}
                <input required type="date" value={form.date} onChange={setF("date")} />
                <input required type="time" value={form.time} onChange={setF("time")} />
                <input required type="number" min="15" max="480" step="15" placeholder="Duration (minutes)" value={form.duration} onChange={setF("duration")} />
                <button className="btn">Save Appointment</button>{" "}
                <button type="button" className="btn secondary" onClick={() => setForm(null)}>Cancel</button>
              </form>
            </Card>
          )}
          <Card title="All Appointments">
            <table><thead><tr><th>Appointment ID</th><th>Customer Name</th><th>Vehicle</th><th>Date</th><th>Time</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>{rows
                .filter((r) => (r.customer?.name || "").toLowerCase().includes(applied.name.toLowerCase()))
                .map((b) => {
                  const open = ["PENDING", "CONFIRMED"].includes(b.status);
                  return (
                    <tr key={b.booking_id}><td>APP{String(b.booking_id).padStart(3, "0")}</td><td>{b.customer?.name ?? "-"}</td>
                      <td>{vehicleLabel(b.vehicle)}</td><td>{nairobiDate(b.scheduled_at)}</td><td>{nairobiTime(b.scheduled_at)}</td><td>{b.status}</td>
                      <td>
                        {b.status === "PENDING" && <button className="btn sm" onClick={() => setStatus(b, "CONFIRMED")}>Confirm</button>}{" "}
                        {open && <button className="btn sm secondary" onClick={() => editBooking(b)}>Reschedule</button>}{" "}
                        {open && <button className="btn sm danger" onClick={() => window.confirm("Cancel this appointment?") && setStatus(b, "CANCELLED")}>Cancel</button>}
                      </td></tr>
                  );
                })}</tbody></table>
            {rows.length === 0 && <p>No appointments match these filters.</p>}
          </Card>
        </>
      )}</Async>
      <Link to="/admin">← Back to Dashboard</Link>
    </>
  );
}

/* ---------- Customers ---------- */

const emptyCustomer = { name: "", email: "", phone: "" };
const PAGE = 20;

export function AdminCustomers() {
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const q = useApi(() => api("/customers", { query: { search: applied, page, page_size: PAGE } }), [applied, page]);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setMsg("");
    const body = { name: form.name, email: form.email || null, phone: form.phone || null };
    try {
      if (form.customer_id) await api(`/customers/${form.customer_id}`, { method: "PATCH", body });
      else await api("/customers", { method: "POST", body });
      setForm(null); q.reload();
    } catch (err) { setMsg(errorText(err)); }
  };

  return (
    <>
      <div className="row"><h2>Manage Customers</h2>
        <button className="btn" onClick={() => setForm(emptyCustomer)}>Add New Customer</button></div>
      {form && (
        <Card title={form.customer_id ? "Edit Customer" : "Add New Customer"}>
          <form onSubmit={submit}>
            <input required placeholder="Full name" value={form.name} onChange={set("name")} />
            <input type="email" placeholder="Email" value={form.email} onChange={set("email")} />
            <input placeholder="Phone" value={form.phone} onChange={set("phone")} />
            {msg && <p className="error">{msg}</p>}
            <button className="btn">Save Customer</button>{" "}
            <button type="button" className="btn secondary" onClick={() => setForm(null)}>Cancel</button>
          </form>
        </Card>
      )}
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setApplied(search); setPage(1); }}>
        <input placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn secondary">Search</button>
      </form>
      <Async q={q}>{({ items, pagination }) => (
        <>
          <table><thead><tr><th>Customer Name</th><th>Email</th><th>Phone</th><th>Actions</th></tr></thead>
            <tbody>{items.map((c) => (
              <tr key={c.customer_id}><td>{c.name}</td><td>{c.email}</td><td>{c.phone}</td>
                <td><button className="btn sm" onClick={() => setForm({ ...c, email: c.email ?? "", phone: c.phone ?? "" })}>Edit</button></td></tr>
            ))}</tbody></table>
          <div className="row">
            <button className="btn secondary sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page} of {Math.max(1, Math.ceil(pagination.total / PAGE))}</span>
            <button className="btn secondary sm" disabled={page * PAGE >= pagination.total} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </>
      )}</Async>
      <p><Link to="/admin">Back to Dashboard</Link></p>
    </>
  );
}

/* ---------- Services (service-task templates) ---------- */

const emptyService = { name: "", standard_hours: "" };

export function AdminServices() {
  const q = useApi(() => fetchAll("/service-tasks"));
  const [f, setF] = useState(emptyService);
  const [msg, setMsg] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const run = async (fn) => { setMsg(""); try { await fn(); setF(emptyService); q.reload(); } catch (err) { setMsg(errorText(err)); } };
  const submit = (e) => {
    e.preventDefault();
    const body = { name: f.name, standard_hours: f.standard_hours === "" ? null : Number(f.standard_hours).toFixed(2) };
    run(() => f.service_task_id
      ? api(`/service-tasks/${f.service_task_id}`, { method: "PATCH", body })
      : api("/service-tasks", { method: "POST", body }));
  };

  return (
    <>
      <div className="row"><h2>Service Management</h2>
        <button className="btn" onClick={() => setF(emptyService)}>Add New Service</button></div>
      <Card title="Add/Edit Service">
        <form onSubmit={submit}>
          <input required placeholder="Service Name" value={f.name} onChange={set("name")} />
          <input type="number" min="0" step="0.25" placeholder="Standard hours (e.g. 1.5)" value={f.standard_hours} onChange={set("standard_hours")} />
          {msg && <p className="error">{msg}</p>}
          <button className="btn">Save Service</button>
        </form>
      </Card>
      <Card title="Existing Services">
        <Async q={q}>{(rows) => (
          <table><thead><tr><th>Service Name</th><th>Standard Hours</th><th>Actions</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.service_task_id}><td>{s.name}</td><td>{s.standard_hours ?? "-"}</td>
                <td><button className="btn sm secondary" onClick={() => setF({ ...s, standard_hours: s.standard_hours ?? "" })}>Edit</button>{" "}
                  <button className="btn sm danger" onClick={() => window.confirm(`Delete ${s.name}?`) && run(() => api(`/service-tasks/${s.service_task_id}`, { method: "DELETE" }))}>Delete</button></td></tr>
            ))}</tbody></table>
        )}</Async>
      </Card>
    </>
  );
}
