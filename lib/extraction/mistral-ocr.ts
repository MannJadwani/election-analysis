import { Mistral } from "@mistralai/mistralai";

export interface OcrPage {
  pageNumber: number; // 1-based
  markdown: string;
}

let _client: Mistral | undefined;
function client(): Mistral {
  if (!process.env.MISTRAL_API_KEY) {
    throw new Error("MISTRAL_API_KEY is not set.");
  }
  _client ??= new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
  return _client;
}

/** Upload a PDF to Mistral once and return its file id for reuse across OCR calls. */
export async function uploadForOcr(
  data: Uint8Array,
  fileName = "roll.pdf",
): Promise<string> {
  const uploaded = await client().files.upload({
    file: { fileName, content: Buffer.from(data) },
    purpose: "ocr",
  });
  return uploaded.id;
}

/** Delete a previously-uploaded Mistral OCR file (best-effort). */
export async function deleteOcrFile(fileId: string): Promise<void> {
  await client().files.delete({ fileId }).catch(() => {});
}

/**
 * OCR specific pages of an ALREADY-UPLOADED PDF (see uploadForOcr). Reusing one
 * upload is essential for the page-at-a-time worker: re-uploading a 12 MB roll
 * on every page would blow the serverless function's time budget.
 */
export async function ocrByFileId(
  fileId: string,
  pages?: number[],
): Promise<OcrPage[]> {
  const c = client();
  const signed = await c.files.getSignedUrl({ fileId });
  const resp = await c.ocr.process({
    model: process.env.OCR_MODEL ?? "mistral-ocr-latest",
    document: { type: "document_url", documentUrl: signed.url },
    // Mistral's `pages` param is 0-based.
    ...(pages ? { pages: pages.map((p) => p - 1) } : {}),
  });
  return resp.pages
    .map((p) => ({ pageNumber: (p.index ?? 0) + 1, markdown: p.markdown ?? "" }))
    .sort((a, b) => a.pageNumber - b.pageNumber);
}

/**
 * Run Mistral OCR over an entire PDF in one call and return per-page markdown.
 * Uploads, OCRs, and cleans up — for one-shot use (the CLI). The worker uses
 * uploadForOcr + ocrByFileId instead so the upload is amortized across pages.
 *
 * Mistral OCR does its own image OCR, so it works even when the PDF's embedded
 * text layer is broken (e.g. Kannada rolls with no ToUnicode map). Text comes
 * back in the original script; transliteration happens in the structuring step.
 */
export async function ocrPdf(
  data: Uint8Array,
  opts: { fileName?: string; pages?: number[] } = {},
): Promise<OcrPage[]> {
  const fileId = await uploadForOcr(data, opts.fileName ?? "roll.pdf");
  try {
    return await ocrByFileId(fileId, opts.pages);
  } finally {
    await deleteOcrFile(fileId);
  }
}
