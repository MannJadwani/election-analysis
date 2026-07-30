import { NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getUser, isAdmin } from "@/lib/auth-helpers";
import { originFromHeaders, kickStep } from "@/lib/ingest/worker";

export const dynamic = "force-dynamic";

// If a "processing" job hasn't stepped in this long, the chain dropped a link —
// re-kick it. The browser polling this endpoint is what drives the recovery.
const STALL_MS = 90_000;

/**
 * Report an ingestion job's progress for the upload UI to poll. Admin only.
 * Doubles as the self-heal trigger: a stalled (or never-started) job gets nudged.
 */
export async function GET(req: Request) {
  const user = await getUser(req.headers);
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const db = await getDb();
  const [job] = await db
    .select()
    .from(schema.ingestJobs)
    .where(eq(schema.ingestJobs.id, id));
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

  const idleMs = Date.now() - (job.lastStepAt?.getTime() ?? job.createdAt.getTime());
  const active = job.status === "pending" || job.status === "processing";
  if (active && idleMs > STALL_MS) {
    after(async () => {
      await db
        .update(schema.ingestJobs)
        .set({ lastStepAt: new Date() })
        .where(eq(schema.ingestJobs.id, job.id));
      await kickStep(originFromHeaders(req.headers), job.id);
    });
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    totalPages: job.totalPages,
    processedPages: job.processedPages,
    voterCount: job.voterCount,
    partId: job.partId,
    metadata: job.metadata,
    error: job.error,
    resumed: active && idleMs > STALL_MS,
  });
}
