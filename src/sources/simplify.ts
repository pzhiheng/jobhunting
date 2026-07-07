import type { JobSource, NormalizedJob, SearchConfig } from "./types.js";

/**
 * Community internship lists — daily-updated JSON feeds of US tech internships
 * with **direct apply links** (Greenhouse, Ashby, Workday, …). Keyless public
 * files on GitHub; far broader and fresher than the keyword aggregator.
 * Two feeds share one format (the second is a fork of the first):
 *  - SimplifyJobs / Pitt CSC (2026 cycle repo — also carries 2027-term postings)
 *  - vanshb03 / CSCareers Summer 2027 list (per-entry `season` instead of `terms`)
 * We keep only currently-open, in-window US roles; `curate` still judges fit,
 * and `dedup` collapses overlap across feeds and other sources.
 */
const FEEDS: { source: string; url: string; cycle?: string }[] = [
  {
    source: "simplify",
    url: "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json",
  },
  {
    // Whole repo is the 2027 cycle; its `season` values carry no year ("Summer"),
    // so they get qualified with the cycle year (→ "Summer 2027") at fetch time.
    source: "vansh2027",
    url: "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json",
    cycle: "2027",
  },
];
const CAP = 400; // freshest N per feed per run, to bound curate volume/cost

interface Entry {
  id: string;
  company_name: string;
  title: string;
  url: string;
  locations?: string[];
  terms?: string[]; // start terms, e.g. ["Summer 2027"]; "N/A" or absent = unstated
  season?: string; // vansh-feed variant of terms (single string)
  date_posted?: number; // unix seconds
  active?: boolean;
  is_visible?: boolean;
  category?: string; // absent on the vansh feed
  company_url?: string;
}

// The user's domains; "Software" / "Software Engineering" / "AI/ML/Data" /
// "Data Science…" all contain software|data — Hardware/Quant/Product don't.
// Entries with no category at all (vansh feed) pass; curate judges them.
const CATEGORY_RE = /software|data/i;

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "),
);
const FOREIGN_RE =
  /\b(UK|United Kingdom|Canada|India|Germany|France|Ireland|Singapore|Australia|Israel|Netherlands|Spain|Poland|Brazil|Mexico|Japan|China|Europe|EMEA|APAC|London|Toronto|Vancouver|Bangalore|Hyderabad|Berlin|Dublin|Zurich|Paris|Tel Aviv)\b/i;

/** US if it names a US state / "United States", or is a bare "Remote" with no
 *  foreign marker (the lists are US-centric). Explicit foreign locations are out. */
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

/** Stated start terms: `terms[]` (Simplify) or `season` (vansh); "N/A" = unstated. */
const realTerms = (e: Entry) => {
  const list = e.terms && e.terms.length ? e.terms : e.season ? [e.season] : [];
  return list.filter((t) => t && t !== "N/A");
};

/** Qualify a feed's yearless `season` values ("Summer") with its cycle year
 *  ("Summer 2027") so the term window and the judge can read them. */
export function qualifySeason(all: Entry[], cycle: string): Entry[] {
  return all.map((e) =>
    e.terms?.length || !e.season ? e : { ...e, terms: [`${e.season} ${cycle}`] },
  );
}

export function normalizeSimplify(entry: Entry, source = "simplify"): NormalizedJob {
  const locations = (entry.locations ?? []).filter(Boolean);
  const terms = realTerms(entry);
  return {
    id: `${source}:${entry.id}`,
    source,
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
    .filter((e) => e.category == null || CATEGORY_RE.test(e.category))
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
    const jobs: NormalizedJob[] = [];
    for (const feed of FEEDS) {
      try {
        const res = await fetch(feed.url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        let all = (await res.json()) as Entry[];
        if (feed.cycle) all = qualifySeason(all, feed.cycle);
        jobs.push(...selectEntries(all).map((e) => normalizeSimplify(e, feed.source)));
      } catch (e) {
        // One feed failing shouldn't lose the other's postings.
        console.error(`  [simplify] ${feed.source}: ${(e as Error).message}`);
      }
    }
    return jobs;
  },
};
