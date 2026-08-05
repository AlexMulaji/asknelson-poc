// A kind, helpful empty state — never a cold "No data found".
export default function EmptyState({ title, message, children }) {
  return (
    <div className="my-8 rounded-card border border-dashed border-line bg-canvas px-6 py-10 text-center">
      <p className="font-display text-[19px] font-extrabold text-navy">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">{message}</p>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  )
}
