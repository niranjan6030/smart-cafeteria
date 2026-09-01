import RevealOnScroll from "./RevealOnScroll";
import SectionHeader from "../ui/SectionHeader";

// ─── CategoryStrip — quick-filter pills (curated cravings + live categories) ──
export default function CategoryStrip({ browseChips, categoryFilter, setCategoryFilter, scrollToMenuSection }) {
  return (
    <RevealOnScroll as="section" className="cc-fade-in-up mb-10">
      <SectionHeader
        kicker="Browse by craving"
        title="Order our best food options"
        subtitle={`${browseChips.length} ways to browse across campus.`}
      />
      <div className="cc-no-scrollbar flex gap-2.5 overflow-x-auto pb-2">
        {browseChips.map((chip) => (
          <button
            key={chip.id}
            onClick={() => { setCategoryFilter(categoryFilter === chip.id ? "" : chip.id); scrollToMenuSection(); }}
            className={`cc-chip ${categoryFilter === chip.id ? "cc-chip-active" : ""}`}
            aria-pressed={categoryFilter === chip.id}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </RevealOnScroll>
  );
}
