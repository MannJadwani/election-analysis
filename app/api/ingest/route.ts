import { NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { createPartShell } from "@/lib/db/persist";
import { getUser, isAdmin } from "@/lib/auth-helpers";
import type { Backend } from "@/lib/extraction/pipeline";

export const dynamic = "force-dynamic";

interface IngestBody {
  /** URL of a PDF already uploaded to Vercel Blob by the client. */
  url?: string;
  fileName?: string;
  backend?: Backend;
  rpm?: number;
  epicVision?: boolean;
  scale?: number;
}

/**
 * Start a resumable ingestion of an electoral-roll PDF. The client uploads the
 * PDF to Vercel Blob first (see /api/blob/upload) and posts the blob URL here.
 *
 * Because a large scanned roll can't be OCR'd inside one ~60s serverless
 * invocation, this route does NOT process the roll. It creates a job row + an
 * empty part, kicks the first worker step, and returns a jobId the client polls
 * via /api/jobs/status. The worker (/api/jobs/step) processes one page per
 * invocation and chains the next until done. Admin only.
 */
export async function POST(req: Request) {
  try {
    const user = await getUser(req.headers);
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = (await req.json()) as IngestBody;
    if (!body.url) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const fileName = body.fileName ?? "roll.pdf";
    const backend = body.backend ?? "mistral-ocr";

    const partId = await createPartShell(fileName);

    const db = await getDb();
    const [job] = await db
      .insert(schema.ingestJobs)
      .values({
        status: "pending",
        blobUrl: body.url,
        fileName,
        backend,
        rpm: body.rpm ?? null,
        epicVision: body.epicVision ?? false,
        scale: body.scale ?? 2,
        partId,
        createdBy: user!.id,
        metadata: {},
      })
      .returning({ id: schema.ingestJobs.id });

    // The client drives the job by calling /api/jobs/step in a loop until done.
    return NextResponse.json({ jobId: job.id, partId, status: "pending" });
  } catch (err) {
    console.error("[ingest] failed:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
