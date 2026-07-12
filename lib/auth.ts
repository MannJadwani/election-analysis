import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { Pool } from "pg";

/**
 * Better Auth server.
 *
 * - Postgres (the same Neon DB the app uses) for users/sessions/accounts.
 * - Email + password, but public sign-up is DISABLED — accounts are created only
 *   by an admin (invite-only), which suits sensitive voter data.
 * - Roles: `admin` (full access + user management) and `region_incharge`
 *   (scoped to one region). Region scope is stored on the user as
 *   scopeLevel (state | district | constituency | part) + scopeValue.
 */

// node-postgres doesn't need libpq's channel_binding param; drop it to avoid warnings.
const connectionString = (process.env.DATABASE_URL ?? "").replace(
  /[?&]channel_binding=require/,
  "",
);

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: connectionString.includes("localhost")
        ? undefined
        : { rejectUnauthorized: false },
    })
  : undefined;

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // invite-only — only admins create accounts
    minPasswordLength: 8,
  },
  user: {
    additionalFields: {
      // Which slice of the data a region_incharge may see.
      scopeLevel: { type: "string", required: false, input: true },
      scopeValue: { type: "string", required: false, input: true },
    },
  },
  plugins: [
    admin({
      defaultRole: "region_incharge",
      adminRoles: ["admin"],
    }),
  ],
});

export type AppUser = typeof auth.$Infer.Session.user;
export type AppSession = typeof auth.$Infer.Session.session;
