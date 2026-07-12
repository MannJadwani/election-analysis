import { basename } from "node:path";
import { writeFile } from "node:fs/promises";
import { loadPdf, analyzePdf, renderPages } from "../lib/pdf";

/**
 * No-API smoke test: proves PDF text extraction + page rendering work in this
 * environment (native canvas can be finicky). Renders page 3 of each PDF to a PNG
 * so we can eyeball what the vision model will actually see.
 *
 *   npx tsx scripts/smoke-pdf.ts <pdf> [pageToRender]
 */
async function main() {
  const path = process.argv[2];
  const page = Number(process.argv[3] ?? 3);
  if (!path) {
    console.error("Usage: npx tsx scripts/smoke-pdf.ts <pdf> [pageToRender]");
    process.exit(1);
  }
  const data = await loadPdf(path);
  const info = await analyzePdf(data);
  console.log(`\n${basename(path)}`);
  console.log(`  totalPages:      ${info.totalPages}`);
  console.log(`  isScanned:       ${info.isScanned}`);
  console.log(`  avgCharsPerPage: ${Math.round(info.avgCharsPerPage)}`);
  const sample = info.pages.find((p) => p.pageNumber === page)?.text ?? "";
  console.log(`  page ${page} text-layer sample (first 300 chars):`);
  console.log("  " + JSON.stringify(sample.slice(0, 300)));

  const [rendered] = await renderPages(data, { scale: 2, pageNumbers: [page] });
  if (rendered) {
    const out = `data/out/${basename(path, ".pdf")}_p${page}.png`;
    await writeFile(out, rendered.png);
    console.log(`  rendered page ${page} -> ${out} (${rendered.png.length} bytes)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
