import { and, eq, ne } from "drizzle-orm";
import { getDb, schema, type Db } from "./index";
import type { IngestResult } from "../extraction/pipeline";
import type { PartMetadata, Voter } from "../extraction/schemas";

// A DB handle that can be the pooled client or a transaction — both expose the
// same query builders, so persist helpers can run inside a caller's transaction.
type Handle = Pick<Db, "insert" | "update" | "delete">;

/**
 * Persist an ingest result: upsert the part (booth), then insert its voters.
 * Returns the part id and number of voters inserted.
 */
export async function saveIngestResult(
  result: IngestResult,
  sourceFile?: string,
): Promise<{ partId: number; voterCount: number }> {
  const db = await getDb();
  const m = result.metadata;

  const [part] = await db
    .insert(schema.parts)
    .values({
      state: m.state,
      district: m.district,
      assemblyConstituencyName: m.assembly_constituency_name,
      assemblyConstituencyNo: m.assembly_constituency_no,
      partNo: m.part_no,
      pollingStationName: m.polling_station_name,
      pollingStationAddress: m.polling_station_address,
      revisionYear: m.revision_year,
      sourceLanguage: result.stats.languages[0] ?? null,
      totalElectors: m.total_electors,
      maleElectors: m.male_electors,
      femaleElectors: m.female_electors,
      thirdGenderElectors: m.third_gender_electors,
      sourceFile: sourceFile ?? null,
    })
    .returning({ id: schema.parts.id });

  const partId = part.id;

  if (result.voters.length) {
    const rows = result.voters.map((v) => ({
      partId,
      serialNo: v.serial_no,
      nameEn: v.name_en,
      nameOriginal: v.name_original,
      relationType: v.relation_type,
      relationNameEn: v.relation_name_en,
      relationNameOriginal: v.relation_name_original,
      houseNo: v.house_no,
      age: v.age,
      gender: v.gender,
      epicId: v.epic_id,
    }));
    // Chunk inserts to stay well under parameter limits.
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(schema.voters).values(rows.slice(i, i + CHUNK));
    }
  }

  return { partId, voterCount: result.voters.length };
}

/** Map partial part metadata to the parts-table column shape (nulls preserved). */
function metadataToPartColumns(m: Partial<PartMetadata>) {
  return {
    state: m.state ?? null,
    district: m.district ?? null,
    assemblyConstituencyName: m.assembly_constituency_name ?? null,
    assemblyConstituencyNo: m.assembly_constituency_no ?? null,
    partNo: m.part_no ?? null,
    pollingStationName: m.polling_station_name ?? null,
    pollingStationAddress: m.polling_station_address ?? null,
    revisionYear: m.revision_year ?? null,
    totalElectors: m.total_electors ?? null,
    maleElectors: m.male_electors ?? null,
    femaleElectors: m.female_electors ?? null,
    thirdGenderElectors: m.third_gender_electors ?? null,
  };
}

/**
 * Create an empty part row up front for a resumable ingest, so voters can be
 * inserted incrementally as each page is processed. Metadata is filled in later
 * via updatePartMetadata as it's discovered on cover/summary pages.
 */
export async function createPartShell(sourceFile?: string): Promise<number> {
  const db = await getDb();
  const [part] = await db
    .insert(schema.parts)
    .values({ sourceFile: sourceFile ?? null })
    .returning({ id: schema.parts.id });
  return part.id;
}

/** Overwrite a part's metadata columns (used as merged metadata accumulates). */
export async function updatePartMetadata(
  partId: number,
  metadata: Partial<PartMetadata>,
  language?: string | null,
  handle?: Handle,
): Promise<void> {
  const db = handle ?? (await getDb());

  // A part is uniquely identified by (constituency no, part no, revision year).
  // If this roll matches a part already in the DB (a re-upload, or a prior
  // partial ingest of the same file), replace it: drop the old row — cascading
  // its voters — so the fresh ingest wins, and to avoid the unique-index clash.
  const ac = metadata.assembly_constituency_no;
  const pn = metadata.part_no;
  const yr = metadata.revision_year;
  if (ac != null && pn != null && yr != null) {
    await db
      .delete(schema.parts)
      .where(
        and(
          eq(schema.parts.assemblyConstituencyNo, ac),
          eq(schema.parts.partNo, pn),
          eq(schema.parts.revisionYear, yr),
          ne(schema.parts.id, partId),
        ),
      );
  }

  await db
    .update(schema.parts)
    .set({
      ...metadataToPartColumns(metadata),
      sourceLanguage: language ?? null,
    })
    .where(eq(schema.parts.id, partId));
}

/** Append a page's voters to an existing part. Returns how many were inserted. */
export async function insertVoters(
  partId: number,
  voters: Voter[],
  handle?: Handle,
): Promise<number> {
  if (!voters.length) return 0;
  const db = handle ?? (await getDb());
  const rows = voters.map((v) => ({
    partId,
    serialNo: v.serial_no,
    nameEn: v.name_en,
    nameOriginal: v.name_original,
    relationType: v.relation_type,
    relationNameEn: v.relation_name_en,
    relationNameOriginal: v.relation_name_original,
    houseNo: v.house_no,
    age: v.age,
    gender: v.gender,
    epicId: v.epic_id,
  }));
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(schema.voters).values(rows.slice(i, i + CHUNK));
  }
  return rows.length;
}
