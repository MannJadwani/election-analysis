import { sql } from "drizzle-orm";
import { getDb, schema } from "./index";

export interface Datum {
  label: string;
  value: number;
}

function toRows(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

const AGE_ORDER = ["18–25", "26–35", "36–45", "46–60", "60+"];

/** Aggregations for the admin analytics dashboard. */
export async function getAnalytics() {
  const db = await getDb();
  const v = schema.voters;
  const p = schema.parts;

  const ageCase = sql<string>`case
    when ${v.age} < 26 then '18–25'
    when ${v.age} < 36 then '26–35'
    when ${v.age} < 46 then '36–45'
    when ${v.age} < 61 then '46–60'
    else '60+' end`;

  const [genderRows, ageRows, byConstituency, roleRes] = await Promise.all([
    db
      .select({ g: v.gender, n: sql<number>`count(*)::int` })
      .from(v)
      .groupBy(v.gender),
    db
      .select({ bucket: ageCase, n: sql<number>`count(*)::int` })
      .from(v)
      .where(sql`${v.age} is not null`)
      .groupBy(ageCase),
    db
      .select({
        name: p.assemblyConstituencyName,
        n: sql<number>`count(${v.id})::int`,
      })
      .from(p)
      .leftJoin(v, sql`${v.partId} = ${p.id}`)
      .groupBy(p.assemblyConstituencyName)
      .orderBy(sql`count(${v.id}) desc`),
    // Auth user table isn't in the drizzle schema — query it directly.
    db.execute(
      sql`select coalesce(role, 'user') as role, count(*)::int as n from "user" group by role order by n desc`,
    ),
  ]);

  const GENDER_LABEL: Record<string, string> = {
    male: "Male",
    female: "Female",
    third_gender: "Third gender",
    unknown: "Unknown",
  };
  const gender: Datum[] = genderRows
    .map((r) => ({
      label: GENDER_LABEL[r.g ?? "unknown"] ?? r.g ?? "Unknown",
      value: Number(r.n),
    }))
    .sort((a, b) => b.value - a.value);

  const ageMap = new Map(ageRows.map((r) => [r.bucket, Number(r.n)]));
  const age: Datum[] = AGE_ORDER.map((label) => ({
    label,
    value: ageMap.get(label) ?? 0,
  }));

  const constituency: Datum[] = byConstituency
    .filter((r) => r.name)
    .map((r) => ({ label: r.name as string, value: Number(r.n) }));

  const ROLE_LABEL: Record<string, string> = {
    admin: "Admins",
    region_incharge: "Region incharges",
    user: "Users",
  };
  const roles: Datum[] = toRows(roleRes).map((r) => ({
    label: ROLE_LABEL[String(r.role)] ?? String(r.role),
    value: Number(r.n),
  }));

  return { gender, age, constituency, roles };
}
