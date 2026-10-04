import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import { createServer, findFreePort } from "../src/server";

let server: http.Server;
let base = "";

before(async () => {
  const port = await findFreePort(0);
  server = createServer();
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  base = `http://127.0.0.1:${port}`;
});

after(() => server.close());

async function post(path: string, body: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

test("health", async () => {
  const res = await fetch(base + "/api/health");
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
});

test("sincos API 并读取报告（含步分页）", async () => {
  const { status, data } = await post("/api/sincos", { angle: 30, unit: "deg", iterations: 20 });
  assert.equal(status, 200);
  assert.ok(Math.abs(data.result.cos - Math.cos(Math.PI / 6)) < 1e-6);
  assert.equal(data.tableVersion, "cordic-circular-v1");
  const rep = await fetch(`${base}/api/runs/${data.id}?offset=0&limit=5`);
  const report = await rep.json();
  assert.equal(report.steps.steps.length, 5);
  assert.equal(report.steps.total, 20);
  assert.equal(report.iterations, 20);
});

test("compare 各自保存不同迭代次数", async () => {
  const { data } = await post("/api/compare", {
    kind: "sincos", angle: 45, unit: "deg", iterations: [8, 20],
  });
  assert.equal(data.results.length, 2);
  assert.equal(data.results[0].iterations, 8);
  assert.equal(data.results[1].iterations, 20);
  assert.notEqual(data.results[0].id, data.results[1].id);
  const r8 = await (await fetch(`${base}/api/runs/${data.results[0].id}`)).json();
  assert.equal(r8.iterations, 8);
});

test("batch 与错误码", async () => {
  const { data } = await post("/api/batch", {
    items: [
      { kind: "polar", x: -3, y: 4, unit: "deg", iterations: 16 },
      { kind: "sincos", angle: 1, unit: "bad", iterations: 10 },
    ],
  });
  assert.ok(data.results[0].result.magnitude > 4.9);
  assert.equal(data.results[1].error.code, "INVALID_UNIT");
  const bad = await post("/api/sincos", { angle: NaN, unit: "deg", iterations: 10 });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error.code, "INVALID_NUMBER");
});

test("polar 零向量方向未定义", async () => {
  const { data } = await post("/api/polar", { x: 0, y: 0, unit: "deg", iterations: 10 });
  assert.equal(data.result.magnitude, 0);
  assert.equal(data.result.angleDefined, false);
  assert.equal(data.result.angle, null);
});
