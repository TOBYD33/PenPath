import { useEffect, useState } from "react";
import { PERMISSIONS, type Permission, type Role } from "@penpath/shared";
import { api, ApiError } from "../../lib/api";

interface Props {
  user: { id: string; name: string; role: Role };
  onClose: () => void;
}

interface PermissionsResponse {
  effective: Permission[];
  overrides: { permission: string; granted: boolean }[];
}

export function PermissionEditor({ user, onClose }: Props) {
  const [effective, setEffective] = useState<Set<Permission>>(new Set());
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const data = await api.get<PermissionsResponse>(`/api/users/${user.id}/permissions`);
      setEffective(new Set(data.effective));
      setOverrides(new Map(data.overrides.map((o) => [o.permission, o.granted])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load permissions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  async function toggle(permission: Permission, currentlyGranted: boolean) {
    try {
      await api.put(`/api/users/${user.id}/permissions/${permission}`, { granted: !currentlyGranted });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-bg-base border border-border rounded-lg shadow-lg w-full max-w-md max-h-[80vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-text-primary">Permissions — {user.name}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            ✕
          </button>
        </div>
        <p className="text-xs text-text-muted mb-4">
          Role default: <span className="font-medium">{user.role}</span>. Overrides here grant or revoke
          individual permissions on top of the role default.
        </p>

        {error && <p className="text-sm text-status-error mb-3">{error}</p>}

        {loading ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : (
          <ul className="space-y-1">
            {PERMISSIONS.map((p) => {
              const granted = effective.has(p);
              const isOverride = overrides.has(p);
              return (
                <li key={p} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                  <span className="text-sm text-text-primary">
                    {p}
                    {isOverride && <span className="ml-2 text-xs text-accent">override</span>}
                  </span>
                  <button
                    onClick={() => toggle(p, granted)}
                    className={`text-xs font-medium rounded-full px-3 py-1 ${
                      granted ? "bg-status-success/10 text-status-success" : "bg-bg-secondary text-text-muted"
                    }`}
                  >
                    {granted ? "Granted" : "Revoked"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
