"use client";

import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/lib/auth-client";

interface IngestResponse {
  partId: number;
  voterCount: number;
  metadata: Record<string, unknown>;
  stats: {
    backend: string;
    totalPages: number;
    processedPages: number;
    languages: string[];
    voterCount: number;
  };
  error?: string;
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [backend, setBackend] = useState("mistral-ocr");
  const [maxPages, setMaxPages] = useState("4");
  const [rpm, setRpm] = useState("3");
  const [epicVision, setEpicVision] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: session, isPending } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("backend", backend);
      if (maxPages) fd.set("maxPages", maxPages);
      if (rpm) fd.set("rpm", rpm);
      fd.set("concurrency", "1");
      fd.set("epicVision", String(epicVision));
      const res = await fetch("/api/ingest", { method: "POST", body: fd });
      const data = (await res.json()) as IngestResponse;
      if (!res.ok) throw new Error(data.error ?? "Ingest failed");
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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

        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
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
            <span className="text-neutral-500">Max pages</span>
            <input
              value={maxPages}
              onChange={(e) => setMaxPages(e.target.value)}
              inputMode="numeric"
              placeholder="all"
              className="rounded-lg border border-neutral-300 px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
            />
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
          Tip: free-tier Mistral keys allow only 4 requests/min — keep the cap at
          3 and max pages low, or extraction will hit rate limits.
        </p>

        <button
          type="submit"
          disabled={!file || busy}
          className="w-full rounded-xl bg-neutral-900 px-4 py-3.5 text-base font-medium text-white active:scale-[0.99] disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {busy ? "Extracting… (this can take a minute)" : "Extract & index"}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-6 rounded-lg border border-green-300 bg-green-50 px-4 py-4 text-sm dark:border-green-900 dark:bg-green-950">
          <div className="font-medium text-green-800 dark:text-green-300">
            Indexed {result.voterCount} voters
            {result.metadata.assembly_constituency_name
              ? ` from ${result.metadata.assembly_constituency_name}`
              : ""}
            .
          </div>
          <div className="mt-1 text-neutral-600 dark:text-neutral-400">
            {result.stats.processedPages}/{result.stats.totalPages} pages ·{" "}
            {result.stats.backend} · {result.stats.languages.join(", ")}
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
