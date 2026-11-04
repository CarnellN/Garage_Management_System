import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "../lib/store";
import { Card, kes } from "../layouts/Layout";

export function CustomerDashboard() {
  const { vehicles, appointments, history } = useStore();
  const upcoming = appointments.filter((a) => a.status === "Scheduled");
  return (
    <>
      <h2>Customer Dashboard</h2>
      <div className="grid3">
        <Card title="Your Vehicles">
          <table><thead><tr><th>Make</th><th>Model</th><th>Number Plate</th></tr></thead>
            <tbody>{vehicles.map((v) => <tr key={v.id}><td>{v.make}</td><td>{v.model}</td><td>{v.plate}</td></tr>)}</tbody></table>
          <Link className="btn" to="/customer/vehicles">Manage Vehicles</Link>
        </Card>
        <Card title="Upcoming Appointments">
          <table><thead><tr><th>Date</th><th>Time</th><th>Service</th></tr></thead>
            <tbody>{upcoming.map((a) => <tr key={a.id}><td>{a.date}</td><td>{a.time}</td><td>{a.service}</td></tr>)}</tbody></table>
          <Link className="btn" to="/customer/book">Book Appointment</Link>
        </Card>
        <Card title="Service History Summary">
          <table><thead><tr><th>Date</th><th>Service</th><th>Cost</th></tr></thead>
            <tbody>{history.slice(0, 2).map((h) => <tr key={h.id}><td>{h.date}</td><td>{h.service}</td><td>{kes(h.cost)}</td></tr>)}</tbody></table>
          <Link className="btn" to="/customer/history">View Service History</Link>
        </Card>
      </div>
    </>
  );
}

const emptyVehicle = { make: "", model: "", year: "", plate: "" };

export function ManageVehicles() {
  const { vehicles, saveVehicle, removeVehicle } = useStore();
  const [f, setF] = useState(emptyVehicle); // f.id exists while editing
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = (e) => { e.preventDefault(); saveVehicle(f); setF(emptyVehicle); };
  return (
    <>
      <h2>Manage Your Vehicles</h2>
      <Card title={f.id ? "Edit Vehicle" : "Add New Vehicle"}>
        <form onSubmit={submit}>
          <input required placeholder="Make" value={f.make} onChange={set("make")} />
          <input required placeholder="Model" value={f.model} onChange={set("model")} />
          <input required placeholder="Year" value={f.year} onChange={set("year")} />
          <input required placeholder="Number Plate" value={f.plate} onChange={set("plate")} />
          <button className="btn block">{f.id ? "Save Vehicle" : "Add Vehicle"}</button>
        </form>
      </Card>
      <Card title="Your Registered Vehicles">
        <table><thead><tr><th>Make</th><th>Model</th><th>Year</th><th>Number Plate</th><th>Actions</th></tr></thead>
          <tbody>{vehicles.map((v) => (
            <tr key={v.id}><td>{v.make}</td><td>{v.model}</td><td>{v.year}</td><td>{v.plate}</td>
              <td><button className="btn sm" onClick={() => setF(v)}>Edit</button>{" "}
                <button className="btn sm danger" onClick={() => removeVehicle(v.id)}>Remove</button></td></tr>
          ))}</tbody></table>
      </Card>
      <Link to="/customer">← Back to Dashboard</Link>
    </>
  );
}

export function BookAppointment() {
  const { vehicles, services, saveAppointment, appointments } = useStore();
  const navigate = useNavigate();
  const [f, setF] = useState({ vehicle: "", service: "", date: "", time: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    saveAppointment({
      ...f, code: `APP${String(appointments.length + 1).padStart(3, "0")}`,
      customer: "Brian Otieno", // replace with the logged-in customer
      status: "Scheduled",
    });
    navigate("/customer");
  };
  return (
    <form onSubmit={submit}>
      <h2>Book Appointment</h2>
      <label>Vehicle:</label>
      <select required value={f.vehicle} onChange={set("vehicle")}>
        <option value="">Select a vehicle</option>
        {vehicles.map((v) => <option key={v.id} value={`${v.make} ${v.model}`}>{v.make} {v.model} ({v.plate})</option>)}
      </select>
      <label>Service Type:</label>
      <select required value={f.service} onChange={set("service")}>
        <option value="">Select a service</option>
        {services.map((s) => <option key={s.id}>{s.name}</option>)}
      </select>
      <label>Appointment Date:</label>
      <input required type="date" value={f.date} onChange={set("date")} />
      <label>Preferred Time:</label>
      <input required type="time" value={f.time} onChange={set("time")} />
      <button className="btn block">Book Appointment</button>
    </form>
  );
}

export function ServiceHistory() {
  const { history } = useStore();
  return (
    <>
      <div className="row"><h2>Service History</h2><Link className="btn secondary" to="/customer">Back to Dashboard</Link></div>
      <table><thead><tr><th>Vehicle</th><th>Service Type</th><th>Date</th><th>Cost</th><th>Notes</th></tr></thead>
        <tbody>{history.map((h) => <tr key={h.id}><td>{h.vehicle}</td><td>{h.service}</td><td>{h.date}</td><td>{kes(h.cost)}</td><td>{h.notes}</td></tr>)}</tbody></table>
    </>
  );
}
