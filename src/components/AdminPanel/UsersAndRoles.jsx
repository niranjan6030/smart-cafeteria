import { useState } from "react";
import { ROLE_DEFINITIONS, ROLE_LABELS } from "./helpers";
import { stallDisplayName } from "../UserMenu/helpers";

const STALLS = ["Falcon Veg", "Fresheteria", "Mingos", "Break Time", "Surf & Turf", "Bakery"];
const ROLE_OPTIONS = ROLE_DEFINITIONS.map((r) => r.role);

function UserRow({ t, targetUser, onSetRole, currentUid, isSaving }) {
  const [draftRole, setDraftRole] = useState(targetUser.role || "student");
  const [draftStall, setDraftStall] = useState(targetUser.assignedStall || "");

  const isDirty = draftRole !== (targetUser.role || "student") || draftStall !== (targetUser.assignedStall || "");
  const isSelf = targetUser.id === currentUid;

  const handleSave = () => {
    if (draftRole === "admin" && !window.confirm(`Grant admin access to ${targetUser.email}? They will be able to manage every stall and every user.`)) {
      return;
    }
    onSetRole(targetUser.id, draftRole, draftRole === "staff" ? draftStall || null : null);
  };

  return (
    <tr className={`border-b ${t.divider}`}>
      <td className="py-3 pr-3">
        <p className={`font-bold ${t.heading}`}>{targetUser.displayName || "—"}</p>
        <p className={`text-[11px] ${t.body}`}>{targetUser.email}{isSelf ? " (you)" : ""}</p>
      </td>
      <td className="py-3 pr-3">
        <select
          value={draftRole}
          onChange={(e) => setDraftRole(e.target.value)}
          disabled={isSelf}
          className={`border px-2 py-1.5 text-xs outline-none focus:border-current disabled:opacity-40 ${t.inputBg} ${t.inputBorder} ${t.inputText}`}
        >
          {ROLE_OPTIONS.map((role) => (
            <option key={role} value={role}>{ROLE_LABELS[role]}</option>
          ))}
        </select>
      </td>
      <td className="py-3 pr-3">
        {draftRole === "staff" ? (
          <select
            value={draftStall}
            onChange={(e) => setDraftStall(e.target.value)}
            className={`border px-2 py-1.5 text-xs outline-none focus:border-current ${t.inputBg} ${t.inputBorder} ${t.inputText}`}
          >
            <option value="">Unassigned</option>
            {STALLS.map((stall) => (
              <option key={stall} value={stall}>{stallDisplayName(stall)}</option>
            ))}
          </select>
        ) : (
          <span className={t.label}>—</span>
        )}
      </td>
      <td className="py-3 pr-3 text-right">
        <button
          onClick={handleSave}
          disabled={!isDirty || isSaving || isSelf}
          title={isSelf ? "You can't change your own role from here" : undefined}
          className={`border px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest transition disabled:cursor-not-allowed disabled:opacity-30 ${t.accentBorder} ${t.accent} hover:bg-current/10`}
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </td>
    </tr>
  );
}

// ─── The "IAM-lite" screen: a static reference of what each fixed role grants, plus the actual
// controls to change which role a user holds. No custom policy builder — four roles, hardcoded
// permissions, matching the real scale of a 6-stall app.
export default function UsersAndRoles({ t, users, onSetRole, currentUid, savingUid }) {
  return (
    <div>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ROLE_DEFINITIONS.map((def) => (
          <div key={def.role} className={`border p-4 ${t.panelAlt}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${t.accent}`}>{def.label}</p>
            <ul className="mt-3 space-y-1.5">
              {def.permissions.map((perm) => (
                <li key={perm} className={`text-[10px] leading-relaxed ${t.body}`}>• {perm}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className={`overflow-x-auto border ${t.panel}`}>
        <table className="w-full min-w-[640px] border-collapse text-left text-xs">
          <thead>
            <tr className={`border-b text-[9px] uppercase tracking-widest ${t.headerBorder} ${t.label}`}>
              <th className="px-5 py-3">User</th>
              <th className="px-5 py-3">Role</th>
              <th className="px-5 py-3">Assigned Stall</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((targetUser) => (
              <UserRow
                key={targetUser.id}
                t={t}
                targetUser={targetUser}
                onSetRole={onSetRole}
                currentUid={currentUid}
                isSaving={savingUid === targetUser.id}
              />
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <p className={`p-10 text-center text-[10px] uppercase tracking-widest ${t.label}`}>No users yet.</p>
        )}
      </div>
    </div>
  );
}
