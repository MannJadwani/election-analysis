"use client";

import Link from "next/link";
import { useState } from "react";

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

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Upload a roll</h1>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
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

        <div className="grid grid-cols-3 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-neutral-500">Backend</span>
            <select
              value={backend}
              onChange={(e) => setBackend(e.target.value)}
              className="rounded-lg border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="mistral-ocr">Mistral OCR</option>
              <option value="vision">Claude vision</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-neutral-500">Max pages</span>
            <input
              value={maxPages}
              onChange={(e) => setMaxPages(e.target.value)}
              placeholder="all"
              className="rounded-lg border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-neutral-500">Req/min cap</span>
            <input
              value={rpm}
              onChange={(e) => setRpm(e.target.value)}
              placeholder="none"
              className="rounded-lg border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
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
          className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
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
