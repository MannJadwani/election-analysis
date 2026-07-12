import { and, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { auth } from "./auth";
import { schema } from "./db";

export type ScopeLevel = "state" | "district" | "constituency" | "part";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string | null;
  scopeLevel: string | null;
  scopeValue: string | null;
}

/** Read the current user from request headers (route handlers) or server headers. */
export async function getUser(headers: Headers): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  const u = session.user as unknown as SessionUser;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role ?? null,
    scopeLevel: u.scopeLevel ?? null,
    scopeValue: u.scopeValue ?? null,
  };
}

export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === "admin";
}

/**
 * Build the WHERE condition that limits a region_incharge to their region.
 * Admins (or unscoped users) get `undefined` (no restriction).
 * Returns `FALSE` (via a never-matching condition) if a region_incharge has no
 * valid scope, so they see nothing rather than everything.
 */
export function scopeCondition(user: SessionUser | null): SQL | undefined {
  if (!user || isAdmin(user)) return undefined;

  const { parts, voters } = schema;
  const level = user.scopeLevel as ScopeLevel | null;
  const value = user.scopeValue;

  if (!level || !value) {
    // region_incharge with no scope assigned → match nothing.
    return eq(parts.id, -1);
  }

  switch (level) {
    case "state":
      return eq(parts.state, value);
    case "district":
      return eq(parts.district, value);
    case "constituency":
      return eq(parts.assemblyConstituencyNo, Number(value));
    case "part":
      return eq(voters.partId, Number(value));
    default:
      return eq(parts.id, -1);
  }
}

export { and };
