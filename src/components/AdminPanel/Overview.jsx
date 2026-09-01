// ─── Cross-stall live monitoring — the "watchman" view over both UserMenu and
// KitchenLiveBoard at a glance: one card per stall, real-time.
import { stallDisplayName } from "../UserMenu/helpers";

export default function Overview({ t, stallLiveData }) {
  const totalPending = stallLiveData.reduce((sum, s) => sum + s.pendingOrderCount, 0);
  const occupiedCount = stallLiveData.filter((s) => s.occupant).length;

  return (
    <div>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={`border p-5 text-center ${t.panelElevated}`}>
          <p className={`text-[9px] uppercase tracking-widest ${t.label}`}>Stalls Staffed</p>
          <p className={`mt-1 text-2xl font-bold ${t.heading}`}>{occupiedCount} / {stallLiveData.length}</p>
        </div>
        <div className={`border p-5 text-center ${t.panelElevated}`}>
          <p className={`text-[9px] uppercase tracking-widest ${t.label}`}>Orders In Flight</p>
          <p className={`mt-1 text-2xl font-bold ${t.heading}`}>{totalPending}</p>
        </div>
        <div className={`border p-5 text-center ${t.panelElevated}`}>
          <p className={`text-[9px] uppercase tracking-widest ${t.label}`}>Stalls Open</p>
          <p className={`mt-1 text-2xl font-bold ${t.heading}`}>{stallLiveData.filter((s) => s.isOpen).length} / {stallLiveData.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stallLiveData.map((stall) => (
          <div key={stall.name} className={`border p-5 ${t.panel}`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className={`text-sm font-bold uppercase tracking-wide ${t.heading}`}>{stallDisplayName(stall.name)}</h3>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${
                  !stall.isOpen
                    ? "bg-red-500/15 text-red-500"
                    : stall.isBusy
                    ? "bg-amber-500/15 text-amber-500"
                    : "bg-emerald-500/15 text-emerald-500"
                }`}
              >
                {!stall.isOpen ? "Closed" : stall.isBusy ? "Busy" : "Open"}
              </span>
            </div>
            <div className={`mb-3 border-t pt-3 ${t.divider}`}>
              <p className={`text-[9px] uppercase tracking-widest ${t.label}`}>Staffed By</p>
              {stall.occupant ? (
                <div className="mt-1">
                  <p className={`text-xs font-bold ${t.heading}`}>{stall.occupant.displayName || stall.occupant.email}</p>
                  <p className={`text-[10px] ${t.body}`}>{stall.occupant.email}</p>
                </div>
              ) : (
                <p className={`mt-1 text-xs font-bold text-amber-500`}>Unattended</p>
              )}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className={t.label}>Orders in flight</span>
              <span className={`font-bold ${t.heading}`}>{stall.pendingOrderCount}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
