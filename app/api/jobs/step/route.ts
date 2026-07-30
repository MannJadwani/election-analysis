import { NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { analyzePdf } from "@/lib/pdf";
import { processPage, mergeMetadataInto, type Backend } from "@/lib/extraction/pipeline";
import { insertVoters, updatePartMetadata } from "@/lib/db/persist";
import { partMetadataSchema } from "@/lib/extraction/schemas";
import { originFromHeaders, kickStep, workerAuthorized } from "@/lib/ingest/worker";

export const dynamic = "force-dynamic";
// Hobby ignores >60; this documents intent and applies if the plan is upgraded.
export const maxDuration = 60;

const MAX_ATTEMPTS = 3;
// Never sleep so long that the invocation risks the platform timeout.
const MAX_SLEEP_MS = 45_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

    const prevAt = job.lastStepAt?.getTime() ?? 0;
    // Heartbeat immediately so the status endpoint doesn't see this as stalled.
    await db
      .update(schema.ingestJobs)
      .set({ status: "processing", lastStepAt: new Date() })
      .where(eq(schema.ingestJobs.id, job.id));

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
      await db
        .update(schema.ingestJobs)
        .set({ status: "done" })
        .where(eq(schema.ingestJobs.id, job.id));
      return NextResponse.json({ status: "done", processedPages: job.processedPages });
    }

    // Rate-limit: space API calls by ~60000/rpm since the previous step.
    if (job.rpm && prevAt) {
      const wait = Math.min(MAX_SLEEP_MS, Math.ceil(60000 / job.rpm) - (Date.now() - prevAt));
      if (wait > 0) await sleep(wait);
    }

    const pageNumber = job.nextPage;
    const textLayer = info?.pages.find((p) => p.pageNumber === pageNumber)?.text;

    try {
      const page = await processPage(data, pageNumber, {
        backend: job.backend as Backend,
        scale: job.scale,
        epicVision: job.epicVision,
        fileName: job.fileName ?? undefined,
        textLayer,
      });

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
      await db
        .update(schema.ingestJobs)
        .set({
          nextPage,
          processedPages: job.processedPages + 1,
          voterCount: job.voterCount + inserted,
          metadata: acc,
          attempts: 0,
          lastStepAt: new Date(),
          status: finished ? "done" : "processing",
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
      // A single page failed (rate limit, transient API error). Retry it on the
      // next step up to MAX_ATTEMPTS before failing the whole job.
      const attempts = job.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await db
        .update(schema.ingestJobs)
        .set({
          attempts: giveUp ? 0 : attempts,
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
        attempts,
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
