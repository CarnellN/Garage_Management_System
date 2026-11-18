// Shows loading / error text, otherwise calls children(data)
export default function Async({ q, children }) {
  if (q.error) return <p className="error">{q.error}</p>;
  if (!q.data) return <p>Loading…</p>;
  return children(q.data);
}
