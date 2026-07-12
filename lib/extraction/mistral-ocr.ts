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

/**
 * Run Mistral OCR over an entire PDF in one call and return per-page markdown.
 *
 * Mistral OCR does its own image OCR, so it works even when the PDF's embedded
 * text layer is broken (e.g. Kannada rolls with no ToUnicode map). Text comes
 * back in the original script; transliteration happens in the structuring step.
 */
export async function ocrPdf(
  data: Uint8Array,
  opts: { fileName?: string; pages?: number[] } = {},
): Promise<OcrPage[]> {
  const c = client();

  // Upload the PDF, then OCR it via a short-lived signed URL.
  const uploaded = await c.files.upload({
    file: {
      fileName: opts.fileName ?? "roll.pdf",
      content: Buffer.from(data),
    },
    purpose: "ocr",
  });

  try {
    const signed = await c.files.getSignedUrl({ fileId: uploaded.id });
    const resp = await c.ocr.process({
      model: process.env.OCR_MODEL ?? "mistral-ocr-latest",
      document: { type: "document_url", documentUrl: signed.url },
      // Mistral's `pages` param is 0-based.
      ...(opts.pages ? { pages: opts.pages.map((p) => p - 1) } : {}),
    });

    return resp.pages
      .map((p) => ({
        // Mistral page index is 0-based.
        pageNumber: (p.index ?? 0) + 1,
        markdown: p.markdown ?? "",
      }))
      .sort((a, b) => a.pageNumber - b.pageNumber);
  } finally {
    // Best-effort cleanup of the uploaded file.
    await c.files.delete({ fileId: uploaded.id }).catch(() => {});
  }
}
