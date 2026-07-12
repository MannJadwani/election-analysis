import "dotenv/config";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { saveIngestResult } from "../lib/db/persist";
import type { IngestResult } from "../lib/extraction/pipeline";

// Load a previously-extracted JSON (from scripts/ingest.ts) into the DB.
//   npx tsx scripts/load-json.ts data/out/foo.json
async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npx tsx scripts/load-json.ts <extracted.json>");
    process.exit(1);
  }
  const result = JSON.parse(await readFile(path, "utf8")) as IngestResult;
  const saved = await saveIngestResult(result, basename(path).replace(".json", ".pdf"));
  console.log(
    `Loaded -> part #${saved.partId}, ${saved.voterCount} voters into the DB.`,
  );
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
