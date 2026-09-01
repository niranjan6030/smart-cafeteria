// ─── Guest-Browsing-First: polished fallback for protected tabs ────────────
import EmptyState from "../ui/EmptyState";

export default function GuestFallbackCard({ title, subtitle, onLoginClick }) {
  return (
    <div className="cc-fade-in-up">
      <EmptyState
        icon={
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-dashed" style={{ borderColor: "var(--color-border-strong)", color: "var(--color-text-muted)" }}>
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </span>
        }
        title={title}
        subtitle={subtitle}
        action={
          <button onClick={onLoginClick} className="cc-btn cc-btn-primary !px-8 !py-3.5">
            Log In to Continue
          </button>
        }
      />
    </div>
  );
}
