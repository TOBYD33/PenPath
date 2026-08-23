import { useEffect, useState, type FormEvent } from "react";
import { ROLES, type Role } from "@penpath/shared";
import { AppShell } from "../../components/AppShell";
import { api, ApiError } from "../../lib/api";
import { PermissionEditor } from "./PermissionEditor";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  active: boolean;
  maxCaseLoad: number | null;
  createdAt: string;
}

export default function Users() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingPermissionsFor, setEditingPermissionsFor] = useState<AdminUser | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const data = await api.get<{ users: AdminUser[] }>("/api/users");
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function updateUser(id: string, patch: Partial<Pick<AdminUser, "role" | "active" | "maxCaseLoad">>) {
    try {
      await api.patch(`/api/users/${id}`, patch);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-text-primary">Users</h1>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="bg-brand-primary hover:bg-brand-dark text-white text-sm font-medium rounded-md px-4 py-2"
        >
          {showCreate ? "Cancel" : "New user"}
        </button>
      </div>

      {error && <p className="text-sm text-status-error mb-4">{error}</p>}

      {showCreate && (
        <CreateUserForm
          onCreated={() => {
            setShowCreate(false);
            reload();
          }}
        />
      )}

      <div className="bg-bg-base border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Max case load</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Permissions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-text-muted">
                  Loading…
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-text-primary">{u.name}</td>
                  <td className="px-4 py-3 text-text-muted">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={(e) => updateUser(u.id, { role: e.target.value as Role })}
                      className="border border-border rounded-md px-2 py-1 text-sm bg-bg-base"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {u.role === "OPS_OFFICER" ? (
                      <input
                        type="number"
                        min={1}
                        value={u.maxCaseLoad ?? 6}
                        onChange={(e) => updateUser(u.id, { maxCaseLoad: Number(e.target.value) })}
                        className="w-16 border border-border rounded-md px-2 py-1 text-sm"
                      />
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => updateUser(u.id, { active: !u.active })}
                      className={`text-xs font-medium rounded-full px-3 py-1 ${
                        u.active
                          ? "bg-status-success/10 text-status-success"
                          : "bg-status-error/10 text-status-error"
                      }`}
                    >
                      {u.active ? "Active" : "Suspended"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setEditingPermissionsFor(u)}
                      className="text-accent hover:text-accent-light font-medium"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editingPermissionsFor && (
        <PermissionEditor user={editingPermissionsFor} onClose={() => setEditingPermissionsFor(null)} />
      )}
    </AppShell>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("OPS_OFFICER");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/api/users", { name, email, password, role });
      setName("");
      setEmail("");
      setPassword("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create user");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-bg-base border border-border rounded-lg p-4 mb-4 flex flex-wrap gap-3 items-end">
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">Name</label>
        <input required value={name} onChange={(e) => setName(e.target.value)} className="border border-border rounded-md px-3 py-1.5 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">Email</label>
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="border border-border rounded-md px-3 py-1.5 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">Temporary password</label>
        <input required type="text" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="border border-border rounded-md px-3 py-1.5 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="border border-border rounded-md px-3 py-1.5 text-sm">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="bg-brand-primary hover:bg-brand-dark text-white text-sm font-medium rounded-md px-4 py-2 disabled:opacity-60"
      >
        {submitting ? "Creating…" : "Create"}
      </button>
      {error && <p className="text-sm text-status-error basis-full">{error}</p>}
    </form>
  );
}
