import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { ingestPdf, type Backend } from "@/lib/extraction/pipeline";
import { saveIngestResult } from "@/lib/db/persist";
import { getUser, isAdmin } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface IngestBody {
  /** URL of a PDF already uploaded to Vercel Blob by the client. */
  url?: string;
  fileName?: string;
  backend?: Backend;
  maxPages?: number;
  rpm?: number;
  concurrency?: number;
  epicVision?: boolean;
}

/**
 * Extract and persist an electoral roll PDF. The client uploads the PDF to
 * Vercel Blob first (see /api/blob/upload) and posts the blob URL here as JSON,
 * so a large roll never travels through this function's ~4.5 MB body limit.
 * Admin only.
 */
export async function POST(req: Request) {
  let blobUrl: string | undefined;
  try {
    const user = await getUser(req.headers);
    if (!isAdmin(user)) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }

    const body = (await req.json()) as IngestBody;
    blobUrl = body.url;
    if (!blobUrl) {
      return NextResponse.json(
        { error: "No file uploaded" },
        { status: 400 },
      );
    }

    const fileName = body.fileName ?? "roll.pdf";
    const backend = body.backend ?? "mistral-ocr";

    // Pull the PDF back from Blob. This transfer is server→Blob, so it's not
    // bound by the inbound request body limit.
    const res = await fetch(blobUrl);
    if (!res.ok) {
      throw new Error(`Could not fetch uploaded PDF from storage (${res.status})`);
    }
    const data = new Uint8Array(await res.arrayBuffer());

    const result = await ingestPdf(data, {
      backend,
      maxPages: body.maxPages,
      // Throttle to respect rate-limited API keys (free-tier Mistral = 4/min).
      rpm: body.rpm,
      concurrency: body.concurrency ?? 2,
      // Recover EPIC IDs via a vision pass when OCR drops them (scanned rolls).
      epicVision: body.epicVision ?? false,
      fileName,
    });
    const saved = await saveIngestResult(result, fileName);

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
  } finally {
    // Best-effort cleanup: the roll is persisted to the DB, so the uploaded PDF
    // is no longer needed whether ingestion succeeded or failed.
    if (blobUrl) {
      await del(blobUrl).catch((e) =>
        console.error("[ingest] blob cleanup failed:", e),
      );
    }
  }
}
