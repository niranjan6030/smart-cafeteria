import { useState } from "react";
import { stallDisplayName } from "../UserMenu/helpers";

function StallRow({ t, stall, registeredEmail, onSaveEmail, onRemoveEmail, onForceRelease, onToggleOpen, onTogglePause, busyStall }) {
  const [emailDraft, setEmailDraft] = useState(registeredEmail || "");
  // Start read-only so the browser's autofill pass on page load skips this field entirely.
  // Chrome/Edge ignore autoComplete="off" on type=email inputs and otherwise cross-fill the same
  // saved address into all six stalls at once; a read-only field is never autofilled. It becomes
  // editable the instant the admin focuses it.
  const [isReadOnly, setIsReadOnly] = useState(true);
  const isDirty = emailDraft.trim() !== (registeredEmail || "");

  return (
    <div className={`border p-5 ${t.panel}`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className={`text-sm font-bold uppercase tracking-wide ${t.heading}`}>{stallDisplayName(stall.name)}</h3>
          {stall.occupant ? (
            <p className={`mt-1 text-xs ${t.body}`}>
              Staffed by <span className={`font-bold ${t.heading}`}>{stall.occupant.displayName || stall.occupant.email}</span>
              {" "}since {stall.occupant.loginAt?.toDate?.().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) || "—"}
            </p>
          ) : (
            <p className="mt-1 text-xs font-bold text-amber-500">Unattended — no active session</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onToggleOpen(stall.name, !stall.isOpen)}
            disabled={busyStall === stall.name}
            className={`border px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition disabled:opacity-50 ${
              stall.isOpen
                ? `${t.headerBorder} ${t.body} hover:bg-current/10`
                : "border-red-400/40 bg-red-500/10 text-red-500"
            }`}
          >
            {stall.isOpen ? "Close Stall" : "Reopen Stall"}
          </button>
          <button
            onClick={() => onTogglePause(stall.name, !stall.isBusy)}
            disabled={busyStall === stall.name}
            className={`border px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition disabled:opacity-50 ${
              stall.isBusy
                ? "border-amber-500/50 bg-amber-500/10 text-amber-500"
                : `${t.headerBorder} ${t.body} hover:bg-current/10`
            }`}
          >
            {stall.isBusy ? "Resume Orders" : "Pause Orders"}
          </button>
          <button
            onClick={() => onForceRelease(stall.name)}
            disabled={!stall.occupant || busyStall === stall.name}
            className="border border-red-400/30 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-red-500 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Force Release
          </button>
        </div>
      </div>

      {/* ─── Registered email: the single real-world address authorized to log into this
          stall. Staff login resolves the stall from this registry server-side — there's no
          picker on the staff side anymore. ── */}
      <div className={`mt-4 flex flex-wrap items-center gap-2 border-t pt-4 ${t.divider}`}>
        <label className={`text-[9px] font-bold uppercase tracking-widest ${t.label}`}>Registered Email</label>
        {/* Read-only-until-focus defeats browser autofill cross-filling every stall with the same
            saved address (see isReadOnly above). Non-semantic name (no "email" token) + autoComplete
            off are belt-and-suspenders on top. */}
        <input
          type="email"
          name={`stall-registry-${stall.name.replace(/\s+/g, "-").toLowerCase()}`}
          autoComplete="off"
          readOnly={isReadOnly}
          onFocus={() => setIsReadOnly(false)}
          value={emailDraft}
          onChange={(e) => setEmailDraft(e.target.value)}
          placeholder="e.g. mingos@bcah.christuniversity.in"
          className={`flex-1 min-w-[220px] border px-3 py-2 text-xs outline-none focus:border-current ${t.inputBg} ${t.inputBorder} ${t.inputText}`}
        />
        <button
          onClick={() => onSaveEmail(stall.name, emailDraft.trim())}
          disabled={!isDirty || busyStall === `email:${stall.name}` || busyStall === `email-remove:${stall.name}`}
          className={`border px-3 py-2 text-[9px] font-bold uppercase tracking-widest transition disabled:cursor-not-allowed disabled:opacity-30 ${t.accentBorder} ${t.accent} hover:bg-current/10`}
        >
          {busyStall === `email:${stall.name}` ? "Saving..." : "Save"}
        </button>
        {/* Only offer Remove when there's actually a registered email to clear. Removing it also
            force-releases the stall's session (handled in AdminPanel.jsx), so the stall is reset. */}
        {registeredEmail && (
          <button
            onClick={() => onRemoveEmail(stall.name)}
            disabled={busyStall === `email:${stall.name}` || busyStall === `email-remove:${stall.name}`}
            className="border border-red-400/30 px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-red-500 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {busyStall === `email-remove:${stall.name}` ? "Removing..." : "Remove"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Per-stall operational controls: occupancy force-release, open/busy overrides, and the
// registered-email assignment that determines who can even attempt to log into this stall.
export default function Stalls({ t, stallLiveData, stallEmails, onSaveEmail, onRemoveEmail, onForceRelease, onToggleOpen, onTogglePause, busyStall }) {
  return (
    <div className="space-y-4">
      {stallLiveData.map((stall) => (
        <StallRow
          key={stall.name}
          t={t}
          stall={stall}
          registeredEmail={stallEmails[stall.name] || ""}
          onSaveEmail={onSaveEmail}
          onRemoveEmail={onRemoveEmail}
          onForceRelease={onForceRelease}
          onToggleOpen={onToggleOpen}
          onTogglePause={onTogglePause}
          busyStall={busyStall}
        />
      ))}
    </div>
  );
}
