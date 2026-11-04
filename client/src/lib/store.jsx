import { createContext, useContext, useState } from "react";

const Ctx = createContext();
export const useStore = () => useContext(Ctx);

let uid = 100;
export const nextId = () => ++uid;

export function StoreProvider({ children }) {
  const [role, setRole] = useState(null); // null | "customer" | "admin"
  const [vehicles, setVehicles] = useState([
    { id: 1, make: "Toyota", model: "Corolla", year: "2020", plate: "KAA 123C" },
    { id: 2, make: "Honda", model: "Fit", year: "2018", plate: "KEG 500L" },
  ]);
  const [appointments, setAppointments] = useState([
    { id: 1, code: "APP001", customer: "Brian Otieno", vehicle: "Toyota Corolla", service: "Oil Change", date: "2026-11-15", time: "10:00", status: "Scheduled" },
    { id: 2, code: "APP002", customer: "Grace Wanjiku", vehicle: "Honda Fit", service: "Tire Rotation", date: "2026-11-16", time: "14:00", status: "Completed" },
    { id: 3, code: "APP003", customer: "Peter Jones", vehicle: "Ford F-150", service: "Brake Inspection", date: "2026-11-17", time: "09:30", status: "Cancelled" },
  ]);
  const [history] = useState([
    { id: 1, vehicle: "Toyota Corolla (KAA 123C)", service: "Oil Change", date: "2026-01-15", cost: 7500, notes: "Standard oil and filter change." },
    { id: 2, vehicle: "Toyota Corolla (KAA 123C)", service: "Tire Rotation", date: "2026-03-20", cost: 3000, notes: "All four tires rotated." },
    { id: 3, vehicle: "Honda Fit (KEG 500L)", service: "Brake Inspection", date: "2026-04-10", cost: 5000, notes: "Front brakes checked, rear brakes good." },
  ]);
  const [customers, setCustomers] = useState([
    { id: 1, name: "Brian Otieno", email: "botieno@example.com", phone: "0712 345 678", registered: "2026-01-15" },
    { id: 2, name: "Grace Wanjiku", email: "grace.wanjiks@example.com", phone: "0723 456 789", registered: "2026-02-20" },
  ]);
  const [services, setServices] = useState([
    { id: 1, name: "Oil Change", description: "Standard oil and filter replacement.", price: 5000 },
    { id: 2, name: "Tire Rotation", description: "Rotation of all four tires.", price: 3000 },
    { id: 3, name: "Brake Inspection", description: "Full inspection of brake system.", price: 2500 },
  ]);

  // generic helpers: save = add or update (when item has an id already in list)
  const save = (setter) => (item) =>
    setter((list) =>
      list.some((x) => x.id === item.id)
        ? list.map((x) => (x.id === item.id ? item : x))
        : [...list, { ...item, id: nextId() }]
    );
  const remove = (setter) => (id) => setter((list) => list.filter((x) => x.id !== id));

  const value = {
    role, setRole,
    vehicles, saveVehicle: save(setVehicles), removeVehicle: remove(setVehicles),
    appointments, saveAppointment: save(setAppointments), removeAppointment: remove(setAppointments),
    history,
    customers, saveCustomer: save(setCustomers), removeCustomer: remove(setCustomers),
    services, saveService: save(setServices), removeService: remove(setServices),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
