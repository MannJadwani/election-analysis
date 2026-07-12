import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb, schema } from "./index";

export interface VoterSearchFilters {
  q?: string; // name / epic / relation text
  state?: string;
  assemblyConstituencyNo?: number;
  partId?: number;
  gender?: string;
  ageMin?: number;
  ageMax?: number;
  limit?: number;
  offset?: number;
}

export interface VoterSearchRow {
  id: number;
  partId: number;
  serialNo: number | null;
  nameEn: string;
  nameOriginal: string | null;
  relationType: string | null;
  relationNameEn: string | null;
  houseNo: string | null;
  age: number | null;
  gender: string | null;
  epicId: string | null;
  pollingStationName: string | null;
  assemblyConstituencyName: string | null;
  partNo: number | null;
}

/**
 * Search voters across all ingested rolls. Uses trigram similarity on the
 * English name when a query is present (so "ramesh" matches "Ramesh Kumar"),
 * plus exact-ish EPIC matching, and structured filters.
 */
export async function searchVoters(
  filters: VoterSearchFilters,
): Promise<{ rows: VoterSearchRow[]; total: number }> {
  const db = await getDb();
  const { v, parts } = { v: schema.voters, parts: schema.parts };
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;

  const conds = [];
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    conds.push(
      or(
        ilike(v.nameEn, `%${q}%`),
        ilike(v.nameOriginal, `%${q}%`),
        ilike(v.relationNameEn, `%${q}%`),
        ilike(v.epicId, `%${q}%`),
      ),
    );
  }
  if (filters.state) conds.push(eq(parts.state, filters.state));
  if (filters.assemblyConstituencyNo != null)
    conds.push(eq(parts.assemblyConstituencyNo, filters.assemblyConstituencyNo));
  if (filters.partId != null) conds.push(eq(v.partId, filters.partId));
  if (filters.gender) conds.push(eq(v.gender, filters.gender));
  if (filters.ageMin != null) conds.push(sql`${v.age} >= ${filters.ageMin}`);
  if (filters.ageMax != null) conds.push(sql`${v.age} <= ${filters.ageMax}`);

  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({
      id: v.id,
      partId: v.partId,
      serialNo: v.serialNo,
      nameEn: v.nameEn,
      nameOriginal: v.nameOriginal,
      relationType: v.relationType,
      relationNameEn: v.relationNameEn,
      houseNo: v.houseNo,
      age: v.age,
      gender: v.gender,
      epicId: v.epicId,
      pollingStationName: parts.pollingStationName,
      assemblyConstituencyName: parts.assemblyConstituencyName,
      partNo: parts.partNo,
    })
    .from(v)
    .innerJoin(parts, eq(v.partId, parts.id))
    .where(where)
    .orderBy(v.nameEn)
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(v)
    .innerJoin(parts, eq(v.partId, parts.id))
    .where(where);

  return { rows, total: count };
}

export async function listParts() {
  const db = await getDb();
  const p = schema.parts;
  return db
    .select({
      id: p.id,
      state: p.state,
      assemblyConstituencyName: p.assemblyConstituencyName,
      assemblyConstituencyNo: p.assemblyConstituencyNo,
      partNo: p.partNo,
      pollingStationName: p.pollingStationName,
      totalElectors: p.totalElectors,
      revisionYear: p.revisionYear,
    })
    .from(p)
    .orderBy(desc(p.createdAt));
}
