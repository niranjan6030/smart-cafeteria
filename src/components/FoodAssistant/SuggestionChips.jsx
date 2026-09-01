export default function SuggestionChips({ chips, onPick, variant = "inline" }) {
  if (!chips || chips.length === 0) return null;
  const normalized = chips.map((chip) =>
    typeof chip === "string" ? { label: chip, hint: null } : chip
  );
  return (
    <div className={`fa-chips fa-chips-${variant}`} role="group" aria-label="Suggestions">
      {normalized.map((chip) => (
        <button key={chip.label} type="button" className="fa-chip" onClick={() => onPick(chip.hint || chip.label)}>
          {chip.label}
        </button>
      ))}
    </div>
  );
}
