import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, errorText, fetchAll } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../hooks/useApi";
import { loadHistory } from "../lib/history";
import { hoursToMinutes, instant, kes, nairobiDate, nairobiTime, slot, vehicleLabel } from "../lib/format";
import Card from "../components/Card";
import Async from "../components/Async";

export function CustomerDashboard() {
  const vehicles = useApi(() => fetchAll("/vehicles"));
  const upcoming = useApi(() =>
    api("/bookings", { query: { from: instant(new Date()), page_size: 50 } })
      .then((r) => r.items.filter((b) => ["PENDING", "CONFIRMED"].includes(b.status)).slice(0, 3)));
  const history = useApi(() => loadHistory().then((h) => h.slice(0, 2)));

  return (
    <>
      <h2>Customer Dashboard</h2>
      <div className="grid3">
        <Card title="Your Vehicles">
          <Async q={vehicles}>{(rows) => (
            <table><thead><tr><th>Make</th><th>Model</th><th>Number Plate</th></tr></thead>
              <tbody>{rows.map((v) => <tr key={v.vehicle_id}><td>{v.make}</td><td>{v.model}</td><td>{v.registration_no}</td></tr>)}</tbody></table>
          )}</Async>
          <Link className="btn" to="/customer/vehicles">Manage Vehicles</Link>
        </Card>
        <Card title="Upcoming Appointments">
          <Async q={upcoming}>{(rows) => (
            <table><thead><tr><th>Date</th><th>Time</th><th>Status</th></tr></thead>
              <tbody>{rows.map((b) => <tr key={b.booking_id}><td>{nairobiDate(b.scheduled_at)}</td><td>{nairobiTime(b.scheduled_at)}</td><td>{b.status}</td></tr>)}</tbody></table>
          )}</Async>
          <Link className="btn" to="/customer/book">Book Appointment</Link>
        </Card>
        <Card title="Service History Summary">
          <Async q={history}>{(rows) => (
            <table><thead><tr><th>Date</th><th>Service</th><th>Cost</th></tr></thead>
              <tbody>{rows.map((h) => <tr key={h.id}><td>{nairobiDate(h.date)}</td><td>{h.service}</td><td>{kes(h.cost)}</td></tr>)}</tbody></table>
          )}</Async>
          <Link className="btn" to="/customer/history">View Service History</Link>
        </Card>
      </div>
    </>
  );
}

const emptyVehicle = { make: "", model: "", year: "", registration_no: "" };

export function ManageVehicles() {
  const { user } = useAuth();
  const list = useApi(() => fetchAll("/vehicles"));
  const [f, setF] = useState(emptyVehicle); // f.vehicle_id is set while editing
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setError("");
    const data = { registration_no: f.registration_no, make: f.make || null, model: f.model || null, year: f.year ? Number(f.year) : null };
    try {
      if (f.vehicle_id) await api(`/vehicles/${f.vehicle_id}`, { method: "PATCH", body: data });
      else await api("/vehicles", { method: "POST", body: { ...data, customer_id: user.customer_id } });
      setF(emptyVehicle); list.reload();
    } catch (err) { setError(errorText(err)); }
  };
  const remove = async (v) => {
    if (!window.confirm(`Remove ${v.registration_no}?`)) return;
    try { await api(`/vehicles/${v.vehicle_id}`, { method: "DELETE" }); list.reload(); }
    catch (err) { setError(errorText(err)); } // 409 if the vehicle has bookings/jobs
  };

  return (
    <>
      <h2>Manage Your Vehicles</h2>
      <Card title={f.vehicle_id ? "Edit Vehicle" : "Add New Vehicle"}>
        <form onSubmit={submit}>
          <input placeholder="Make" value={f.make} onChange={set("make")} />
          <input placeholder="Model" value={f.model} onChange={set("model")} />
          <input type="number" min="1886" max="2100" placeholder="Year" value={f.year} onChange={set("year")} />
          <input required placeholder="Number Plate" value={f.registration_no} onChange={set("registration_no")} />
          {error && <p className="error">{error}</p>}
          <button className="btn block">{f.vehicle_id ? "Save Vehicle" : "Add Vehicle"}</button>
          {f.vehicle_id && <button type="button" className="btn secondary block" onClick={() => setF(emptyVehicle)}>Cancel edit</button>}
        </form>
      </Card>
      <Card title="Your Registered Vehicles">
        <Async q={list}>{(rows) => (
          <table><thead><tr><th>Make</th><th>Model</th><th>Year</th><th>Number Plate</th><th>Actions</th></tr></thead>
            <tbody>{rows.map((v) => (
              <tr key={v.vehicle_id}><td>{v.make}</td><td>{v.model}</td><td>{v.year}</td><td>{v.registration_no}</td>
                <td><button className="btn sm" onClick={() => setF({ ...v, make: v.make ?? "", model: v.model ?? "", year: v.year ?? "" })}>Edit</button>{" "}
                  <button className="btn sm danger" onClick={() => remove(v)}>Remove</button></td></tr>
            ))}</tbody></table>
        )}</Async>
      </Card>
      <Link to="/customer">← Back to Dashboard</Link>
    </>
  );
}

