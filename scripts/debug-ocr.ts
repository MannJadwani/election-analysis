import "dotenv/config";
import { loadPdf } from "../lib/pdf";
import { ocrPdf } from "../lib/extraction/mistral-ocr";

// Dump raw Mistral OCR markdown for one page: npx tsx scripts/debug-ocr.ts <pdf> <page>
async function main() {
  const path = process.argv[2];
  const page = Number(process.argv[3] ?? 3);
  const data = await loadPdf(path);
  const pages = await ocrPdf(data, { pages: [page] });
  console.log(pages[0]?.markdown ?? "(no markdown)");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
