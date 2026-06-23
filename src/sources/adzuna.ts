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

async function runSearch(
  config: SearchConfig,
  search: Search,
  appId: string,
  appKey: string,
): Promise<AdzunaResult[]> {
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: String(config.resultsPerPage),
    what: search.what,
    where: search.where,
    max_days_old: String(config.maxDaysOld),
    "content-type": "application/json",
  });
  const url = `${BASE}/${config.country}/search/1?${params}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Adzuna ${res.status} for "${search.what}": ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { results?: AdzunaResult[] };
  return data.results ?? [];
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
