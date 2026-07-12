"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authClient } from "@/lib/auth-client";
import type { RegionOptions } from "@/lib/db/regions";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  scopeLevel?: string | null;
  scopeValue?: string | null;
}

const LEVELS = ["state", "district", "constituency", "part"] as const;

export function UserManager({ regions }: { regions: RegionOptions }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("region_incharge");
  const [scopeLevel, setScopeLevel] = useState<string>("state");
  const [scopeValue, setScopeValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await authClient.admin.listUsers({ query: { limit: 200 } });
    const list =
      ((res.data as { users?: UserRow[] })?.users ??
        (res.data as unknown as UserRow[]) ??
        []) as UserRow[];
    setUsers(Array.isArray(list) ? list : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Options for the scope-value dropdown, based on the selected level.
  const scopeValues = useMemo(() => {
    switch (scopeLevel) {
      case "state":
        return regions.state.map((v) => ({ value: v, label: v }));
      case "district":
        return regions.district.map((v) => ({ value: v, label: v }));
      case "constituency":
        return regions.constituency;
      case "part":
        return regions.part;
      default:
        return [];
    }
  }, [scopeLevel, regions]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const isRegion = role === "region_incharge";
    if (isRegion && !scopeValue) {
      setError("Pick a region for the incharge.");
      setBusy(false);
      return;
    }
    const res = await authClient.admin.createUser({
      email,
      password,
      name,
      // Better Auth accepts custom role strings at runtime; its client type is narrow.
      role: role as "admin" | "user",
      data: isRegion
        ? { scopeLevel, scopeValue }
        : { scopeLevel: null, scopeValue: null },
    });
    setBusy(false);
    if (res.error) {
      setError(res.error.message ?? "Failed to create user");
      return;
    }
    setName("");
    setEmail("");
    setPassword("");
    setScopeValue("");
    void load();
  }

  async function remove(id: string) {
    if (!confirm("Remove this user?")) return;
    await authClient.admin.removeUser({ userId: id });
    void load();
  }

  function scopeLabel(u: UserRow) {
    if (u.role === "admin") return "all regions";
    if (!u.scopeLevel || !u.scopeValue) return "no region set";
    return `${u.scopeLevel}: ${u.scopeValue}`;
  }

  const field =
    "w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-neutral-500">Users</h2>

      {/* Create form */}
      <form
        onSubmit={create}
        className="mb-5 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800"
      >
        <div className="mb-2 text-sm font-medium">Add a user</div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <input
            className={field}
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className={field}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className={field}
            type="password"
            placeholder="Temp password (min 8)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          <select
            className={field}
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="region_incharge">Region incharge</option>
            <option value="admin">Admin</option>
          </select>

          {role === "region_incharge" && (
            <>
              <select
                className={field}
                value={scopeLevel}
                onChange={(e) => {
                  setScopeLevel(e.target.value);
                  setScopeValue("");
                }}
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l[0].toUpperCase() + l.slice(1)}
                  </option>
                ))}
              </select>
              <select
                className={field}
                value={scopeValue}
                onChange={(e) => setScopeValue(e.target.value)}
              >
                <option value="">Select {scopeLevel}…</option>
                {scopeValues.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        {error && (
          <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-3 w-full rounded-xl bg-neutral-900 px-4 py-3 text-base font-medium text-white active:scale-[0.99] disabled:opacity-50 dark:bg-white dark:text-neutral-900 sm:w-auto sm:px-6"
        >
          {busy ? "Creating…" : "Create user"}
        </button>
      </form>

      {/* User list */}
      {loading ? (
        <div className="py-6 text-center text-sm text-neutral-400">Loading…</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {users.map((u) => (
            <li
              key={u.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {u.name}{" "}
                  <span
                    className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      u.role === "admin"
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                        : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                    }`}
                  >
                    {u.role ?? "user"}
                  </span>
                </div>
                <div className="truncate text-xs text-neutral-500">
                  {u.email} · {scopeLabel(u)}
                </div>
              </div>
              <button
                onClick={() => remove(u.id)}
                className="shrink-0 rounded-lg px-2 py-1 text-sm text-red-600 active:scale-95"
                aria-label="Remove user"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
