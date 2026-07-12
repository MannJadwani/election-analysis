import { readFile } from "node:fs/promises";
import { pdf as renderPdf } from "pdf-to-img";
import { extractText, getDocumentProxy } from "unpdf";

export interface PdfPageText {
  pageNumber: number;
  text: string;
}

export interface PdfInfo {
  totalPages: number;
  /** Whether the PDF appears to be scanned images (little/no extractable text). */
  isScanned: boolean;
  /** Per-page extracted text (empty strings for scanned pages). */
  pages: PdfPageText[];
  /** Average extractable characters per page — the signal for scanned detection. */
  avgCharsPerPage: number;
}

/**
 * Extract the text layer and decide whether the PDF is a real digital document
 * or scanned images. Electoral rolls come both ways; scanned ones must go
 * through the vision model, digital ones can too but we can also trust text.
 */
export async function analyzePdf(data: Uint8Array): Promise<PdfInfo> {
  // pdf.js transfers & detaches the array it's given, which would zero-out the
  // caller's buffer. Hand it a copy so callers can reuse `data` afterwards.
  const doc = await getDocumentProxy(data.slice());
  const { text } = await extractText(doc, { mergePages: false });
  const pageTexts: string[] = Array.isArray(text) ? text : [text];

  const pages: PdfPageText[] = pageTexts.map((t, i) => ({
    pageNumber: i + 1,
    text: (t ?? "").trim(),
  }));

  const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0);
  const avgCharsPerPage = pages.length ? totalChars / pages.length : 0;

  // A digital voter-grid page has hundreds of characters. Scanned pages yield
  // near-zero. Threshold is deliberately low to avoid misclassifying sparse pages.
  const isScanned = avgCharsPerPage < 100;

  return {
    totalPages: doc.numPages,
    isScanned,
    pages,
    avgCharsPerPage,
  };
}

/**
 * Render selected pages of a PDF to PNG image buffers for the vision model.
 * `scale` controls resolution — 2 is a good balance of legibility vs. token cost;
 * bump to 3 for dense or poor-quality scans.
 */
export async function renderPages(
  data: Uint8Array,
  opts: { scale?: number; pageNumbers?: number[] } = {},
): Promise<{ pageNumber: number; png: Buffer }[]> {
  const { scale = 2, pageNumbers } = opts;
  const wanted = pageNumbers ? new Set(pageNumbers) : null;

  // Copy for the same buffer-detaching reason as in analyzePdf.
  const document = await renderPdf(Buffer.from(data.slice()), { scale });
  const out: { pageNumber: number; png: Buffer }[] = [];
  let pageNumber = 0;
  for await (const page of document) {
    pageNumber += 1;
    if (wanted && !wanted.has(pageNumber)) continue;
    out.push({ pageNumber, png: page });
  }
  return out;
}

export async function loadPdf(path: string): Promise<Uint8Array> {
  const buf = await readFile(path);
  return new Uint8Array(buf);
}
