import { NextResponse } from "next/server";
import { ingestPdf, type Backend } from "@/lib/extraction/pipeline";
import { saveIngestResult } from "@/lib/db/persist";
import { getUser, isAdmin } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Upload an electoral roll PDF (multipart form field "file"), run extraction,
 * and persist the result. Admin only. Optional form fields: backend, maxPages.
 */
export async function POST(req: Request) {
  try {
    const user = await getUser(req.headers);
    if (!isAdmin(user)) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    const backend = (form.get("backend") as Backend) || "mistral-ocr";
    const num = (k: string) =>
      form.get(k) ? Number(form.get(k)) : undefined;
    const maxPages = num("maxPages");

    const data = new Uint8Array(await file.arrayBuffer());
    const result = await ingestPdf(data, {
      backend,
      maxPages,
      // Throttle to respect rate-limited API keys (free-tier Mistral = 4/min).
      rpm: num("rpm"),
      concurrency: num("concurrency") ?? 2,
      // Recover EPIC IDs via a vision pass when OCR drops them (scanned rolls).
      epicVision: form.get("epicVision") === "true",
      fileName: file.name,
    });
    const saved = await saveIngestResult(result, file.name);

    return NextResponse.json({
      partId: saved.partId,
      voterCount: saved.voterCount,
      metadata: result.metadata,
      stats: result.stats,
    });
  } catch (err) {
    console.error("[ingest] failed:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
