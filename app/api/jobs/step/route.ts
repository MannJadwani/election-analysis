import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { analyzePdf } from "@/lib/pdf";
import { processPage, mergeMetadataInto, type Backend } from "@/lib/extraction/pipeline";
import { uploadForOcr, deleteOcrFile } from "@/lib/extraction/mistral-ocr";
import { insertVoters, updatePartMetadata } from "@/lib/db/persist";
import { partMetadataSchema } from "@/lib/extraction/schemas";
import { workerAuthorized } from "@/lib/ingest/worker";
import { getUser, isAdmin } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";
// Hobby ignores >60; this documents intent and applies if the plan is upgraded.
export const maxDuration = 60;

const MAX_ATTEMPTS = 3;
// Abort a page ourselves before Vercel's hard 60s kill (which can't be caught),
// so a slow page becomes a retryable soft error instead of a silent job-killer.
const SOFT_MS = 48_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`page work exceeded ${ms / 1000}s`)), ms),
    ),
  ]);
}

/**
 * Process ONE page of a roll and persist it, then return. The CALLER (the upload
 * page's drive loop, or a re-run of the poller) calls this repeatedly until the
 * job is done — driving it client-side is far more reliable on Hobby than
 * server-side fire-and-forget self-chaining, which drops links. Advancing
 * `next_page` only after a page is saved (in one transaction) makes a repeated
 * call re-do at most one page.
 *
 * Auth: an admin session (the browser drive loop) or the worker secret (scripts).
 */
