import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadPdf } from "../lib/pdf";
import { ingestPdf } from "../lib/extraction/pipeline";
import { saveIngestResult } from "../lib/db/persist";

/**
 * CLI: extract structured voter data from an electoral roll PDF and print a preview.
 *
 *   npx tsx scripts/ingest.ts <path-to-pdf> [--backend mistral-ocr|vision]
 *       [--max <pages>] [--scale <n>] [--out <file.json>]
 *
 * mistral-ocr backend needs MISTRAL_API_KEY (and STRUCTURE_MODEL's provider key,
 * which also defaults to Mistral). vision backend needs ANTHROPIC_API_KEY.
 */

type Backend = "mistral-ocr" | "vision" | "mistral-vision";

function parseArgs(argv: string[]) {
  const args = {
    path: "",
    backend: "mistral-ocr" as Backend,
    maxPages: undefined as number | undefined,
    scale: 2,
    out: "",
    save: false,
    concurrency: 4,
    rpm: undefined as number | undefined,
    epicVision: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--max") args.maxPages = Number(argv[++i]);
    else if (a === "--scale") args.scale = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--backend") args.backend = argv[++i] as Backend;
    else if (a === "--save") args.save = true;
    else if (a === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (a === "--rpm") args.rpm = Number(argv[++i]);
    else if (a === "--epic-vision") args.epicVision = true;
    else rest.push(a);
  }
  args.path = rest[0] ?? "";
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.path) {
    console.error(
      "Usage: npx tsx scripts/ingest.ts <path-to-pdf> [--backend mistral-ocr|vision] [--max <pages>] [--scale <n>] [--out <file.json>]",
    );
    process.exit(1);
  }
  const needsMistral =
    args.backend === "mistral-ocr" || args.backend === "mistral-vision";
  if (needsMistral && !process.env.MISTRAL_API_KEY) {
    console.error("ERROR: MISTRAL_API_KEY is not set. Add it to .env or export it.");
    process.exit(1);
  }
  if (args.backend === "vision" && !process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: ANTHROPIC_API_KEY is not set. Add it to .env or export it.");
    process.exit(1);
  }

  console.log(`\nReading ${args.path}  (backend: ${args.backend}) ...`);
  const data = await loadPdf(args.path);

  const result = await ingestPdf(data, {
    backend: args.backend,
    scale: args.scale,
    maxPages: args.maxPages,
    concurrency: args.concurrency,
    rpm: args.rpm,
    epicVision: args.epicVision,
    fileName: basename(args.path),
    onProgress: (done, total, page) => {
      process.stdout.write(
        `\r  extracting pages: ${done}/${total}  (last: ${page.page_type}, ${page.voters.length} voters, ${page.source_language ?? "?"})   `,
      );
    },
  });
  process.stdout.write("\n\n");

  const { metadata: m, stats } = result;
  console.log("=== PART METADATA ===");
  console.log(`  State:        ${m.state ?? "-"}`);
  console.log(`  District:     ${m.district ?? "-"}`);
  console.log(
    `  Constituency: ${m.assembly_constituency_name ?? "-"} (${m.assembly_constituency_no ?? "-"})`,
  );
  console.log(`  Part No:      ${m.part_no ?? "-"}`);
  console.log(`  Polling stn:  ${m.polling_station_name ?? "-"}`);
  console.log(`  Revision yr:  ${m.revision_year ?? "-"}`);
  console.log(
    `  Electors:     ${m.total_electors ?? "-"} (M:${m.male_electors ?? "-"} F:${m.female_electors ?? "-"})`,
  );

  console.log("\n=== STATS ===");
  console.log(`  Pages:        ${stats.processedPages}/${stats.totalPages} processed`);
  console.log(`  Scanned PDF:  ${stats.isScanned} (avg ${stats.avgCharsPerPage} chars/page)`);
  console.log(`  Languages:    ${stats.languages.join(", ") || "-"}`);
  console.log(`  Voters found: ${stats.voterCount}`);

  console.log("\n=== FIRST 10 VOTERS ===");
  for (const v of result.voters.slice(0, 10)) {
    console.log(
      `  #${v.serial_no ?? "?"}  ${v.name_en}` +
        (v.name_original ? ` [${v.name_original}]` : "") +
        `  | ${v.relation_type}: ${v.relation_name_en ?? "-"}` +
        `  | house ${v.house_no ?? "-"} | age ${v.age ?? "-"} | ${v.gender} | ${v.epic_id ?? "-"}`,
    );
  }

  const outPath = args.out || `data/out/${basename(args.path, ".pdf")}.json`;
  await writeFile(
    outPath,
    JSON.stringify({ metadata: result.metadata, stats, voters: result.voters }, null, 2),
  );
  console.log(`\nWrote full JSON -> ${outPath}`);

  if (args.save) {
    const saved = await saveIngestResult(result, basename(args.path));
    console.log(
      `Saved to DB -> part #${saved.partId}, ${saved.voterCount} voters`,
    );
  }
  console.log();
}

main().catch((err) => {
  console.error("\nFailed:", err);
  process.exit(1);
});
