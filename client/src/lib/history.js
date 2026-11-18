import { fetchAll } from "./api";
import { vehicleLabel } from "./format";

// The backend has no "service history" endpoint. History = issued invoices,
// joined with their job card (-> vehicle). Labor lines name the work done.
export async function loadHistory() {
  const [invoices, jobs, vehicles] = await Promise.all([
    fetchAll("/invoices"), fetchAll("/job-cards"), fetchAll("/vehicles"),
  ]);
  const job = new Map(jobs.map((j) => [j.job_card_id, j]));
  const car = new Map(vehicles.map((v) => [v.vehicle_id, v]));
  return invoices
    .map((i) => ({
      id: i.invoice_id,
      vehicle: vehicleLabel(car.get(job.get(i.job_card_id)?.vehicle_id)),
      service: i.lines.filter((l) => l.kind === "LABOR").map((l) => l.description).join(", ") || "-",
      date: i.issued_at,
      cost: i.total_amount,
      payment: i.payment_status,
      balance: i.balance_due,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
