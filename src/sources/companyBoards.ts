import { readFileSync } from "node:fs";
import type { JobSource, NormalizedJob, SearchConfig } from "./types.js";

/**
 * Company career boards (Greenhouse / Lever / Ashby) — keyless public APIs that
 * return the employer's **direct apply URL** (unlike Adzuna, which only hands back
 * a bot-blocked redirect). Each board is per-company, so the target companies are
 * configured in `companies.json` (board token = the slug in the board's URL).
 *
 * These boards list *all* of a company's roles, so we keep only postings whose
 * title matches the filter's intent (intern gate + role keywords derived from the
 * Adzuna `searches`). Judgment of fit is still left to `curate`.
 */
const COMPANIES_PATH = new URL("../../companies.json", import.meta.url).pathname;
const PER_COMPANY_CAP = 40; // safety bound so one company can't flood a run

interface Companies {
  greenhouse?: string[];
  lever?: string[];
  ashby?: string[];
}

// "intern" / "interns" / "internship(s)" as a whole word — NOT "internal".
const INTERN_RE = /\bintern(ships?|s)?\b/i;
const STOP = new Set([
  "intern", "interns", "internship", "internships", "new", "grad", "graduate",
  "junior", "senior", "entry", "level", "summer", "fall", "co-op", "coop",
  "the", "and", "for", "with",
]);

/** Title filter derived from the filter's searches: require "intern" when the
 *  searches are intern-focused, and require at least one role keyword. */
export function makeKeepFilter(searches: SearchConfig["searches"]): (title: string) => boolean {
  const wantsIntern = searches.some((s) => INTERN_RE.test(s.what));
  const roleWords = Array.from(
    new Set(
      searches
        .flatMap((s) => s.what.toLowerCase().split(/[^a-z]+/))
        .filter((w) => w.length >= 3 && !STOP.has(w)),
    ),
  );
  return (title: string) => {
    if (wantsIntern && !INTERN_RE.test(title)) return false;
    const t = title.toLowerCase();
    return roleWords.length === 0 || roleWords.some((w) => t.includes(w));
  };
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function take<T>(rows: T[], keep: (t: string) => boolean, title: (r: T) => string): T[] {
  const out: T[] = [];
  for (const r of rows) {
    if (keep(title(r))) out.push(r);
    if (out.length >= PER_COMPANY_CAP) break;
  }
  return out;
}

async function greenhouse(company: string, keep: (t: string) => boolean): Promise<NormalizedJob[]> {
  const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${company}/jobs?content=true`);
  return take<any>(data.jobs ?? [], keep, (j) => j.title ?? "").map((j) => {
    const location = j.location?.name ?? "";
    return {
      id: `greenhouse:${company}:${j.id}`,
      source: "greenhouse",
      externalId: `${company}:${j.id}`,
      title: j.title,
      company: j.company_name || company,
      location,
      remote: /remote/i.test(location) || /remote/i.test(j.title ?? ""),
      url: j.absolute_url,
      description: stripHtml(j.content ?? ""),
      salaryMin: null,
      salaryMax: null,
      category: "internship",
      postedAt: j.first_published ?? j.updated_at ?? null,
    };
  });
}

async function lever(company: string, keep: (t: string) => boolean): Promise<NormalizedJob[]> {
  const data = await getJson(`https://api.lever.co/v0/postings/${company}?mode=json`);
  const rows = Array.isArray(data) ? data : [];
  return take<any>(rows, keep, (j) => j.text ?? "").map((j) => {
    const location = j.categories?.location ?? "";
    return {
      id: `lever:${company}:${j.id}`,
      source: "lever",
      externalId: `${company}:${j.id}`,
      title: j.text,
      company,
      location,
      remote: j.workplaceType === "remote" || /remote/i.test(location) || /remote/i.test(j.text ?? ""),
      url: j.hostedUrl,
      description: j.descriptionPlain ?? "",
      salaryMin: null,
      salaryMax: null,
      category: "internship",
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    };
  });
}

async function ashby(company: string, keep: (t: string) => boolean): Promise<NormalizedJob[]> {
  const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${company}`);
  return take<any>(data.jobs ?? [], keep, (j) => j.title ?? "").map((j) => {
    const location = j.location ?? "";
    return {
      id: `ashby:${company}:${j.id}`,
      source: "ashby",
      externalId: `${company}:${j.id}`,
      title: j.title,
      company,
      location,
      remote: !!j.isRemote || /remote/i.test(location) || /remote/i.test(j.title ?? ""),
      url: j.jobUrl,
      description: j.descriptionPlain ?? "",
      salaryMin: null,
      salaryMax: null,
      category: "internship",
      postedAt: j.publishedAt ?? null,
    };
  });
}

export const companyBoards: JobSource = {
  name: "company-boards",

  async fetch(config: SearchConfig): Promise<NormalizedJob[]> {
    let companies: Companies;
    try {
      companies = JSON.parse(readFileSync(COMPANIES_PATH, "utf8"));
    } catch {
      return []; // no companies.json → nothing to do, let Adzuna carry the run
    }

    const keep = makeKeepFilter(config.searches);
    const jobs: NormalizedJob[] = [];
    const run = (label: string, fn: () => Promise<NormalizedJob[]>) =>
      fn()
        .then((js) => void jobs.push(...js))
        .catch((e) => console.error(`  [company-boards] ${label}: ${(e as Error).message}`));

    await Promise.all([
      ...(companies.greenhouse ?? []).map((c) => run(`greenhouse/${c}`, () => greenhouse(c, keep))),
      ...(companies.lever ?? []).map((c) => run(`lever/${c}`, () => lever(c, keep))),
      ...(companies.ashby ?? []).map((c) => run(`ashby/${c}`, () => ashby(c, keep))),
    ]);

    return jobs;
  },
};
