import { z } from "zod";
import type { SearchConfig } from "./sources/types.js";

/** One API search query: a category tag + what/where the board understands. */
export const SearchSchema = z.object({
  category: z.string(),
  what: z.string(),
  where: z.string(),
});

/** The soft, judgment half of the filter — drives the curation/scoring step. */
export const CriteriaSchema = z.object({
  seniority: z.string().nullable(),
  mustHaves: z.array(z.string()),
  dealbreakers: z.array(z.string()),
  scoringRubric: z.string(),
});

/** The part the configure agent generates from a natural-language request. */
export const ParsedFilterSchema = z.object({
  country: z.string(),
  maxDaysOld: z.number(),
  resultsPerPage: z.number(),
  // When true, match each search's keywords in the job TITLE only (precise —
  // e.g. only "…Intern" titles). When false, also match the body (broader, noisier).
  titleOnly: z.boolean().default(false),
  searches: z.array(SearchSchema),
  criteria: CriteriaSchema,
});

/** The full persisted filter — parsed parts plus the raw request that produced them. */
export const FilterSchema = ParsedFilterSchema.extend({
  request: z.string(),
  // Pages of `resultsPerPage` to pull per search. 1 = first page only (daily
  // default). Bump it (e.g. hand-edit filter.json) for a one-time wide sweep.
  maxPages: z.number().default(1),
});

export type Search = z.infer<typeof SearchSchema>;
export type Criteria = z.infer<typeof CriteriaSchema>;
export type ParsedFilter = z.infer<typeof ParsedFilterSchema>;
export type Filter = z.infer<typeof FilterSchema>;

/** Extract the slice a job source needs to run its API queries. */
export function toSearchConfig(filter: Filter): SearchConfig {
  return {
    country: filter.country,
    maxDaysOld: filter.maxDaysOld,
    resultsPerPage: filter.resultsPerPage,
    maxPages: filter.maxPages,
    titleOnly: filter.titleOnly,
    searches: filter.searches,
  };
}
