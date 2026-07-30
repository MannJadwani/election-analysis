import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getUser, isAdmin } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

/**
 * Report an ingestion job's progress for the upload UI. Read-only — the job is
 * driven by the client calling /api/jobs/step, not by polling this. Admin only.
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

  return NextResponse.json({
    id: job.id,
    status: job.status,
    totalPages: job.totalPages,
    processedPages: job.processedPages,
    voterCount: job.voterCount,
    partId: job.partId,
    metadata: job.metadata,
    error: job.error,
  });
}
