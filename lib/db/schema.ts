import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * A `part` is one polling booth / voter list (what a single roll PDF usually covers).
 * Voters belong to a part. Search happens mostly across voters.
 */
export const parts = pgTable(
  "parts",
  {
    id: serial("id").primaryKey(),
    state: text("state"),
    district: text("district"),
    assemblyConstituencyName: text("assembly_constituency_name"),
    assemblyConstituencyNo: integer("assembly_constituency_no"),
    partNo: integer("part_no"),
    pollingStationName: text("polling_station_name"),
    pollingStationAddress: text("polling_station_address"),
    revisionYear: integer("revision_year"),
    sourceLanguage: text("source_language"),
    totalElectors: integer("total_electors"),
    maleElectors: integer("male_electors"),
    femaleElectors: integer("female_electors"),
    thirdGenderElectors: integer("third_gender_electors"),
    /** Original PDF filename / source reference for provenance. */
    sourceFile: text("source_file"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("parts_state_idx").on(t.state),
    index("parts_ac_idx").on(t.assemblyConstituencyNo),
    uniqueIndex("parts_ac_part_year_idx").on(
      t.assemblyConstituencyNo,
      t.partNo,
      t.revisionYear,
    ),
  ],
);

export const voters = pgTable(
  "voters",
  {
    id: serial("id").primaryKey(),
    partId: integer("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    serialNo: integer("serial_no"),
    nameEn: text("name_en").notNull(),
    nameOriginal: text("name_original"),
    relationType: text("relation_type"),
    relationNameEn: text("relation_name_en"),
    relationNameOriginal: text("relation_name_original"),
    houseNo: text("house_no"),
    age: integer("age"),
    gender: text("gender"),
    epicId: text("epic_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("voters_part_idx").on(t.partId),
    index("voters_epic_idx").on(t.epicId),
    // Trigram index for fuzzy name search is added via raw SQL migration
    // (pg_trgm), since it needs the extension + gin index.
    index("voters_name_en_idx").on(t.nameEn),
  ],
);

export type Part = typeof parts.$inferSelect;
export type NewPart = typeof parts.$inferInsert;
export type VoterRow = typeof voters.$inferSelect;
export type NewVoter = typeof voters.$inferInsert;

/**
 * A resumable ingestion job. A large scanned roll can't be processed inside one
 * serverless invocation (Vercel Hobby caps functions at ~60s), so ingestion is
 * split into many short steps that each process one page and chain the next.
 * This row is the durable cursor + progress that survives across those steps.
 */
export const ingestJobs = pgTable(
  "ingest_jobs",
  {
    id: serial("id").primaryKey(),
    // pending → processing → done | error
    status: text("status").notNull().default("pending"),
    // Public Blob URL of the uploaded PDF (re-fetched by each step).
    blobUrl: text("blob_url").notNull(),
    fileName: text("file_name"),
    backend: text("backend").notNull().default("mistral-ocr"),
    // Per-key rate limit; the step scheduler spaces API calls by 60000/rpm ms.
    rpm: integer("rpm"),
    epicVision: boolean("epic_vision").notNull().default(false),
    scale: integer("scale").notNull().default(2),
    // Null until the first step runs analyzePdf.
    totalPages: integer("total_pages"),
    // 1-based cursor: the next page a step should process.
    nextPage: integer("next_page").notNull().default(1),
    processedPages: integer("processed_pages").notNull().default(0),
    voterCount: integer("voter_count").notNull().default(0),
    // The part row is created up front so voters can be inserted incrementally.
    partId: integer("part_id").references(() => parts.id, {
      onDelete: "set null",
    }),
    // Accumulated part metadata merged across pages as it's discovered.
    metadata: jsonb("metadata"),
    // Retries for the current page before the job is marked errored.
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdBy: text("created_by"),
    // Heartbeat: bumped at the start of every step; used to detect a stalled job.
    lastStepAt: timestamp("last_step_at"),
    // When the last page actually completed; used to pace API calls to the rpm cap
    // (separately from the heartbeat, which also ticks on non-working nap steps).
    lastPageAt: timestamp("last_page_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ingest_jobs_status_idx").on(t.status)],
);

export type IngestJob = typeof ingestJobs.$inferSelect;
export type NewIngestJob = typeof ingestJobs.$inferInsert;
