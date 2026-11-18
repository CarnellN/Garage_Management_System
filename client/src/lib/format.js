const TZ = "Africa/Nairobi"; // the garage timezone (UTC+3, no daylight saving)

export const kes = (n) => `KES ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;

// API timestamps are UTC; show them in Nairobi time
export const nairobiDate = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
export const nairobiTime = (iso) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

// Backend wants whole seconds, e.g. 2026-11-20T07:00:00Z
export const instant = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

// Turn a Nairobi date + time + duration into the API's scheduled_at / ends_at
export function slot(date, time, minutes) {
  const start = new Date(`${date}T${time}:00+03:00`);
  return { scheduled_at: instant(start), ends_at: instant(new Date(start.getTime() + minutes * 60000)) };
}
export function dayRange(date) {
  const start = new Date(`${date}T00:00:00+03:00`);
  return { from: instant(start), to: instant(new Date(start.getTime() + 86400000)) };
}
export const minutesBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000);
export const hoursToMinutes = (h) => (h == null ? 60 : Math.min(480, Math.max(15, Math.ceil(Number(h) * 4) * 15)));
export const vehicleLabel = (v) =>
  v ? `${[v.make, v.model].filter(Boolean).join(" ") || "Vehicle"} (${v.registration_no})` : "-";
