# Electoral Roll → Indexable English Data

Turns Indian electoral roll PDFs (voter lists published before elections) into
clean, searchable structured data in English — across Hindi, Kannada, and other
scripts, whether the PDFs are digital or scanned.

## How it works

```
PDF ──▶ Mistral OCR ──▶ per-page markdown (real text, even when the PDF's
                         embedded Unicode map is broken, e.g. Kannada rolls)
                              │
                              ▼
             Structuring LLM pass ──▶ voter records + English transliteration
                              │            (राज कुमार → Raj Kumar, १९० → 190)
                              ▼
                  Postgres (parts + voters) ──▶ Search UI
```

Extraction backends (swap with `--backend`):

- **`mistral-ocr`** (default) — Mistral OCR → markdown, then a structuring LLM
  pass. Cheap (~$1 / 1000 pages), best regional-script name accuracy.
- **`mistral-vision`** — render each page and hand the image to a Mistral vision
  model (pixtral). Reads EPIC boxes well but weaker on regional script.
- **`vision`** — same as above but with Claude (needs `ANTHROPIC_API_KEY`). Most
  robust overall on messy scans.

**`--epic-vision`** (recommended for scanned rolls): keep `mistral-ocr` for
accurate names, but backfill EPIC IDs — which OCR drops on scanned pages — with a
targeted vision pass, merged by reading order. Best of both engines.

## Data model

`parts` (one polling booth / voter list) → `voters`
(serial, name_en, name_original, relation, house_no, age, gender, epic_id).

## Setup

```bash
cp .env.example .env      # then fill in keys
npm install
```

Required env:
- `MISTRAL_API_KEY` — for the default OCR backend (from https://console.mistral.ai)
- `DATABASE_URL` — Postgres (e.g. Neon) for storage + search
- `ANTHROPIC_API_KEY` — only for `--backend vision`
- `STRUCTURE_MODEL` — optional; `anthropic/claude-sonnet-5` gives the best
  transliteration. Defaults to `mistral/mistral-large-latest` (single-key setup).

Database:
```bash
npm run db:push        # create tables
npm run db:indexes     # add pg_trgm fuzzy-search indexes (needs psql)
```

## Extract a roll (CLI)

```bash
# preview only (writes JSON to data/out/)
npm run ingest -- data/samples/up_faizabad_ac276_sample.pdf --max 2

# extract full roll and store in Postgres
npm run ingest -- data/samples/up_faizabad_ac276_sample.pdf --save

# scanned Kannada roll: OCR names + vision EPIC recovery (throttled for free tier)
npm run ingest -- data/samples/gba_bengaluru_ward27_part1_kannada.pdf \
  --epic-vision --max 4 --concurrency 1 --rpm 3 --save

# use the Claude vision backend instead
npm run ingest -- data/samples/karnataka_ertest_part.pdf --backend vision --max 2
```

## Run the app

```bash
npm run dev     # http://localhost:3000 — search UI
```

- Upload endpoint: `POST /api/ingest` (multipart `file`, optional `backend`, `maxPages`).
- Search endpoint: `GET /api/search?q=&gender=&ac=&limit=`.

## Sample data

`data/samples/` holds real rolls for testing (gitignored):
- `up_faizabad_ac276_sample.pdf` — UP, Gosaiganj AC-276, Hindi/Devanagari
- `karnataka_ertest_part.pdf` — Bengaluru, Rajarajeshwarinagar AC-154, Part 001

## Notes on sourcing PDFs

Live CEO/ECI portals (`voters.eci.gov.in/download-eroll`) are CAPTCHA-gated with
no direct file API. Bulk acquisition options: the `in-rolls/electoral_rolls`
research corpus (Harvard Dataverse, access-gated), or a CAPTCHA-solving step
driving the ECI state → district → AC → part selection.
