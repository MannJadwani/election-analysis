import { put } from "@vercel/blob";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const BASE = "https://election-analysis-mxeop0ubd-mannjadwanis-projects.vercel.app";
const BYPASS = "23WhgHDJQRz3njayvszxfjT9SvaiJSYx";
const RAW = process.env.RAW;
const PDF = "/home/mann/Downloads/2026-EROLLGEN-S24-1-SIR-FinalRoll-Revision1-HIN-1-WI.pdf";
const STATE = "/tmp/claude-1000/-home-mann-project-election-election-analysis/31c059e6-4a0e-452f-a3f4-a921ec3941a6/scratchpad/job.json";

const h = {
  "x-vercel-protection-bypass": BYPASS,
  origin: BASE,
  cookie: `__Secure-better-auth.session_token=${RAW}; better-auth.session_token=${RAW}`,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let jobId;
if (existsSync(STATE) && process.env.POLL_ONLY) {
  ({ jobId } = JSON.parse(readFileSync(STATE, "utf8")));
  console.log("resuming poll for job", jobId);
} else {
  const bytes = readFileSync(PDF);
  const blob = await put(`realroll-${bytes.length}.pdf`, bytes, {
    access: "public",
    contentType: "application/pdf",
    addRandomSuffix: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  console.log("blob:", blob.url.slice(0, 80));
  const r = await fetch(`${BASE}/api/ingest`, {
    method: "POST",
    headers: { ...h, "content-type": "application/json" },
    body: JSON.stringify({
      url: blob.url,
      fileName: "realroll.pdf",
      backend: "mistral-ocr",
      rpm: 3,
      epicVision: true,
    }),
  });
  const start = await r.json();
  console.log("start:", r.status, JSON.stringify(start));
  jobId = start.jobId;
  writeFileSync(STATE, JSON.stringify({ jobId, blobUrl: blob.url }));
}

const deadline = Date.now() + Number(process.env.BUDGET_MS ?? 420000);
let last = -1;
while (Date.now() < deadline) {
  await sleep(15000);
  const st = await fetch(`${BASE}/api/jobs/status?id=${jobId}`, { headers: h });
  if (!st.ok) { console.log("status", st.status); continue; }
  const d = await st.json();
  const line = `[${new Date().toISOString().slice(11, 19)}] ${d.status} ${d.processedPages}/${d.totalPages ?? "?"} pages · ${d.voterCount} voters${d.resumed ? " (resumed)" : ""}${d.error ? " ERR:" + d.error : ""}`;
  if (d.processedPages !== last || d.status !== "processing") console.log(line);
  last = d.processedPages;
  if (d.status === "done" || d.status === "error") { console.log("FINAL:", JSON.stringify(d)); break; }
}
