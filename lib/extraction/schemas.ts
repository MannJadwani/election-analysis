import { z } from "zod";

/**
 * The shape of the data we extract from an Indian electoral roll (voter list) PDF.
 *
 * These rolls have two kinds of content:
 *  - Cover / summary pages: metadata about the "part" (one polling booth) — state,
 *    district, assembly constituency, polling station, revision year, elector counts.
 *  - Voter grid pages: a grid of small "cards", each one voter — serial no, name,
 *    relation (father/husband/mother), house no, age, gender, EPIC/voter-ID number.
 *
 * Names on the source PDF are in a regional script (Kannada, Hindi/Devanagari,
 * Tamil, ...). We ask the vision model to fill BOTH the romanized English form
 * (`name_en`) and preserve the original script (`name_original`).
 */

export const genderSchema = z.enum(["male", "female", "third_gender", "unknown"]);
export type Gender = z.infer<typeof genderSchema>;

export const relationTypeSchema = z.enum([
  "father",
  "husband",
  "mother",
  "wife",
  "other",
  "none",
]);
export type RelationType = z.infer<typeof relationTypeSchema>;

/** A single voter record extracted from one card on a grid page. */
export const voterSchema = z.object({
  /** Serial number of the voter within this part (as printed). */
  serial_no: z.number().int().nullable(),
  /** Romanized / English name. */
  name_en: z.string(),
  /** Name exactly as printed, in the original script. */
  name_original: z.string().nullable(),
  /** How the relation (father/husband/etc.) named on the card relates to the voter. */
  relation_type: relationTypeSchema,
  /** Romanized / English relation name. */
  relation_name_en: z.string().nullable(),
  /** Relation name in the original script. */
  relation_name_original: z.string().nullable(),
  /** House number as printed (kept as string — can contain letters/slashes). */
  house_no: z.string().nullable(),
  age: z.number().int().nullable(),
  gender: genderSchema,
  /** EPIC / voter ID number, e.g. "ABC1234567". */
  epic_id: z.string().nullable(),
});
export type Voter = z.infer<typeof voterSchema>;

/** Part-level (polling booth) metadata, usually found on the cover/summary pages. */
export const partMetadataSchema = z.object({
  state: z.string().nullable(),
  district: z.string().nullable(),
  /** Assembly constituency name, e.g. "Shivajinagar". */
  assembly_constituency_name: z.string().nullable(),
  /** Assembly constituency number. */
  assembly_constituency_no: z.number().int().nullable(),
  /** The part number (one part == one polling station / booth). */
  part_no: z.number().int().nullable(),
  /** Polling station name / building. */
  polling_station_name: z.string().nullable(),
  polling_station_address: z.string().nullable(),
  /** Roll revision year, e.g. 2024. */
  revision_year: z.number().int().nullable(),
  total_electors: z.number().int().nullable(),
  male_electors: z.number().int().nullable(),
  female_electors: z.number().int().nullable(),
  third_gender_electors: z.number().int().nullable(),
});
export type PartMetadata = z.infer<typeof partMetadataSchema>;

export const pageTypeSchema = z.enum([
  "cover", // title / part header page
  "summary", // elector-count summary, section list
  "voter_grid", // the grid of voter cards
  "other", // instructions, blank, appendices
]);
export type PageType = z.infer<typeof pageTypeSchema>;

/** What the vision model returns for a single page. */
export const pageExtractionSchema = z.object({
  page_type: pageTypeSchema,
  /**
   * The language/script of the source text on this page, e.g. "kannada", "hindi",
   * "english". Helps us track coverage and debug transliteration quality.
   */
  source_language: z.string().nullable(),
  /** Part metadata if this page carries any (cover/summary pages). */
  metadata: partMetadataSchema.partial().nullable(),
  /** Voter records if this is a grid page (empty otherwise). */
  voters: z.array(voterSchema),
  /** Model's note about anything unreadable / uncertain on this page. */
  notes: z.string().nullable(),
});
export type PageExtraction = z.infer<typeof pageExtractionSchema>;
