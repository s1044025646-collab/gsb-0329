import * as http from "node:http";
import * as net from "node:net";
import {
  ApiError, MAX_BATCH, MAX_STEPS_RETURNED,
  computePolar, computeRotate, computeSincos,
  pageSteps, requireFinite, requireIterations, requireUnit,
} from "./service";
import { getRun, listRuns, saveRun } from "./db";
import { MAX_ITERATIONS, MIN_ITERATIONS, TABLE_VERSION } from "./cordic";

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 1000000) reject(new ApiError("PAYLOAD_TOO_LARGE", "请求体过大", 413));
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new ApiError("INVALID_JSON", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

type ComputeKind = "sincos" | "rotate" | "polar";

function runCompute(kind: ComputeKind, p: Record<string, unknown>) {
  const unit = requireUnit(p.unit);
  const n = requireIterations(p.iterations);
  if (kind === "sincos") {
    const angle = requireFinite(p.angle, "angle");
    return computeSincos(angle, unit, n);
  }
  if (kind === "rotate") {
    const x = requireFinite(p.x, "x");
    const y = requireFinite(p.y, "y");
    const angle = requireFinite(p.angle, "angle");
    return computeRotate(x, y, angle, unit, n);
  }
  const x = requireFinite(p.x, "x");
  const y = requireFinite(p.y, "y");
  return computePolar(x, y, unit, n);
}

function persist(out: ReturnType<typeof runCompute>): number {
  const { steps, ...rest } = out;
  return saveRun(
    out.kind,
    out.input,
    out.input.unit,
    out.iterations,
    out.tableVersion,
    (rest as { result: unknown }).result,
    { ...(rest as { explanation: object }).explanation, steps },
  );
}

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const p = url.pathname;
      if (req.method === "GET" && p === "/api/health") {
        return json(res, 200, {
          ok: true,
          tableVersion: TABLE_VERSION,
          iterationRange: [MIN_ITERATIONS, MAX_ITERATIONS],
          maxStepsReturned: MAX_STEPS_RETURNED,
          maxBatch: MAX_BATCH,
        });
      }
      if (req.method === "POST" && ["/api/sincos", "/api/rotate", "/api/polar"].includes(p)) {
        const kind = p.slice("/api/".length) as ComputeKind;
        const body = (await readBody(req)) as Record<string, unknown>;
        const out = runCompute(kind, body);
        const id = persist(out);
        return json(res, 200, { id, ...out });
      }
      if (req.method === "POST" && p === "/api/batch") {
        const body = (await readBody(req)) as {
          items?: Array<Record<string, unknown> & { kind?: string }>;
        };
        if (!Array.isArray(body.items) || body.items.length === 0) {
          throw new ApiError("INVALID_BATCH", "items 必须是非空数组");
        }
        if (body.items.length > MAX_BATCH) {
          throw new ApiError("BATCH_TOO_LARGE", "批量上限为 " + MAX_BATCH);
        }
        const results = body.items.map((item, idx) => {
          try {
            const kind = item.kind as ComputeKind;
            if (!["sincos", "rotate", "polar"].includes(kind)) {
              throw new ApiError("INVALID_KIND", "第 " + idx + " 项 kind 必须是 sincos/rotate/polar");
            }
            const out = runCompute(kind, item);
            const id = persist(out);
            return { index: idx, id, ...out };
          } catch (e) {
            if (e instanceof ApiError) return { index: idx, error: { code: e.code, message: e.message } };
            throw e;
          }
        });
        return json(res, 200, { results });
      }
      if (req.method === "POST" && p === "/api/compare") {
        const body = (await readBody(req)) as Record<string, unknown> & { iterations?: unknown };
        const list = body.iterations;
        if (!Array.isArray(list) || list.length === 0 || list.length > 8) {
          throw new ApiError("INVALID_COMPARE", "iterations 必须是 1..8 个整数的数组");
        }
        const kind = body.kind as ComputeKind;
        if (!["sincos", "rotate", "polar"].includes(kind)) {
          throw new ApiError("INVALID_KIND", "kind 必须是 sincos/rotate/polar");
        }
        const results = list.map((n) => {
          const out = runCompute(kind, { ...body, iterations: n });
          const id = persist(out);
          const { steps: _s, ...rest } = out;
          return { id, ...rest };
        });
        return json(res, 200, { results });
      }
      if (req.method === "GET" && p === "/api/runs") {
        const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
        const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
        return json(res, 200, { runs: listRuns(limit, offset) });
      }
      const runMatch = p.match(/^\/api\/runs\/(\d+)$/);
      if (req.method === "GET" && runMatch) {
        const row = getRun(Number(runMatch[1]));
        if (!row) throw new ApiError("NOT_FOUND", "报告不存在", 404);
        const explanation = JSON.parse(row.explanation_json) as { steps?: unknown[] };
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? MAX_STEPS_RETURNED);
        const page = pageSteps((explanation.steps ?? []) as never[], offset, limit);
        return json(res, 200, {
          id: row.id,
          createdAt: row.created_at,
          kind: row.kind,
          input: JSON.parse(row.input_json),
          unit: row.unit,
          iterations: row.iterations,
          tableVersion: row.table_version,
          result: JSON.parse(row.result_json),
          explanation: { ...explanation, steps: undefined },
          steps: page,
        });
      }
      throw new ApiError("NOT_FOUND", "路由不存在", 404);
    } catch (e) {
      if (e instanceof ApiError) {
        return json(res, e.status, { error: { code: e.code, message: e.message } });
      }
      return json(res, 500, { error: { code: "INTERNAL", message: String(e) } });
    }
  });
}

export function findFreePort(preferred = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(preferred, "127.0.0.1", () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on("error", reject);
  });
}

async function main(): Promise<void> {
  const argPort = process.argv.indexOf("--port");
  const preferred = argPort >= 0 ? Number(process.argv[argPort + 1]) : Number(process.env.PORT ?? 0);
  const port = await findFreePort(Number.isFinite(preferred) ? preferred : 0);
  const server = createServer();
  server.listen(port, "127.0.0.1", () => {
    console.log("CORDIC API 服务已启动: http://127.0.0.1:" + port);
    console.log("健康检查: http://127.0.0.1:" + port + "/api/health");
  });
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
