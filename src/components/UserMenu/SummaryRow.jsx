export default function SummaryRow({ label, value, darkMode, strong = false }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={`text-xs ${darkMode ? "text-white/55" : "text-stone-500"}`}>{label}</span>
      <span className={`${strong ? "text-lg font-black text-[#E06A3B]" : "text-xs font-bold"}`}>{value}</span>
    </div>
  );
}
