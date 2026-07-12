import { analyzePdf, renderPages } from "../pdf";
import { extractPage, extractEpics } from "./extract";
import { ocrPdf } from "./mistral-ocr";
import { structurePage } from "./structure";
import {
  partMetadataSchema,
  type PageExtraction,
  type PartMetadata,
  type Voter,
} from "./schemas";

export type Backend = "mistral-ocr" | "vision" | "mistral-vision";

export interface IngestResult {
  metadata: PartMetadata;
  voters: Voter[];
  pages: PageExtraction[];
  stats: {
    backend: Backend;
    totalPages: number;
    processedPages: number;
    isScanned: boolean;
    avgCharsPerPage: number;
    voterCount: number;
    languages: string[];
  };
}

export interface IngestOptions {
  backend?: Backend;
  scale?: number;
  /** Max pages to process (useful for quick tests). */
  maxPages?: number;
  /** Number of pages to structure/extract concurrently. */
  concurrency?: number;
  /** Requests-per-minute cap across all API calls (for rate-limited keys). */
  rpm?: number;
  /**
   * mistral-ocr only: run a vision pass to recover EPIC IDs that OCR drops
   * (common on scanned rolls). Keeps OCR's better regional-script names.
   */
  epicVision?: boolean;
  model?: string;
  fileName?: string;
  onProgress?: (done: number, total: number, page: PageExtraction) => void;
}

/**
 * A shared gate that spaces calls at least `minIntervalMs` apart, regardless of
 * how many workers call it — needed for keys with a tight requests/minute limit.
 */
function makeGate(minIntervalMs: number): () => Promise<void> {
  let last = 0;
  let chain: Promise<void> = Promise.resolve();
  return () => {
    chain = chain.then(async () => {
      const wait = Math.max(0, last + minIntervalMs - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
    });
    return chain;
  };
}

/** Merge per-page metadata fragments into one part-level record (first non-null wins). */
function mergeMetadata(pages: PageExtraction[]): PartMetadata {
  const merged: Record<string, unknown> = {};
  for (const page of pages) {
    if (!page.metadata) continue;
    for (const [k, v] of Object.entries(page.metadata)) {
      if (v != null && merged[k] == null) merged[k] = v;
    }
  }
  return partMetadataSchema.parse({
    state: null,
    district: null,
    assembly_constituency_name: null,
    assembly_constituency_no: null,
    part_no: null,
    polling_station_name: null,
    polling_station_address: null,
    revision_year: null,
    total_electors: null,
    male_electors: null,
    female_electors: null,
    third_gender_electors: null,
    ...merged,
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/**
 * Full pipeline: PDF bytes -> structured part metadata + voter list.
 *
 * Two backends:
 *  - "mistral-ocr" (default): Mistral OCR -> markdown, then a structuring LLM pass
 *    that parses records and transliterates names. Cheap; great for large docs.
 *  - "vision": render each page and hand the image to Claude for OCR+structure in
 *    one step. Robust on the messiest scans; more expensive.
 */
export async function ingestPdf(
  data: Uint8Array,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const {
    backend = "mistral-ocr",
    scale = 2,
    maxPages,
    concurrency = 4,
    rpm,
    epicVision = false,
    model,
    fileName,
  } = opts;

  // When an rpm cap is set, gate every API call through a shared throttle.
  const gate = rpm ? makeGate(Math.ceil(60000 / rpm)) : null;

  // Cheap text-layer analysis for stats (works without rendering).
  const info = await analyzePdf(data).catch(() => null);
  const totalPages = info?.totalPages ?? 0;

  let pages: PageExtraction[];
  let processedPages: number;

  if (backend === "vision" || backend === "mistral-vision") {
    // Both render the page and hand the image to a vision model. They differ only
    // in which provider/model reads it.
    const modelSpec =
      model ??
      (backend === "mistral-vision"
        ? (process.env.VISION_MODEL ?? "mistral/pixtral-12b-2409")
        : (process.env.EXTRACTION_MODEL ?? "anthropic/claude-sonnet-5"));

    const all = Array.from({ length: totalPages }, (_, i) => i + 1);
    const wanted = maxPages ? all.slice(0, maxPages) : all;
    const rendered = await renderPages(data, { scale, pageNumbers: wanted });
    processedPages = rendered.length;

    let done = 0;
    pages = await mapWithConcurrency(rendered, concurrency, async (r) => {
      if (gate) await gate();
      const textLayer = info?.pages.find(
        (p) => p.pageNumber === r.pageNumber,
      )?.text;
      const page = await extractPage(r.png, {
        pageNumber: r.pageNumber,
        textLayer,
        model: modelSpec,
      });
      done += 1;
      opts.onProgress?.(done, rendered.length, page);
      return page;
    });
  } else {
    // Mistral OCR backend.
    const pageNumbers = maxPages
      ? Array.from({ length: maxPages }, (_, i) => i + 1)
      : undefined;
    if (gate) await gate();
    const ocrPages = await ocrPdf(data, { fileName, pages: pageNumbers });
    processedPages = ocrPages.length;

    let done = 0;
    pages = await mapWithConcurrency(ocrPages, concurrency, async (p) => {
      if (gate) await gate();
      const textLayer = info?.pages.find(
        (t) => t.pageNumber === p.pageNumber,
      )?.text;
      const page = await structurePage(p.markdown, {
        pageNumber: p.pageNumber,
        textLayer,
      });

      // Backfill EPIC IDs via a vision pass when OCR dropped them (scanned rolls).
      if (epicVision && page.voters.length > 0) {
        const missing = page.voters.filter((v) => !v.epic_id).length;
        if (missing > page.voters.length / 2) {
          if (gate) await gate();
          const [rp] = await renderPages(data, {
            scale,
            pageNumbers: [p.pageNumber],
          });
          if (rp) {
            const epics = await extractEpics(rp.png, {
              pageNumber: p.pageNumber,
            });
            for (let i = 0; i < page.voters.length; i++) {
              if (!page.voters[i].epic_id && epics[i]) {
                page.voters[i].epic_id = epics[i];
              }
            }
          }
        }
      }

      done += 1;
      opts.onProgress?.(done, ocrPages.length, page);
      return page;
    });
  }

  const voters = pages.flatMap((p) => p.voters);
  const metadata = mergeMetadata(pages);
  const languages = Array.from(
    new Set(pages.map((p) => p.source_language).filter(Boolean) as string[]),
  );

  return {
    metadata,
    voters,
    pages,
    stats: {
      backend,
      totalPages: totalPages || processedPages,
      processedPages,
      isScanned: info?.isScanned ?? false,
      avgCharsPerPage: Math.round(info?.avgCharsPerPage ?? 0),
      voterCount: voters.length,
      languages,
    },
  };
}
