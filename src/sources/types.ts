export interface Search {
  category: string;
  what: string;
  where: string;
}

export interface Profile {
  country: string;
  maxDaysOld: number;
  resultsPerPage: number;
  searches: Search[];
}

export interface NormalizedJob {
  id: string; // stable key: `${source}:${externalId}`
  source: string;
  externalId: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  url: string;
  description: string;
  salaryMin: number | null;
  salaryMax: number | null;
  category: string;
  postedAt: string | null; // ISO date
}

export interface JobSource {
  name: string;
  fetch(profile: Profile): Promise<NormalizedJob[]>;
}
