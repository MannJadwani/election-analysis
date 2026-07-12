import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
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
