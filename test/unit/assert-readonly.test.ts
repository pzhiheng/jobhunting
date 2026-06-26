import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { assertReadOnly } from "../../src/analyze.js";

describe("assertReadOnly", () => {
  // --- allowed ---
  test("allows a bare SELECT", () => {
    assert.equal(assertReadOnly("SELECT 1"), "SELECT 1");
  });

  test("allows SELECT with trailing semicolon (strips it)", () => {
    assert.equal(assertReadOnly("SELECT * FROM jobs;"), "SELECT * FROM jobs");
  });

  test("allows WITH (CTE)", () => {
    const cte = "WITH t AS (SELECT 1) SELECT * FROM t";
    assert.equal(assertReadOnly(cte), cte);
  });

  test("is case-insensitive for SELECT/WITH", () => {
    assert.equal(assertReadOnly("select * from jobs"), "select * from jobs");
  });

  test("strips multiple trailing semicolons", () => {
    assert.equal(assertReadOnly("SELECT 1;;;"), "SELECT 1");
  });

  // --- rejected: wrong start ---
  test("rejects INSERT", () => {
    assert.throws(() => assertReadOnly("INSERT INTO jobs VALUES (1)"), /read-only/);
  });

  test("rejects UPDATE", () => {
    assert.throws(() => assertReadOnly("UPDATE jobs SET status='new'"), /read-only/);
  });

  test("rejects DELETE", () => {
    assert.throws(() => assertReadOnly("DELETE FROM jobs"), /read-only/);
  });

  test("rejects DROP", () => {
    assert.throws(() => assertReadOnly("DROP TABLE jobs"), /read-only/);
  });

  test("rejects PRAGMA", () => {
    assert.throws(() => assertReadOnly("PRAGMA integrity_check"), /read-only/);
  });

  // --- rejected: mutating keyword embedded in SELECT ---
  test("rejects SELECT containing DELETE", () => {
    assert.throws(
      () => assertReadOnly("SELECT * FROM jobs; DELETE FROM jobs"),
      /only one statement/,
    );
  });

  test("rejects SELECT with embedded DROP keyword", () => {
    assert.throws(
      () => assertReadOnly("SELECT drop FROM jobs"),
      /mutating keyword/,
    );
  });

  test("rejects multi-statement via embedded semicolon", () => {
    assert.throws(
      () => assertReadOnly("SELECT 1; SELECT 2"),
      /only one statement/,
    );
  });
});