export function BookAppointment() {
  const navigate = useNavigate();
  const data = useApi(async () => ({ vehicles: await fetchAll("/vehicles"), services: await fetchAll("/service-tasks") }));
  const [f, setF] = useState({ vehicle_id: "", service_task_id: "", date: "", time: "" });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setError("");
    // A booking stores only vehicle + time interval, so the chosen service sets the estimated duration
    const svc = data.data.services.find((s) => String(s.service_task_id) === f.service_task_id);
    const minutes = hoursToMinutes(svc?.standard_hours);
    try {
      await api("/bookings", { method: "POST", body: { vehicle_id: Number(f.vehicle_id), ...slot(f.date, f.time, minutes) } });
      navigate("/customer");
    } catch (err) { setError(errorText(err)); } // e.g. BOOKING_CONFLICT, outside opening hours
  };

  return (
    <Async q={data}>{({ vehicles, services }) => (
      <form onSubmit={submit}>
        <h2>Book Appointment</h2>
        <label>Vehicle:</label>
        <select required value={f.vehicle_id} onChange={set("vehicle_id")}>
          <option value="">Select a vehicle</option>
          {vehicles.map((v) => <option key={v.vehicle_id} value={v.vehicle_id}>{vehicleLabel(v)}</option>)}
        </select>
        <label>Service Type (sets the estimated duration):</label>
        <select value={f.service_task_id} onChange={set("service_task_id")}>
          <option value="">Select a service</option>
          {services.map((s) => <option key={s.service_task_id} value={s.service_task_id}>{s.name}</option>)}
        </select>
        <label>Appointment Date:</label>
        <input required type="date" min={new Date().toISOString().slice(0, 10)} value={f.date} onChange={set("date")} />
        <label>Preferred Time (Nairobi time):</label>
        <input required type="time" value={f.time} onChange={set("time")} />
        {error && <p className="error">{error}</p>}
        <button className="btn block">Book Appointment</button>
      </form>
    )}</Async>
  );
}

export function ServiceHistory() {
  const q = useApi(loadHistory);
  return (
    <>
      <div className="row"><h2>Service History</h2><Link className="btn secondary" to="/customer">Back to Dashboard</Link></div>
      <Async q={q}>{(rows) => (
        <table><thead><tr><th>Vehicle</th><th>Service Type</th><th>Date</th><th>Cost</th><th>Payment</th></tr></thead>
          <tbody>{rows.map((h) => (
            <tr key={h.id}><td>{h.vehicle}</td><td>{h.service}</td><td>{nairobiDate(h.date)}</td><td>{kes(h.cost)}</td>
              <td>{h.payment === "PAID" ? "Paid" : `${h.payment.replace("_", " ")} (due ${kes(h.balance)})`}</td></tr>
          ))}</tbody></table>
      )}</Async>
    </>
  );
}
