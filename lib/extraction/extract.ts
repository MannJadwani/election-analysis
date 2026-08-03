import { generateObject } from "ai";
import { z } from "zod";
import { resolveModel } from "../ai/models";
import { pageExtractionSchema, type PageExtraction } from "./schemas";

/**
 * Default vision model, as a "provider/model" spec. Vision + non-Latin OCR +
 * transliteration is demanding, so we default to a strong model. The pipeline
 * overrides this per backend (Claude for `vision`, pixtral for `mistral-vision`).
 */
const DEFAULT_MODEL = process.env.EXTRACTION_MODEL ?? "anthropic/claude-sonnet-5";

const SYSTEM_PROMPT = `You are an expert data-extraction system for Indian electoral rolls
(voter lists published by the Election Commission of India). You are given an image of ONE
page of such a roll. The page is in a regional language/script (Kannada, Hindi/Devanagari,
Tamil, Telugu, Bengali, Marathi, or English).

Your job: read the page and return structured data.

Page types you will see:
- "cover": the title/header page naming the state, district, assembly constituency, part number.
- "summary": elector-count tables and lists of sections/streets in the part.
- "voter_grid": a grid of small boxed cards, each card = ONE voter. Typically ~30 cards per page
  in a 3-column layout. Each card shows a serial number, the voter's name, a relation
  (Father's Name / Husband's Name / Mother's Name), house number, age, gender, and an
  EPIC / voter-ID number (an alphanumeric code, often top-right of the card).
- "other": instructions, blank pages, appendices — return no voters.

Rules:
- TRANSLITERATE every name into readable English (romanization). Put the romanized form in
  *_en fields and the exact original-script text in *_original fields. Example: ರಮೇಶ -> "Ramesh".
  Use standard, widely-used spellings.
- relation_type: "father" if the card labels it Father's Name, "husband" for Husband's Name,
  "mother" for Mother's Name, "wife" for Wife's Name, otherwise "other" (or "none" if absent).
- gender: map to male / female / third_gender. If not shown, "unknown".
- Numbers (serial_no, age) must be integers; use null if unreadable.
- Preserve EPIC IDs exactly, including letters.
- If a card is partially cut off or illegible, extract what you can and set unreadable fields to null.
- Report the page's source language in source_language (lowercase, e.g. "kannada").
- Be exhaustive on voter_grid pages — do not skip cards. Return them in reading order
  (top-to-bottom within a column, then next column) as best you can.`;

export interface ExtractPageOptions {
  pageNumber: number;
  /** Optional hint about the source language to improve transliteration. */
  languageHint?: string;
  model?: string;
  /** For digital PDFs: the raw extracted text layer, given as a cross-check hint. */
  textLayer?: string;
}

/**
 * Extract structured data from a single rendered page image via the vision model.
 */
export async function extractPage(
  png: Buffer,
  opts: ExtractPageOptions,
): Promise<PageExtraction> {
  const hintParts: string[] = [];
  if (opts.languageHint) {
    hintParts.push(`Likely source language: ${opts.languageHint}.`);
  }
  if (opts.textLayer && opts.textLayer.trim().length > 0) {
    hintParts.push(
      `For reference, the PDF's embedded text layer for this page is below (it may be` +
        ` garbled or in the original script — use the image as ground truth, this is only a hint):\n"""\n${opts.textLayer.slice(0, 4000)}\n"""`,
    );
  }
  const userText =
    `This is page ${opts.pageNumber} of an electoral roll. Extract it per the rules.` +
    (hintParts.length ? `\n\n${hintParts.join("\n\n")}` : "");

  const { object } = await generateObject({
    model: resolveModel(opts.model ?? DEFAULT_MODEL),
    schema: pageExtractionSchema,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image", image: png },
        ],
      },
    ],
  });

  return object;
}

const epicPairsSchema = z.object({
  /** One entry per voter card: its serial number and its EPIC code. */
  cards: z.array(
    z.object({
      serial: z.number().int().nullable(),
      epic: z.string(),
    }),
  ),
});

export interface EpicPair {
  serial: number | null;
  epic: string;
}

/**
 * Vision pass that reads each voter card's SERIAL number + EPIC code off a page
 * image. Returning serial→EPIC pairs (rather than a bare ordered list) makes the
 * merge alignment-proof: EPICs are matched to voters by serial number, so a
 * dropped/extra card never shifts every downstream EPIC.
 *
 * Used to backfill EPIC IDs that OCR drops on scanned rolls, while keeping OCR's
 * superior handling of the (regional-script) names.
 */
export async function extractEpicPairs(
  png: Buffer,
  opts: { pageNumber: number; model?: string },
): Promise<EpicPair[]> {
  // Dedicated EPIC model: mistral-small reads the small boxed codes noticeably
  // more accurately than pixtral (30/30 vs ~29/30, fewer Q→O / dropped-digit slips).
  const modelSpec =
    opts.model ?? process.env.EPIC_MODEL ?? "mistral/mistral-small-latest";
  const { object } = await generateObject({
    model: resolveModel(modelSpec),
    schema: epicPairsSchema,
    system:
      "You read voter cards off Indian electoral-roll pages. Each card has a SERIAL number " +
      "(a small integer, usually top-left) and an EPIC / voter-ID code (usually top-right). " +
      "EPIC codes come in two formats: 3 letters + 6-8 digits (e.g. TQO0451310, ZLW4479184), " +
      "OR a slashed form like UP/84/419/0006062. Return one entry per card with its serial " +
      "and its exact EPIC code. Read every card (3-column grid, top-to-bottom then next " +
      "column). Use an empty string for any card whose code is unreadable; never invent codes.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Read the serial number and EPIC code from every voter card on page ${opts.pageNumber}.`,
          },
          { type: "image", image: png },
        ],
      },
    ],
  });
  return object.cards;
}
