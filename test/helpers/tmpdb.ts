/**
 * Helpers for creating isolated, throwaway libSQL databases in tests.
 * Uses in-memory URL so nothing is ever written to disk.
 */
import { openDb } from "../../src/db.js";
import type { Client } from "@libsql/client";

/** Open a fresh in-memory DB (full schema) for one test. */
export async function openTestDb(): Promise<Client> {
  return openDb(":memory:");
}

/** Open and immediately close a DB after the callback. */
export async function withTestDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = await openTestDb();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}
