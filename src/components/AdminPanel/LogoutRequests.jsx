// ─── The approval queue that makes "staff can't log out without admin permission" real. Staff
// file a request from StallTerminal.jsx; approving here atomically releases the stall lock
// server-side (api/admin-approve-logout.js) and the staff member's own client auto-signs-out the
// instant it sees the resolution.
export default function LogoutRequests({ t, pendingRequests, onResolve, resolvingUid }) {
  if (pendingRequests.length === 0) {
    return (
      <div className={`border p-10 text-center ${t.panel}`}>
        <p className={`text-[10px] uppercase tracking-[0.3em] ${t.label}`}>No pending logout requests</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {pendingRequests.map((request) => (
        <div key={request.uid} className={`flex flex-wrap items-center justify-between gap-4 border p-5 ${t.panel}`}>
          <div>
            <p className={`text-sm font-bold ${t.heading}`}>{request.displayName || request.email}</p>
            <p className={`mt-1 text-xs ${t.body}`}>
              {request.email} — requesting to leave <span className={t.accent}>{request.stall}</span>
            </p>
            <p className={`mt-1 text-[10px] uppercase tracking-widest ${t.label}`}>
              Requested {request.requestedAt?.toDate?.().toLocaleString([], { dateStyle: "short", timeStyle: "short" }) || "—"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onResolve(request, false)}
              disabled={resolvingUid === request.uid}
              className="border border-red-400/30 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-red-500 transition hover:bg-red-500/10 disabled:opacity-50"
            >
              Deny
            </button>
            <button
              onClick={() => onResolve(request, true)}
              disabled={resolvingUid === request.uid}
              className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition disabled:opacity-50 ${t.accentBg} ${t.accentText} ${t.accentBgHover}`}
            >
              {resolvingUid === request.uid ? "Resolving..." : "Approve"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
