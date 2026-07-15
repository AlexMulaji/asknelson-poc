// A kind, helpful empty state — never a cold "No data found".
export default function EmptyState({ title, message, children }) {
  return (
    <div className="mx-5 my-8 rounded-card border border-dashed border-gray-200 bg-gray-50 px-6 py-10 text-center">
      <p className="font-display text-[19px] font-semibold text-black">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-gray-500">{message}</p>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  )
}
