import "dotenv/config";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "../lib/db";
import { loadPdf, renderPages } from "../lib/pdf";
import { extractEpicPairs } from "../lib/extraction/extract";

/**
 * Backfill missing EPIC ids on an already-ingested part using a vision pass.
 * Re-runnable and idempotent: only touches voters whose epic_id is still null,
 * and matches EPICs to voters by SERIAL NUMBER (alignment-proof).
 *
 *   npx tsx scripts/backfill-epic.ts <partId> [--rpm N] [--pdf path] [--from page] [--overwrite]
 *
 * The PDF is fetched from the part's ingest job blob URL unless --pdf is given.
 * --overwrite re-reads and replaces EVERY voter's EPIC (to correct earlier
 * lower-accuracy reads); default only fills voters whose EPIC is still null.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const partId = Number(process.argv[2]);
  if (!partId) {
    console.error("Usage: npx tsx scripts/backfill-epic.ts <partId> [--rpm N] [--pdf path] [--from page]");
    process.exit(1);
  }
  const rpm = Number(arg("--rpm") ?? "3");
  const fromPage = Number(arg("--from") ?? "1");
  const pdfPath = arg("--pdf");
  const overwrite = flag("--overwrite");
  const intervalMs = rpm > 0 ? Math.ceil(60000 / rpm) : 0;

  const db = await getDb();

  // Load the PDF: local path or the part's ingest-job blob.
  let data: Uint8Array;
  if (pdfPath) {
    data = await loadPdf(pdfPath);
  } else {
    const res = await db.execute(
      sql`select blob_url from ingest_jobs where part_id = ${partId} order by id desc limit 1`,
    );
    const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as { blob_url: string }[];
    const url = rows[0]?.blob_url;
    if (!url) throw new Error(`No blob URL found for part ${partId}. Pass --pdf.`);
    console.log("Fetching PDF from blob…");
    const r = await fetch(url);
    data = new Uint8Array(await r.arrayBuffer());
  }

  // How many pages, and how many voters still need an EPIC?
  const [{ before }] = await db
    .select({ before: sql<number>`count(*)::int` })
    .from(schema.voters)
    .where(and(eq(schema.voters.partId, partId), isNull(schema.voters.epicId)));
  console.log(
    `Part ${partId}: ${before} missing EPIC. Mode: ${overwrite ? "OVERWRITE all" : "fill nulls"}. Rendering pages…`,
  );

  // Render sharp (scale 3) — the small EPIC codes read more accurately.
  const rendered = await renderPages(data, { scale: 3 });
  let filledTotal = 0;
  let lastCall = 0;

  for (const rp of rendered) {
    if (rp.pageNumber < fromPage) continue;
    // Pace vision calls to the rpm cap.
    if (intervalMs) {
      const wait = intervalMs - (Date.now() - lastCall);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    lastCall = Date.now();

    let pairs;
    try {
      pairs = await extractEpicPairs(rp.png, { pageNumber: rp.pageNumber });
    } catch (e) {
      console.warn(`  page ${rp.pageNumber}: vision failed (${(e as Error).message}) — skip, re-run later`);
      continue;
    }

    let filled = 0;
    for (const p of pairs) {
      if (p.serial == null || !p.epic) continue;
      const where = overwrite
        ? and(
            eq(schema.voters.partId, partId),
            eq(schema.voters.serialNo, p.serial),
          )
        : and(
            eq(schema.voters.partId, partId),
            eq(schema.voters.serialNo, p.serial),
            isNull(schema.voters.epicId),
          );
      const r = await db.update(schema.voters).set({ epicId: p.epic }).where(where);
      // drizzle-orm/postgres-js returns a result with rowCount/count on some drivers.
      const n = (r as unknown as { count?: number; rowCount?: number }).count ??
        (r as unknown as { rowCount?: number }).rowCount ?? 0;
      filled += n;
    }
    filledTotal += filled;
    console.log(`  page ${rp.pageNumber}/${rendered.length}: +${filled} EPICs (total ${filledTotal})`);
  }

  const [{ after }] = await db
    .select({ after: sql<number>`count(*)::int` })
    .from(schema.voters)
    .where(and(eq(schema.voters.partId, partId), isNull(schema.voters.epicId)));
  console.log(`\nDone. Filled ${filledTotal}. Still missing: ${after}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
