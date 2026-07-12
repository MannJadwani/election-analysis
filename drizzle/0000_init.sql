CREATE TABLE "parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" text,
	"district" text,
	"assembly_constituency_name" text,
	"assembly_constituency_no" integer,
	"part_no" integer,
	"polling_station_name" text,
	"polling_station_address" text,
	"revision_year" integer,
	"source_language" text,
	"total_electors" integer,
	"male_electors" integer,
	"female_electors" integer,
	"third_gender_electors" integer,
	"source_file" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voters" (
	"id" serial PRIMARY KEY NOT NULL,
	"part_id" integer NOT NULL,
	"serial_no" integer,
	"name_en" text NOT NULL,
	"name_original" text,
	"relation_type" text,
	"relation_name_en" text,
	"relation_name_original" text,
	"house_no" text,
	"age" integer,
	"gender" text,
	"epic_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voters" ADD CONSTRAINT "voters_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parts_state_idx" ON "parts" USING btree ("state");--> statement-breakpoint
CREATE INDEX "parts_ac_idx" ON "parts" USING btree ("assembly_constituency_no");--> statement-breakpoint
CREATE UNIQUE INDEX "parts_ac_part_year_idx" ON "parts" USING btree ("assembly_constituency_no","part_no","revision_year");--> statement-breakpoint
CREATE INDEX "voters_part_idx" ON "voters" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "voters_epic_idx" ON "voters" USING btree ("epic_id");--> statement-breakpoint
CREATE INDEX "voters_name_en_idx" ON "voters" USING btree ("name_en");