export async function POST(req: Request) {
  if (!workerAuthorized(req.headers)) {
    const user = await getUser(req.headers).catch(() => null);
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const db = await getDb();
  let jobId: number | undefined;
  try {
    ({ jobId } = (await req.json()) as { jobId: number });
    const [job] = await db
      .select()
      .from(schema.ingestJobs)
      .where(eq(schema.ingestJobs.id, jobId));

    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
    if (job.status === "done" || job.status === "error") {
      return NextResponse.json({ status: job.status });
    }

    // Heartbeat immediately so the status endpoint doesn't see this as stalled.
    await db
      .update(schema.ingestJobs)
      .set({ status: "processing", lastStepAt: new Date() })
      .where(eq(schema.ingestJobs.id, job.id));

    // Rate-limit: if it's too soon since the last page completed, tell the caller
    // to wait and call back — don't do work this call. The caller paces itself,
    // so we neither sleep (burning the budget) nor need PDF bytes just to wait.
    if (job.rpm && job.lastPageAt) {
      const interval = Math.ceil(60000 / job.rpm);
      const waitMs = interval - (Date.now() - job.lastPageAt.getTime());
      if (waitMs > 0) {
        return NextResponse.json({
          status: "processing",
          waiting: true,
          retryAfterMs: Math.min(interval, waitMs),
          page: job.nextPage,
        });
      }
    }

    // Re-fetch the PDF (steps are stateless).
    const res = await fetch(job.blobUrl);
    if (!res.ok) throw new Error(`fetch blob failed (${res.status})`);
    const data = new Uint8Array(await res.arrayBuffer());

    // Parse the PDF only once (first step) to learn the page count — re-parsing
    // a 12 MB file every step is wasted time and eats into the 60s budget.
    let info = null;
    let totalPages = job.totalPages ?? 0;
    if (job.totalPages == null) {
      info = await analyzePdf(data).catch(() => null);
      totalPages = info?.totalPages ?? 0;
      await db
        .update(schema.ingestJobs)
        .set({ totalPages })
        .where(eq(schema.ingestJobs.id, job.id));
    }

    // Done?
    if (totalPages > 0 && job.nextPage > totalPages) {
      if (job.ocrFileId) await deleteOcrFile(job.ocrFileId);
      await db
        .update(schema.ingestJobs)
        .set({ status: "done", ocrFileId: null })
        .where(eq(schema.ingestJobs.id, job.id));
      return NextResponse.json({ status: "done", processedPages: job.processedPages });
    }

    // mistral-ocr: upload the PDF to Mistral ONCE (its own step) so the heavy
    // ~12 MB upload never shares an invocation with per-page OCR/vision work —
    // that combination is what tripped the 60s function limit. Every later page
    // OCRs by this file id instead of re-uploading.
    let ocrFileId = job.ocrFileId ?? undefined;
    if (job.backend === "mistral-ocr" && !ocrFileId) {
      ocrFileId = await uploadForOcr(data, job.fileName ?? "roll.pdf");
      await db
        .update(schema.ingestJobs)
        .set({ ocrFileId, lastStepAt: new Date() })
        .where(eq(schema.ingestJobs.id, job.id));
      return NextResponse.json({ status: "processing", uploaded: true });
    }

    const pageNumber = job.nextPage;
    const textLayer = info?.pages.find((p) => p.pageNumber === pageNumber)?.text;

    // Count this attempt BEFORE the risky work. A page that exceeds the 60s
    // function limit is killed mid-flight — no catch runs — so without counting
    // up front it would retry forever. After MAX_ATTEMPTS, give up on the job.
    const attemptNo = job.attempts + 1;
    if (attemptNo > MAX_ATTEMPTS) {
      if (ocrFileId) await deleteOcrFile(ocrFileId);
      await db
        .update(schema.ingestJobs)
        .set({
          status: "error",
          ocrFileId: null,
          error: `page ${pageNumber} failed after ${MAX_ATTEMPTS} attempts (may exceed the 60s function limit)`,
        })
        .where(eq(schema.ingestJobs.id, job.id));
      return NextResponse.json({ status: "error", page: pageNumber });
    }
    await db
      .update(schema.ingestJobs)
      .set({ attempts: attemptNo })
      .where(eq(schema.ingestJobs.id, job.id));

    try {
      // On the final attempt, drop the extra EPIC-vision call so a heavy page
      // still saves its voters (EPIC ids may be missing for that page) instead
      // of failing the whole job. Earlier attempts keep it for full fidelity.
      const useEpic = job.epicVision && attemptNo < MAX_ATTEMPTS;
      const page = await withTimeout(
        processPage(data, pageNumber, {
          backend: job.backend as Backend,
          scale: job.scale,
          epicVision: useEpic,
          fileName: job.fileName ?? undefined,
          textLayer,
          ocrFileId,
        }),
        SOFT_MS,
      );

      const acc = mergeMetadataInto(
        { ...((job.metadata as Record<string, unknown>) ?? {}) },
        page,
      );
      const merged = partMetadataSchema.partial().parse(acc);
      const nextPage = pageNumber + 1;
      const finished = nextPage > totalPages;

      // Insert the voters, merge metadata, AND advance the cursor atomically. If
      // the invocation is killed part-way (e.g. the 60s limit), the whole tx
      // rolls back — so the page is cleanly reprocessed rather than its voters
      // being inserted twice while the cursor stays put (the 207-vs-177 bug).
      let inserted = 0;
      await db.transaction(async (tx) => {
        inserted = job.partId ? await insertVoters(job.partId, page.voters, tx) : 0;
        if (job.partId) {
          await updatePartMetadata(job.partId, merged, page.source_language ?? null, tx);
        }
        await tx
          .update(schema.ingestJobs)
          .set({
            nextPage,
            processedPages: job.processedPages + 1,
            voterCount: job.voterCount + inserted,
            metadata: acc,
            attempts: 0,
            lastStepAt: new Date(),
            lastPageAt: new Date(),
            status: finished ? "done" : "processing",
            ...(finished ? { ocrFileId: null } : {}),
          })
          .where(eq(schema.ingestJobs.id, job.id));
      });

      // Only after the tx commits is it safe to drop the Mistral upload.
      if (finished && ocrFileId) await deleteOcrFile(ocrFileId);

      return NextResponse.json({
        status: finished ? "done" : "processing",
        page: pageNumber,
        totalPages,
        voters: inserted,
      });
    } catch (pageErr) {
      // Soft failure (rate limit, transient API error). The attempt was already
      // counted up front; give up once they're exhausted, else re-kick to retry.
      // Also drop the Mistral file id: if the upload expired (e.g. the job was
      // paused for hours), clearing it makes the retry re-upload and recover.
      const giveUp = attemptNo >= MAX_ATTEMPTS;
      if (ocrFileId) await deleteOcrFile(ocrFileId);
      await db
        .update(schema.ingestJobs)
        .set({
          status: giveUp ? "error" : "processing",
          error: giveUp ? `page ${pageNumber}: ${(pageErr as Error).message}` : null,
          ocrFileId: null,
          lastStepAt: new Date(),
        })
        .where(eq(schema.ingestJobs.id, job.id));
      return NextResponse.json({
        status: giveUp ? "error" : "retrying",
        page: pageNumber,
        attempts: attemptNo,
        error: (pageErr as Error).message,
      });
    }
  } catch (err) {
    console.error("[jobs/step] failed:", err);
    if (jobId != null) {
      await db
        .update(schema.ingestJobs)
        .set({ status: "error", error: (err as Error).message })
        .where(eq(schema.ingestJobs.id, jobId))
        .catch(() => {});
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
