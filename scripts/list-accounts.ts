import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../lib/db";

/** List all auth accounts with role + region scope. */
async function main() {
  const db = await getDb();
  const res = await db.execute(sql`
    select name, email, role, "scopeLevel", "scopeValue", "createdAt"
    from "user"
    order by "createdAt" asc
  `);
  const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as {
    name: string;
    email: string;
    role: string | null;
    scopeLevel: string | null;
    scopeValue: string | null;
    createdAt: Date;
  }[];

  console.log(`\n${rows.length} account(s):\n`);
  for (const r of rows) {
    const scope =
      r.role === "admin"
        ? "all regions"
        : r.scopeLevel && r.scopeValue
          ? `${r.scopeLevel}: ${r.scopeValue}`
          : "no region set";
    console.log(
      `  ${r.email}  |  ${r.name}  |  ${r.role ?? "user"}  |  ${scope}`,
    );
  }
  console.log();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
