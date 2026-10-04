import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let dbInstance: DatabaseSync | null = null;

export function openDb(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,                 -- unit-circle | rotate | vector
      created_at TEXT NOT NULL,
      unit TEXT,
      iterations INTEGER NOT NULL,
      angle_table_version TEXT NOT NULL,
      params_json TEXT NOT NULL,          -- 原始参数
      result_json TEXT NOT NULL,          -- 结果（不含全量步骤，步骤分页查询或截断保存）
      explain_json TEXT NOT NULL,         -- 解释摘要
      steps_json TEXT NOT NULL            -- 全量单步记录（分页读取，不影响实际迭代）
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reports_kind ON reports(kind);
  `);
  return db;
}

export function getDb(dbPath: string): DatabaseSync {
  if (!dbInstance) dbInstance = openDb(dbPath);
  return dbInstance;
}

export interface StoredReport {
  id: number;
  kind: string;
  created_at: string;
  unit: string | null;
  iterations: number;
  angle_table_version: string;
  params_json: string;
  result_json: string;
  explain_json: string;
  steps_json: string;
}

export interface InsertReport {
  kind: string;
  unit: string | null;
  iterations: number;
  angleTableVersion: string;
  params: unknown;
  result: unknown;
  explain: unknown;
  steps: unknown;
}

export function insertReport(dbPath: string, r: InsertReport): number {
  const db = getDb(dbPath);
  const stmt = db.prepare(`
    INSERT INTO reports
      (kind, created_at, unit, iterations, angle_table_version,
       params_json, result_json, explain_json, steps_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    r.kind,
    new Date().toISOString(),
    r.unit,
    r.iterations,
    r.angleTableVersion,
    JSON.stringify(r.params),
    JSON.stringify(r.result),
    JSON.stringify(r.explain),
    JSON.stringify(r.steps),
  );
  return Number(info.lastInsertRowid);
}

export function getReport(dbPath: string, id: number): StoredReport | null {
  const db = getDb(dbPath);
  const row = db
    .prepare('SELECT * FROM reports WHERE id = ?')
    .get(id) as unknown as StoredReport | undefined;
  return row ?? null;
}

export function listReports(dbPath: string, limit = 20): StoredReport[] {
  const db = getDb(dbPath);
  return db
    .prepare('SELECT * FROM reports ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as StoredReport[];
}

/** 失败不得覆盖已有报告：仅在成功路径调用 insertReport。 */
