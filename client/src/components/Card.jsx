export default function Card({ title, children }) {
  return <section className="card">{title && <h3>{title}</h3>}{children}</section>;
}