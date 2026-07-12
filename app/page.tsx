"use client";

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

  useEffect(() => {
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Electoral Roll Search
          </h1>
          <p className="text-sm text-neutral-500">
            Search indexed voter lists — names transliterated to English across
            Hindi, Kannada &amp; more.
          </p>
        </div>
        <a
          href="/upload"
          className="shrink-0 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          + Upload roll
        </a>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
        className="mb-6 flex flex-wrap gap-3"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, relation, or EPIC ID…"
          className="flex-1 min-w-[240px] rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">Any gender</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="third_gender">Third gender</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
        >
          Search
        </button>
      </form>

      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
          {error.includes("DATABASE_URL") && (
            <span> — set DATABASE_URL in .env and run the DB setup.</span>
          )}
        </div>
      )}

      <div className="mb-3 text-sm text-neutral-500">
        {loading ? "Searching…" : `${total.toLocaleString()} voters`}
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
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
            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-neutral-400"
                >
                  No voters found. Ingest a roll first, then search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
