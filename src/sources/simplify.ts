import type { JobSource, NormalizedJob, SearchConfig } from "./types.js";

/**
 * Simplify / Pitt CSC internship list — a community-maintained, daily-updated
 * JSON feed of US tech internships with **direct apply links** (Greenhouse,
 * Ashby, Workday, …). Keyless public file on GitHub; far broader and fresher
 * than the keyword aggregator. We keep only currently-open SWE/ML/Data roles in
 * the US; `curate` still judges fit, and `dedup` collapses overlap with the
 * other sources.
 */
const FEED =
  "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json";
const CAP = 400; // freshest N per run, to bound curate volume/cost

interface Entry {
  id: string;
  company_name: string;
  title: string;
  url: string;
  locations?: string[];
  terms?: string[]; // start terms, e.g. ["Summer 2027"]; "N/A" or absent = unstated
  date_posted?: number; // unix seconds
  active?: boolean;
  is_visible?: boolean;
  category?: string;
  company_url?: string;
}

// The user's domains; "Software" / "Software Engineering" / "AI/ML/Data" /
// "Data Science…" all contain software|data — Hardware/Quant/Product don't.
const CATEGORY_RE = /software|data/i;

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "),
);
const FOREIGN_RE =
  /\b(UK|United Kingdom|Canada|India|Germany|France|Ireland|Singapore|Australia|Israel|Netherlands|Spain|Poland|Brazil|Mexico|Japan|China|Europe|EMEA|APAC|London|Toronto|Vancouver|Bangalore|Hyderabad|Berlin|Dublin|Zurich|Paris|Tel Aviv)\b/i;

/** US if it names a US state / "United States", or is a bare "Remote" with no
 *  foreign marker (the list is US-centric). Explicit foreign locations are out. */
export function locationIsUS(loc: string): boolean {
  if (FOREIGN_RE.test(loc)) return false;
  if (/united states|,\s?USA?\b|\bU\.S\.?\b/i.test(loc)) return true;
  const m = loc.match(/,\s*([A-Z]{2})\b/);
  if (m && US_STATES.has(m[1])) return true;
  return /\bremote\b/i.test(loc);
}

function categoryOf(entry: Entry): string {
  const s = `${entry.category ?? ""} ${entry.title}`.toLowerCase();
  if (/data scien|analytics/.test(s)) return "ds";
  if (/machine|\bml\b|\bai\b|deep learning/.test(s)) return "mle";
  return "swe";
}

const realTerms = (e: Entry) => (e.terms ?? []).filter((t) => t && t !== "N/A");

export function normalizeSimplify(entry: Entry): NormalizedJob {
  const locations = (entry.locations ?? []).filter(Boolean);
  const terms = realTerms(entry);
  return {
    id: `simplify:${entry.id}`,
    source: "simplify",
    externalId: String(entry.id),
    title: entry.title,
    company: entry.company_name,
    location: locations.join("; "),
    remote: locations.some((l) => /remote/i.test(l)),
    url: entry.url,
    // Surface the start term so curate can judge it against the filter's window;
    // many postings state no term at all, and those must stay judgeable too.
    description: terms.length ? `Start term(s): ${terms.join(", ")}` : "",
    salaryMin: null,
    salaryMax: null,
    category: categoryOf(entry),
    postedAt: entry.date_posted ? new Date(entry.date_posted * 1000).toISOString() : null,
  };
}

// The hunt targets starts inside 2027 (see request.md). An entry that explicitly
// declares only non-2027 terms is skipped at fetch time so curate never pays to
// reject it; entries with no stated term always pass (companies often omit it).
const TERM_WINDOW_RE = /2027/;

/** Pure filter — exported for tests. Active + visible + in-domain + US +
 *  (undated or in-window term), freshest first. */
export function selectEntries(all: Entry[]): Entry[] {
  return all
    .filter((e) => e.active !== false && e.is_visible !== false)
    .filter((e) => CATEGORY_RE.test(e.category ?? ""))
    .filter((e) => (e.locations ?? []).some(locationIsUS))
    .filter((e) => {
      const terms = realTerms(e);
      return terms.length === 0 || terms.some((t) => TERM_WINDOW_RE.test(t));
    })
    .sort((a, b) => (b.date_posted ?? 0) - (a.date_posted ?? 0))
    .slice(0, CAP);
}

export const simplify: JobSource = {
  name: "simplify",
  async fetch(_config: SearchConfig): Promise<NormalizedJob[]> {
    const res = await fetch(FEED, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const all = (await res.json()) as Entry[];
    return selectEntries(all).map(normalizeSimplify);
  },
};
