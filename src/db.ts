import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

export const DATA_DIR = path.join(process.cwd(), "data");
export const DB_PATH = path.join(DATA_DIR, "cordic.db");

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      kind TEXT NOT NULL,
      input_json TEXT NOT NULL,
      unit TEXT NOT NULL,
      iterations INTEGER NOT NULL,
      table_version TEXT NOT NULL,
      result_json TEXT NOT NULL,
      explanation_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_runs_kind ON runs(kind, iterations);
  `);
  return db;
}

export interface RunRow {
  id: number;
  created_at: string;
  kind: string;
  input_json: string;
  unit: string;
  iterations: number;
  table_version: string;
  result_json: string;
  explanation_json: string;
}

/** 保存一次运行；不同迭代次数各自成行，互不覆盖。 */
export function saveRun(
  kind: string,
  input: unknown,
  unit: string,
  iterations: number,
  tableVersion: string,
  result: unknown,
  explanation: unknown,
): number {
  const stmt = getDb().prepare(
    `INSERT INTO runs (kind, input_json, unit, iterations, table_version, result_json, explanation_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const info = stmt.run(
    kind,
    JSON.stringify(input),
    unit,
    iterations,
    tableVersion,
    JSON.stringify(result),
    JSON.stringify(explanation),
  );
  return Number(info.lastInsertRowid);
}

export function getRun(id: number): RunRow | null {
  const stmt = getDb().prepare("SELECT * FROM runs WHERE id = ?");
  return (stmt.get(id) as RunRow | undefined) ?? null;
}

export function listRuns(limit = 50, offset = 0): RunRow[] {
  const stmt = getDb().prepare(
    "SELECT * FROM runs ORDER BY id DESC LIMIT ? OFFSET ?",
  );
  return stmt.all(limit, offset) as unknown as RunRow[];
}

/** 关闭连接（测试用）。 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
