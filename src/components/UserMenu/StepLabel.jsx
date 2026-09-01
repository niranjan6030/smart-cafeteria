export default function StepLabel({ number, label, darkMode }) {
  return (
    <p className={`mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.28em] ${darkMode ? "text-white/70" : "text-stone-600"}`}>
      <span className="grid h-6 w-6 place-items-center rounded-full bg-[color:var(--color-primary)] text-[10px] text-[color:var(--color-bg-deep)]">{number}</span>
      {label}
    </p>
  );
}
