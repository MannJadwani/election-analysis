import { getDb, schema } from "./index";
import type { IngestResult } from "../extraction/pipeline";

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
