import { NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { analyzePdf } from "@/lib/pdf";
import { processPage, mergeMetadataInto, type Backend } from "@/lib/extraction/pipeline";
import { uploadForOcr, deleteOcrFile } from "@/lib/extraction/mistral-ocr";
import { insertVoters, updatePartMetadata } from "@/lib/db/persist";
import { partMetadataSchema } from "@/lib/extraction/schemas";
import { originFromHeaders, kickStep, workerAuthorized } from "@/lib/ingest/worker";

export const dynamic = "force-dynamic";
// Hobby ignores >60; this documents intent and applies if the plan is upgraded.
export const maxDuration = 60;

const MAX_ATTEMPTS = 3;
// Longest a pacing "nap" step sleeps before re-kicking. Kept short so a working
// step never combines a long sleep with page work and trips the 60s limit.
const NAP_MS = 8_000;
// Abort a page ourselves before Vercel's hard 60s kill (which can't be caught),
// so a slow page becomes a retryable soft error instead of a silent job-killer.
const SOFT_MS = 48_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`page work exceeded ${ms / 1000}s`)), ms),
    ),
  ]);
}

/**
 * Process ONE page of a roll, persist it, and chain the next page. Guarded by a
 * shared worker secret (it runs without a user session). Idempotent-ish: it only
 * advances `next_page` after a page is saved, so a retried/duplicated step
 * re-does at most one page.
 */
export async function POST(req: Request) {
  if (!workerAuthorized(req.headers)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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

    // Rate-limit WITHOUT burning the 60s budget: if it's too soon since the last
    // page completed, nap briefly and re-kick instead of sleeping the whole
    // interval in this invocation (a long sleep + page work trips the timeout).
    // Cheap check first — don't even fetch the 12 MB PDF just to nap.
    if (job.rpm && job.lastPageAt) {
      const interval = Math.ceil(60000 / job.rpm);
      const elapsed = Date.now() - job.lastPageAt.getTime();
      if (elapsed < interval) {
        await sleep(Math.min(NAP_MS, interval - elapsed));
        after(() => kickStep(originFromHeaders(req.headers), job.id));
        return NextResponse.json({ status: "processing", waiting: true, page: job.nextPage });
      }
    }

    // Re-fetch the PDF (steps are stateless) and read its structure.
    const res = await fetch(job.blobUrl);
    if (!res.ok) throw new Error(`fetch blob failed (${res.status})`);
    const data = new Uint8Array(await res.arrayBuffer());
    const info = await analyzePdf(data).catch(() => null);
    const totalPages = job.totalPages ?? info?.totalPages ?? 0;
    if (job.totalPages == null) {
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
      after(() => kickStep(originFromHeaders(req.headers), job.id));
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

      const inserted = job.partId ? await insertVoters(job.partId, page.voters) : 0;

      // Merge this page's metadata into the accumulator and push to the part row.
      const acc = mergeMetadataInto(
        { ...((job.metadata as Record<string, unknown>) ?? {}) },
        page,
      );
      if (job.partId) {
        const merged = partMetadataSchema.partial().parse(acc);
        await updatePartMetadata(job.partId, merged, page.source_language ?? null);
      }

      const nextPage = pageNumber + 1;
      const finished = nextPage > totalPages;
      if (finished && ocrFileId) await deleteOcrFile(ocrFileId);
      await db
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

      if (!finished) {
        after(() => kickStep(originFromHeaders(req.headers), job.id));
      }
      return NextResponse.json({
        status: finished ? "done" : "processing",
        page: pageNumber,
        totalPages,
        voters: inserted,
      });
    } catch (pageErr) {
      // Soft failure (rate limit, transient API error). The attempt was already
      // counted up front; give up once they're exhausted, else re-kick to retry.
      const giveUp = attemptNo >= MAX_ATTEMPTS;
      await db
        .update(schema.ingestJobs)
        .set({
          status: giveUp ? "error" : "processing",
          error: giveUp ? `page ${pageNumber}: ${(pageErr as Error).message}` : null,
          lastStepAt: new Date(),
        })
        .where(eq(schema.ingestJobs.id, job.id));
      if (!giveUp) {
        after(() => kickStep(originFromHeaders(req.headers), job.id));
      }
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
