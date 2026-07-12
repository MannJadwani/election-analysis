import { generateObject } from "ai";
import { structuringModel } from "../ai/models";
import { pageExtractionSchema, type PageExtraction } from "./schemas";

const SYSTEM_PROMPT = `You convert OCR'd text from ONE page of an Indian electoral roll
(voter list from the Election Commission of India) into structured data.

The OCR text is in a regional language/script (Kannada, Hindi/Devanagari, Tamil, Telugu,
Bengali, Marathi, or English) and may be noisy or slightly mis-ordered.

Page types:
- "cover": title/header page — state, district, assembly constituency, part number.
- "summary": elector-count tables, lists of sections/streets.
- "voter_grid": repeated voter records, each with a serial number, the voter's name, a
  relation (Father's Name / Husband's Name / Mother's Name), house number, age, gender,
  and an EPIC / voter-ID (an alphanumeric code like "ANB2155281").
- "other": instructions, appendices, blanks — no voters.

Rules:
- TRANSLITERATE every name to readable English romanization. Put the romanized form in
  *_en fields and the exact original-script text in *_original fields. e.g. "राज कुमार" -> "Raj Kumar".
  Use standard widely-used spellings.
- relation_type: "father" for Father's Name (पिता का नाम), "husband" for Husband's Name
  (पति का नाम), "mother" for Mother's Name, "wife" for Wife's Name, else "other" / "none".
- gender: लिंग पुरुष / male -> "male"; महिला / female -> "female"; third gender -> "third_gender";
  unknown -> "unknown".
- serial_no and age are integers (convert Indic digits like १९० -> 190); null if unreadable.
- Preserve EPIC IDs exactly. Some records may be marked deleted/विलोपित — still extract them.
- EPIC / voter-ID numbers are Latin alphanumeric (e.g. "ANB2155281"). The OCR text may omit
  them, but a RAW TEXT LAYER may be provided separately — its Devanagari is garbled and must be
  IGNORED for names, but its Latin EPIC codes are reliable. When present, mine the EPIC codes
  from it IN ORDER and assign them to the voters in the same reading order.
- Be exhaustive on voter_grid pages; do not skip records.
- source_language: lowercase, e.g. "hindi".`;

/**
 * Extract an ordered list of relation types from a page's raw text layer.
 * Recognises clean labels (Hindi/English) and the broken-font garble variants.
 */
export function relationTypesFromText(text: string): string[] {
  const re =
    /(वपतप कप नपम|पिता का नाम|Father'?s? Name|पनत कप नपम|पति का नाम|Husband'?s? Name|पत्नी का नाम|Wife'?s? Name|माता का नाम|Mother'?s? Name)/gi;
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const t = m[0];
    if (/वपतप|पिता|Father/i.test(t)) out.push("father");
    else if (/पनत|पति|Husband/i.test(t)) out.push("husband");
    else if (/पत्नी|Wife/i.test(t)) out.push("wife");
    else if (/माता|Mother/i.test(t)) out.push("mother");
  }
  return out;
}

export interface StructureOptions {
  pageNumber: number;
  /** Raw PDF text layer for this page — reliable for Latin EPIC codes only. */
  textLayer?: string;
  model?: string; // reserved; structuringModel() reads env
}

/**
 * Structure the OCR markdown of a single page into voter records + metadata,
 * transliterating names to English.
 */
export async function structurePage(
  markdown: string,
  opts: StructureOptions,
): Promise<PageExtraction> {
  if (!markdown.trim()) {
    return {
      page_type: "other",
      source_language: null,
      metadata: null,
      voters: [],
      notes: "empty page",
    };
  }

  // Pull just the Latin EPIC-like codes out of the raw text layer as a reliable hint.
  const epicHint = opts.textLayer
    ? (opts.textLayer.match(/\b[A-Z]{2,3}\d{6,8}\b/g) ?? []).join(" ")
    : "";

  // The relation label (Father's/Husband's/etc.) is more reliable in the text layer
  // than in OCR, which tends to collapse पति(husband)→पिता(father). Extract the label
  // for each voter in reading order. Handles clean text and the common broken-font
  // garble seen in Devanagari rolls (पिता→"वपतप कप नपम", पति→"पनत कप नपम").
  const relationHint = opts.textLayer
    ? relationTypesFromText(opts.textLayer).join(", ")
    : "";

  const { object } = await generateObject({
    model: structuringModel(),
    schema: pageExtractionSchema,
    system: SYSTEM_PROMPT,
    prompt:
      `This is page ${opts.pageNumber} of an electoral roll. Below is its OCR'd text ` +
      `(markdown). Extract structured data per the rules.\n\n"""\n${markdown}\n"""` +
      (epicHint
        ? `\n\nEPIC / voter-ID codes for this page, in reading order (assign these to ` +
          `the voters in the same order):\n${epicHint}`
        : "") +
      (relationHint
        ? `\n\nRelation types for the voters on this page, in reading order (from the ` +
          `more-reliable text layer — prefer these over the OCR label when they conflict):\n${relationHint}`
        : ""),
  });

  return object;
}
