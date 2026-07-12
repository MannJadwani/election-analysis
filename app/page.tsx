"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface VoterRow {
  id: number;
  serialNo: number | null;
  nameEn: string;
  nameOriginal: string | null;
  relationType: string | null;
  relationNameEn: string | null;
  houseNo: string | null;
  age: number | null;
  gender: string | null;
  epicId: string | null;
  pollingStationName: string | null;
  assemblyConstituencyName: string | null;
  partNo: number | null;
}

const GENDERS = [
  { value: "", label: "All" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "third_gender", label: "Third" },
];

function genderBadge(g: string | null) {
  if (g === "male") return "M";
  if (g === "female") return "F";
  if (g === "third_gender") return "T";
  return "?";
}

export default function Home() {
  const [q, setQ] = useState("");
  const [gender, setGender] = useState("");
  const [rows, setRows] = useState<VoterRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (gender) params.set("gender", gender);
      params.set("limit", "50");
      const res = await fetch(`/api/search?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setRows(data.rows);
      setTotal(data.total);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [q, gender]);

  // Filters apply live: gender instantly, typing debounced.
  useEffect(() => {
    const t = setTimeout(() => {
      void search();
    }, 250);
    return () => clearTimeout(t);
  }, [q, gender, search]);

  return (
    <main className="mx-auto w-full max-w-5xl">
      {/* Sticky search header — the primary surface on mobile */}
      <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-950/90">
        <div className="px-4 pb-3 pt-4 sm:px-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold tracking-tight sm:text-xl">
                Electoral Roll Search
              </h1>
              <p className="hidden text-xs text-neutral-500 sm:block">
                Voter lists transliterated to English — Hindi, Kannada &amp; more
              </p>
            </div>
            <Link
              href="/upload"
              className="shrink-0 rounded-full bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white active:scale-95 dark:bg-white dark:text-neutral-900"
            >
              + Upload
            </Link>
          </div>

          <div className="relative">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              inputMode="search"
              autoComplete="off"
              placeholder="Search name, relation, or EPIC…"
              className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-base outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                aria-label="Clear"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-neutral-400 active:scale-90"
              >
                ✕
              </button>
            )}
          </div>

          {/* Gender filter as scrollable pills — thumb-friendly */}
          <div className="mt-2.5 flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {GENDERS.map((g) => (
              <button
                key={g.value}
                onClick={() => setGender(g.value)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  gender === g.value
                    ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                    : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                }`}
              >
                {g.label}
              </button>
            ))}
            <span className="ml-auto flex shrink-0 items-center pl-2 text-xs text-neutral-400">
              {loading ? "…" : `${total.toLocaleString()} voters`}
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 sm:px-6">
        {error && (
          <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {/* MOBILE: card list */}
        <ul className="flex flex-col gap-2.5 md:hidden">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold leading-tight">{r.nameEn}</div>
                  {r.nameOriginal && (
                    <div className="text-sm text-neutral-500">
                      {r.nameOriginal}
                    </div>
                  )}
                </div>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                  {genderBadge(r.gender)}
                </span>
              </div>

              {r.relationNameEn && (
                <div className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">
                  <span className="capitalize text-neutral-400">
                    {r.relationType}:{" "}
                  </span>
                  {r.relationNameEn}
                </div>
              )}

              <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs">
                {r.age != null && <Chip>Age {r.age}</Chip>}
                {r.houseNo && <Chip>House {r.houseNo}</Chip>}
                {r.epicId && <Chip mono>{r.epicId}</Chip>}
              </div>

              <div className="mt-2 truncate text-xs text-neutral-400">
                {r.assemblyConstituencyName ?? "-"}
                {r.partNo != null && ` · Part ${r.partNo}`}
              </div>
            </li>
          ))}
        </ul>

        {/* DESKTOP: table */}
        <div className="hidden overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800 md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Relation</th>
                <th className="px-3 py-2">Age</th>
                <th className="px-3 py-2">Sex</th>
                <th className="px-3 py-2">House</th>
                <th className="px-3 py-2">EPIC</th>
                <th className="px-3 py-2">Constituency / Booth</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-neutral-100 dark:border-neutral-800"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.nameEn}</div>
                    {r.nameOriginal && (
                      <div className="text-xs text-neutral-500">
                        {r.nameOriginal}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.relationNameEn ? (
                      <span>
                        <span className="text-neutral-400">
                          {r.relationType}:{" "}
                        </span>
                        {r.relationNameEn}
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-3 py-2">{r.age ?? "-"}</td>
                  <td className="px-3 py-2 capitalize">{r.gender ?? "-"}</td>
                  <td className="px-3 py-2">{r.houseNo ?? "-"}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.epicId ?? "-"}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-500">
                    {r.assemblyConstituencyName ?? "-"}
                    {r.partNo != null && ` · Part ${r.partNo}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && rows.length === 0 && !error && (
          <div className="py-16 text-center text-neutral-400">
            No voters found.
          </div>
        )}
      </div>
    </main>
  );
}

function Chip({
  children,
  mono,
}: {
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <span
      className={`rounded-md bg-neutral-100 px-2 py-1 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 ${
        mono ? "font-mono" : ""
      }`}
    >
      {children}
    </span>
  );
}
