import { anthropic } from "@ai-sdk/anthropic";
import { mistral } from "@ai-sdk/mistral";
import type { LanguageModel } from "ai";

/**
 * Resolve a "provider/model" string into an AI SDK language model.
 * Supported providers: `mistral`, `anthropic`.
 *
 * Used for the *structuring* step (turning OCR markdown into voter records +
 * transliteration). Defaults to Mistral so the whole Mistral-OCR pipeline needs
 * only a single MISTRAL_API_KEY.
 */
export function resolveModel(spec: string): LanguageModel {
  const [provider, ...rest] = spec.split("/");
  const modelId = rest.join("/");
  switch (provider) {
    case "mistral":
      return mistral(modelId);
    case "anthropic":
      return anthropic(modelId);
    default:
      throw new Error(
        `Unknown model provider "${provider}" in "${spec}". Use "mistral/..." or "anthropic/...".`,
      );
  }
}

/** The model used to structure OCR text into voter records. */
export function structuringModel(): LanguageModel {
  return resolveModel(
    process.env.STRUCTURE_MODEL ?? "mistral/mistral-large-latest",
  );
}
