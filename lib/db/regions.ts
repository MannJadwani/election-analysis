import { sql } from "drizzle-orm";
import { getDb, schema } from "./index";

export interface RegionOptions {
  state: string[];
  district: string[];
  constituency: { value: string; label: string }[];
  part: { value: string; label: string }[];
}

/** Distinct region values across ingested rolls, for scope-assignment dropdowns. */
export async function getRegionOptions(): Promise<RegionOptions> {
  const db = await getDb();
  const p = schema.parts;

  const [states, districts, constituencies, parts] = await Promise.all([
    db.selectDistinct({ v: p.state }).from(p).where(sql`${p.state} is not null`),
    db
      .selectDistinct({ v: p.district })
      .from(p)
      .where(sql`${p.district} is not null`),
    db
      .selectDistinct({
        no: p.assemblyConstituencyNo,
        name: p.assemblyConstituencyName,
      })
      .from(p)
      .where(sql`${p.assemblyConstituencyNo} is not null`),
    db
      .select({
        id: p.id,
        no: p.partNo,
        ac: p.assemblyConstituencyName,
        station: p.pollingStationName,
      })
      .from(p),
  ]);

  return {
    state: states.map((s) => s.v).filter(Boolean) as string[],
    district: districts.map((s) => s.v).filter(Boolean) as string[],
    constituency: constituencies.map((c) => ({
      value: String(c.no),
      label: `${c.name ?? "?"} (${c.no})`,
    })),
    part: parts.map((pt) => ({
      value: String(pt.id),
      label: `${pt.ac ?? "?"} · Part ${pt.no ?? pt.id}${pt.station ? ` — ${pt.station}` : ""}`,
    })),
  };
}

/** Simple counts for the dashboard overview. */
export async function getStats() {
  const db = await getDb();
  const [{ voters }] = await db
    .select({ voters: sql<number>`count(*)::int` })
    .from(schema.voters);
  const [{ parts }] = await db
    .select({ parts: sql<number>`count(*)::int` })
    .from(schema.parts);
  const byState = await db
    .select({
      state: schema.parts.state,
      voters: sql<number>`count(${schema.voters.id})::int`,
    })
    .from(schema.parts)
    .leftJoin(schema.voters, sql`${schema.voters.partId} = ${schema.parts.id}`)
    .groupBy(schema.parts.state);

  return { voters, parts, byState };
}
