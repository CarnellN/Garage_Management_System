import { useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../lib/store";
import { Card, kes } from "../layouts/Layout";

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

const emptyAppt = { customer: "", vehicle: "", service: "", date: "", time: "", status: "Scheduled" };

export function AdminAppointments() {
  const { appointments, services, saveAppointment, removeAppointment } = useStore();
  const [filters, setFilters] = useState({ name: "", service: "", date: "" });
  const [applied, setApplied] = useState(filters);
  const [form, setForm] = useState(null); // null = hidden
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const shown = appointments.filter((a) =>
    a.customer.toLowerCase().includes(applied.name.toLowerCase()) &&
    (!applied.service || a.service === applied.service) &&
    (!applied.date || a.date === applied.date));

  const submit = (e) => {
    e.preventDefault();
    saveAppointment({ ...form, code: form.code || `APP${String(appointments.length + 1).padStart(3, "0")}` });
    setForm(null);
  };

  return (
    <>
      <div className="row"><h2>Appointment Management</h2>
        <button className="btn" onClick={() => setForm(emptyAppt)}>+ Schedule New Appointment</button></div>

      {form && (
        <Card title={form.id ? "Edit Appointment" : "Schedule New Appointment"}>
          <form onSubmit={submit}>
            <input required placeholder="Customer name" value={form.customer} onChange={set("customer")} />
            <input required placeholder="Vehicle" value={form.vehicle} onChange={set("vehicle")} />
            <select required value={form.service} onChange={set("service")}>
              <option value="">Select a service</option>{services.map((s) => <option key={s.id}>{s.name}</option>)}
            </select>
            <input required type="date" value={form.date} onChange={set("date")} />
            <input required type="time" value={form.time} onChange={set("time")} />
            <select value={form.status} onChange={set("status")}>
              {["Scheduled", "Completed", "Cancelled"].map((s) => <option key={s}>{s}</option>)}
            </select>
            <button className="btn">Save Appointment</button>{" "}
            <button type="button" className="btn secondary" onClick={() => setForm(null)}>Cancel</button>
          </form>
        </Card>
      )}

      <Card title="Filter Appointments">
        <div className="filters">
          <div><label>Customer Name</label>
            <input placeholder="Enter customer name" value={filters.name} onChange={(e) => setFilters({ ...filters, name: e.target.value })} /></div>
          <div><label>Service Type</label>
            <select value={filters.service} onChange={(e) => setFilters({ ...filters, service: e.target.value })}>
              <option value="">Select a service</option>{services.map((s) => <option key={s.id}>{s.name}</option>)}
            </select></div>
          <div><label>Appointment Date</label>
            <input type="date" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} /></div>
          <button className="btn secondary" onClick={() => setApplied(filters)}>Apply Filters</button>
        </div>
      </Card>

      <Card title="All Appointments">
        <table><thead><tr><th>Appointment ID</th><th>Customer Name</th><th>Vehicle</th><th>Service Type</th><th>Date</th><th>Time</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{shown.map((a) => (
            <tr key={a.id}><td>{a.code}</td><td>{a.customer}</td><td>{a.vehicle}</td><td>{a.service}</td><td>{a.date}</td><td>{a.time}</td><td>{a.status}</td>
              <td><button className="btn sm" onClick={() => setForm(a)}>Edit</button>{" "}
                <button className="btn sm danger" onClick={() => removeAppointment(a.id)}>Delete</button></td></tr>
          ))}</tbody></table>
        {shown.length === 0 && <p>No appointments match these filters.</p>}
      </Card>
      <Link to="/admin">← Back to Dashboard</Link>
    </>
  );
}

const emptyCustomer = { name: "", email: "", phone: "", registered: new Date().toISOString().slice(0, 10) };

export function AdminCustomers() {
  const { customers, saveCustomer, removeCustomer } = useStore();
  const [q, setQ] = useState({ name: "", email: "" });
  const [applied, setApplied] = useState(q);
  const [form, setForm] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const shown = customers.filter((c) =>
    c.name.toLowerCase().includes(applied.name.toLowerCase()) && c.email.toLowerCase().includes(applied.email.toLowerCase()));
  return (
    <>
      <div className="row"><h2>Manage Customers</h2>
        <button className="btn" onClick={() => setForm(emptyCustomer)}>Add New Customer</button></div>
      {form && (
        <Card title={form.id ? "Edit Customer" : "Add New Customer"}>
          <form onSubmit={(e) => { e.preventDefault(); saveCustomer(form); setForm(null); }}>
            <input required placeholder="Full name" value={form.name} onChange={set("name")} />
            <input required type="email" placeholder="Email" value={form.email} onChange={set("email")} />
            <input required placeholder="Phone" value={form.phone} onChange={set("phone")} />
            <button className="btn">Save Customer</button>{" "}
            <button type="button" className="btn secondary" onClick={() => setForm(null)}>Cancel</button>
          </form>
        </Card>
      )}
      <div className="filters">
        <input placeholder="Search by Name" value={q.name} onChange={(e) => setQ({ ...q, name: e.target.value })} />
        <input placeholder="Search by Email" value={q.email} onChange={(e) => setQ({ ...q, email: e.target.value })} />
        <button className="btn secondary" onClick={() => setApplied(q)}>Search</button>
      </div>
      <table><thead><tr><th>Customer Name</th><th>Email</th><th>Phone</th><th>Registered Date</th><th>Actions</th></tr></thead>
        <tbody>{shown.map((c) => (
          <tr key={c.id}><td>{c.name}</td><td>{c.email}</td><td>{c.phone}</td><td>{c.registered}</td>
            <td><button className="btn sm" onClick={() => setForm(c)}>Edit</button>{" "}
              <button className="btn sm danger" onClick={() => removeCustomer(c.id)}>Delete</button></td></tr>
        ))}</tbody></table>
      <p><Link to="/admin">Back to Dashboard</Link></p>
    </>
  );
}

const emptyService = { name: "", description: "", price: "" };

export function AdminServices() {
  const { services, saveService, removeService } = useStore();
  const [f, setF] = useState(emptyService);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = (e) => { e.preventDefault(); saveService({ ...f, price: Number(f.price) }); setF(emptyService); };
  return (
    <>
      <div className="row"><h2>Service Management</h2>
        <button className="btn" onClick={() => setF(emptyService)}>Add New Service</button></div>
      <Card title="Add/Edit Service">
        <form onSubmit={submit}>
          <input required placeholder="Service Name" value={f.name} onChange={set("name")} />
          <textarea required rows="4" placeholder="Service Description" value={f.description} onChange={set("description")} />
          <input required type="number" min="0" placeholder="Price" value={f.price} onChange={set("price")} />
          <button className="btn">Save Service</button>
        </form>
      </Card>
      <Card title="Existing Services">
        <table><thead><tr><th>Service Name</th><th>Description</th><th>Price</th><th>Actions</th></tr></thead>
          <tbody>{services.map((s) => (
            <tr key={s.id}><td>{s.name}</td><td>{s.description}</td><td>{kes(s.price)}</td>
              <td><button className="btn sm secondary" onClick={() => setF(s)}>Edit</button>{" "}
                <button className="btn sm danger" onClick={() => removeService(s.id)}>Delete</button></td></tr>
          ))}</tbody></table>
      </Card>
    </>
  );
}
