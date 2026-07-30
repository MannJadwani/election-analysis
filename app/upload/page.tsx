"use client";

import Link from "next/link";
import { useState } from "react";
import { upload } from "@vercel/blob/client";
import { useSession } from "@/lib/auth-client";

interface JobStatus {
  id: number;
  status: "pending" | "processing" | "done" | "error";
  totalPages: number | null;
  processedPages: number;
  voterCount: number;
  partId: number | null;
  metadata: Record<string, unknown> | null;
  error: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [backend, setBackend] = useState("mistral-ocr");
  const [rpm, setRpm] = useState("3");
  const [epicVision, setEpicVision] = useState(true);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"uploading" | "starting" | "processing" | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: session, isPending } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setJob(null);
    try {
      // Upload the PDF straight to Blob so a large roll never hits the serverless
      // request body limit (FUNCTION_PAYLOAD_TOO_LARGE / HTTP 413).
      setPhase("uploading");
      const blob = await upload(file.name, file, {
        access: "public",
        contentType: "application/pdf",
        handleUploadUrl: "/api/blob/upload",
      });

      // Start a resumable ingestion job (one page per serverless step) — this
      // returns immediately with a jobId; the work happens in the background.
      setPhase("starting");
      const startRes = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: blob.url,
          fileName: file.name,
          backend,
          rpm: rpm ? Number(rpm) : undefined,
          epicVision,
        }),
      });
      const startBody = await startRes.text();
      let start: { jobId?: number; error?: string } = {};
      try {
        start = JSON.parse(startBody);
      } catch {
        throw new Error(
          `Couldn't start ingestion (HTTP ${startRes.status}): ${startBody.slice(0, 300) || "empty response"}`,
        );
      }
      if (!startRes.ok || !start.jobId) {
        throw new Error(start.error ?? `Couldn't start ingestion (HTTP ${startRes.status})`);
      }

      // Drive the job one page at a time. Calling the worker directly and
      // awaiting each step is far more reliable on Vercel's free tier than
      // server-side self-chaining (fire-and-forget kicks drop links). This is
      // why the tab must stay open — it IS the driver. A dropped connection just
      // pauses; reopening resumes from the saved cursor.
      setPhase("processing");
      const jobId = start.jobId;
      let done = false;
      while (!done) {
        const r = await fetch("/api/jobs/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        });
        if (!r.ok) {
          // Transient (e.g. a cold-start 500) — pause briefly and try again.
          await sleep(2500);
          continue;
        }
        const d = (await r.json()) as {
          status: string;
          waiting?: boolean;
          retryAfterMs?: number;
          error?: string;
        };
        if (d.status === "error") throw new Error(d.error ?? "Ingestion failed");
        if (d.status === "done") done = true;
        else if (d.waiting) await sleep(d.retryAfterMs ?? 2000);

        // Refresh the progress display after any step that changed state.
        if (!d.waiting) {
          const st = await fetch(`/api/jobs/status?id=${jobId}`);
          if (st.ok) setJob((await st.json()) as JobStatus);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setPhase(null);
    }
  }

  if (!isPending && !isAdmin) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-neutral-500">
          Uploading rolls is restricted to administrators.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-full bg-neutral-100 px-4 py-2 text-sm font-medium dark:bg-neutral-800"
        >
          ← Back to search
        </Link>
      </main>
    );
  }

  const pct =
    job?.totalPages && job.totalPages > 0
      ? Math.round((job.processedPages / job.totalPages) * 100)
      : null;
  const buttonLabel =
    phase === "uploading"
      ? "Uploading…"
      : phase === "starting"
        ? "Starting…"
        : phase === "processing"
          ? "Extracting…"
          : "Extract & index";

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          Upload a roll
        </h1>
        <Link
          href="/"
          className="rounded-full bg-neutral-100 px-3.5 py-2 text-sm font-medium active:scale-95 dark:bg-neutral-800"
        >
          ← Search
        </Link>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <label className="block cursor-pointer rounded-lg border-2 border-dashed border-neutral-300 p-8 text-center hover:border-neutral-400 dark:border-neutral-700">
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <span className="font-medium">{file.name}</span>
          ) : (
            <span className="text-neutral-500">
              Click to choose an electoral roll PDF
            </span>
          )}
        </label>

        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-neutral-500">Backend</span>
            <select
              value={backend}
              onChange={(e) => setBackend(e.target.value)}
              className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="mistral-ocr">Mistral OCR</option>
              <option value="mistral-vision">Mistral vision</option>
              <option value="vision">Claude vision</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-neutral-500">Req/min cap</span>
            <input
              value={rpm}
              onChange={(e) => setRpm(e.target.value)}
              inputMode="numeric"
              placeholder="none"
              className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={epicVision}
            onChange={(e) => setEpicVision(e.target.checked)}
          />
          <span>
            Recover EPIC IDs with a vision pass (needed for scanned rolls; adds
            one call per grid page)
          </span>
        </label>
        <p className="text-xs text-neutral-500">
          The whole roll is processed one page at a time in the background — large
          rolls just take longer. Keep this tab open until it finishes. On a
          free-tier Mistral key (4 requests/min), keep the cap at 3.
        </p>

        <button
          type="submit"
          disabled={!file || busy}
          className="w-full rounded-xl bg-neutral-900 px-4 py-3.5 text-base font-medium text-white active:scale-[0.99] disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {buttonLabel}
        </button>
      </form>

      {busy && phase === "processing" && job && (
        <div className="mt-6 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-2 flex items-center justify-between font-medium">
            <span>Extracting…</span>
            <span className="tabular-nums text-neutral-600 dark:text-neutral-400">
              {job.totalPages
                ? `${job.processedPages}/${job.totalPages} pages`
                : `${job.processedPages} pages`}
              {" · "}
              {job.voterCount} voters
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className="h-full rounded-full bg-neutral-900 transition-all dark:bg-white"
              style={{ width: `${pct ?? 8}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
          {job && job.processedPages > 0 && (
            <div className="mt-1 text-red-600/80 dark:text-red-300/80">
              Indexed {job.voterCount} voters from {job.processedPages} pages
              before stopping.
            </div>
          )}
        </div>
      )}

      {job?.status === "done" && (
        <div className="mt-6 rounded-lg border border-green-300 bg-green-50 px-4 py-4 text-sm dark:border-green-900 dark:bg-green-950">
          <div className="font-medium text-green-800 dark:text-green-300">
            Indexed {job.voterCount} voters
            {(job.metadata?.assembly_constituency_name as string)
              ? ` from ${job.metadata!.assembly_constituency_name as string}`
              : ""}
            .
          </div>
          <div className="mt-1 text-neutral-600 dark:text-neutral-400">
            {job.processedPages}/{job.totalPages ?? job.processedPages} pages · {backend}
          </div>
          <Link
            href="/"
            className="mt-3 inline-block text-blue-600 hover:underline"
          >
            Search the indexed voters →
          </Link>
        </div>
      )}
    </main>
  );
}
