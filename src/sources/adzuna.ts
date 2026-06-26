import type { JobSource, NormalizedJob, SearchConfig, Search } from "./types.js";

interface AdzunaResult {
  id: string;
  title: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  redirect_url: string;
  description?: string;
  salary_min?: number;
  salary_max?: number;
  created?: string;
  contract_time?: string;
}

const BASE = "https://api.adzuna.com/v1/api/jobs";

export const adzuna: JobSource = {
  name: "adzuna",

  async fetch(config: SearchConfig): Promise<NormalizedJob[]> {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;
    if (!appId || !appKey) {
      throw new Error(
        "Missing ADZUNA_APP_ID / ADZUNA_APP_KEY. Get a free key at https://developer.adzuna.com/ and put them in .env",
      );
    }

    const jobs: NormalizedJob[] = [];
    for (const search of config.searches) {
      const results = await runSearch(config, search, appId, appKey);
      for (const r of results) {
        jobs.push(normalize(r, search.category));
      }
    }
    return jobs;
  },
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const PAGE_DELAY_MS = 2600; // free tier allows ~25 req/min — pace pagination under it

async function runSearch(
  config: SearchConfig,
  search: Search,
  appId: string,
  appKey: string,
): Promise<AdzunaResult[]> {
  const all: AdzunaResult[] = [];
  for (let page = 1; page <= config.maxPages; page++) {
    if (page > 1) await sleep(PAGE_DELAY_MS);
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: String(config.resultsPerPage),
      what: search.what,
      where: search.where,
      max_days_old: String(config.maxDaysOld),
      "content-type": "application/json",
    });
    const res = await fetch(`${BASE}/${config.country}/search/${page}?${params}`);
    if (res.status === 429) break; // rate-limited — stop paging this search, keep what we have
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Adzuna ${res.status} for "${search.what}" (page ${page}): ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { results?: AdzunaResult[] };
    const results = data.results ?? [];
    all.push(...results);
    if (results.length < config.resultsPerPage) break; // reached the last page
  }
  return all;
}

function normalize(r: AdzunaResult, category: string): NormalizedJob {
  const location = r.location?.display_name ?? "";
  return {
    id: `adzuna:${r.id}`,
    source: "adzuna",
    externalId: r.id,
    title: r.title,
    company: r.company?.display_name ?? "",
    location,
    remote: /remote/i.test(location) || /remote/i.test(r.title),
    url: r.redirect_url,
    description: r.description ?? "",
    salaryMin: r.salary_min ?? null,
    salaryMax: r.salary_max ?? null,
    category,
    postedAt: r.created ?? null,
  };
}
