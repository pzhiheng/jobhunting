/**
 * Seeds a test DB with a deterministic, offline dataset so API and E2E tests
 * have exact, predictable rows without touching check-links, curate, or any LLM.
 *
 * Dataset:
 *   seed:1  — suitable, relevance 5, link ok      → Top picks + All
 *   seed:2  — unsuitable, relevance 2, link ok     → Not suitable
 *   seed:3  — suitable, relevance 3, link broken   → All (not Top picks — low rel + broken)
 *   seed:4  — suitable, relevance 5, link ok, stage=applied → Applied + Top picks
 *
 * Skills: Python (2), TypeScript (1), Go (1), Kubernetes (1)
 * Analysis row: summary + gap
 */
import type { Client } from "@libsql/client";

export interface FixtureCounts {
  total: number;
  top_picks: number;
  suitable: number;
  not_suitable: number;
  applied: number;
  broken: number;
}

export const FIXTURE_COUNTS: FixtureCounts = {
  total: 4,
  top_picks: 2,  // seed:1 and seed:4
  suitable: 3,
  not_suitable: 1,
  applied: 1,
  broken: 1,
};

export async function seedFixture(db: Client): Promise<void> {
  const now = new Date().toISOString();

  const jobs = [
    {
      id: "seed:1", source: "seed", external_id: "1",
      title: "Senior Backend Engineer", company: "Acme Corp",
      location: "New York, NY", remote: 0,
      url: "https://example.com/1",
      description: "Build distributed systems in Go and Kubernetes.",
      salary_min: 160000, salary_max: 210000, category: "swe",
      posted_at: "2026-06-22", fetched_at: now,
      relevance: 5, relevance_notes: "great fit",
      suitability: "suitable", suitability_notes: "matches resume",
      link_status: "ok", link_checked_at: now,
      stage: "not_applied", status: "reviewed",
    },
    {
      id: "seed:2", source: "seed", external_id: "2",
      title: "Junior Frontend Developer", company: "WidgetCo",
      location: "Remote", remote: 1,
      url: "https://example.com/2",
      description: "React and TypeScript, entry level.",
      salary_min: 80000, salary_max: 100000, category: "swe",
      posted_at: "2026-06-22", fetched_at: now,
      relevance: 2, relevance_notes: "too junior",
      suitability: "unsuitable", suitability_notes: "underpowered",
      link_status: "ok", link_checked_at: now,
      stage: "not_applied", status: "reviewed",
    },
    {
      id: "seed:3", source: "seed", external_id: "3",
      title: "Full Stack Engineer", company: "Foobar Inc",
      location: "San Francisco, CA", remote: 0,
      url: "https://broken.invalid/3",
      description: "Python and TypeScript.",
      salary_min: 140000, salary_max: 190000, category: "swe",
      posted_at: "2026-06-22", fetched_at: now,
      relevance: 3, relevance_notes: "ok fit",
      suitability: "suitable", suitability_notes: "matches",
      link_status: "broken", link_checked_at: now,
      stage: "not_applied", status: "reviewed",
    },
    {
      id: "seed:4", source: "seed", external_id: "4",
      title: "ML Engineer", company: "DataWorks",
      location: "Remote", remote: 1,
      url: "https://example.com/4",
      description: "Python and distributed ML systems.",
      salary_min: 170000, salary_max: 230000, category: "mle",
      posted_at: "2026-06-22", fetched_at: now,
      relevance: 5, relevance_notes: "bullseye",
      suitability: "suitable", suitability_notes: "great match",
      link_status: "ok", link_checked_at: now,
      stage: "applied", status: "reviewed",
    },
  ];

  for (const j of jobs) {
    await db.execute({
      sql: `INSERT INTO jobs (
              id, source, external_id, title, company, location, remote, url,
              description, salary_min, salary_max, category, posted_at, fetched_at,
              relevance, relevance_notes, suitability, suitability_notes,
              link_status, link_checked_at, stage, status
            ) VALUES (
              :id, :source, :external_id, :title, :company, :location, :remote, :url,
              :description, :salary_min, :salary_max, :category, :posted_at, :fetched_at,
              :relevance, :relevance_notes, :suitability, :suitability_notes,
              :link_status, :link_checked_at, :stage, :status
            )`,
      args: j as Record<string, string | number | null>,
    });
  }

  // Skills
  const skills: [string, string][] = [
    ["seed:1", "Go"],
    ["seed:1", "Kubernetes"],
    ["seed:1", "Python"],
    ["seed:3", "Python"],
    ["seed:3", "TypeScript"],
    ["seed:4", "Python"],
  ];
  for (const [jobId, skill] of skills) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO job_skills (job_id, skill) VALUES (:id, :skill)",
      args: { id: jobId, skill },
    });
  }

  // Analysis row
  const analysis = {
    totalJobs: 4,
    suitableJobs: 3,
    topSkills: [
      { skill: "Python", count: 3 },
      { skill: "Go", count: 1 },
      { skill: "Kubernetes", count: 1 },
      { skill: "TypeScript", count: 1 },
    ],
    gap: ["Kubernetes"],
    summary: "Across 4 jobs (3 suitable), top skills are Python, Go, Kubernetes. Consider learning: Kubernetes.",
  };
  await db.execute({
    sql: "INSERT INTO analyses (kind, content) VALUES ('skills', :content)",
    args: { content: JSON.stringify(analysis) },
  });
}
