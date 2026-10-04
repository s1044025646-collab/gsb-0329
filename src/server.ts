import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { getReport, listReports } from './db.js';
import { AppError } from './errors.js';
import { paginateSteps, runBatch, computeRotate, computeUnitCircle, computeVector } from './service.js';
import { fromRadians } from './cordic.js';

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('无法获取空闲端口')));
      }
    });
    srv.on('error', reject);
  });
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1_000_000) {
        reject(new AppError('LIMIT_EXCEEDED', '请求体过大（>1MB）'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        const j = JSON.parse(raw);
        if (typeof j !== 'object' || j === null || Array.isArray(j)) {
          return reject(new AppError('INVALID_JSON', '请求体必须是 JSON 对象'));
        }
        resolve(j as Record<string, unknown>);
      } catch {
        reject(new AppError('INVALID_JSON', '请求体不是合法 JSON'));
      }
    });
    req.on('error', () => reject(new AppError('INVALID_JSON', '读取请求体失败')));
  });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** 比较不同迭代次数：对同一组输入分别运行并返回（各自独立保存）。 */
function compare(
  dbPath: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const op = String(body.op ?? 'unit-circle');
  const counts = Array.isArray(body.iterationsList)
    ? (body.iterationsList as unknown[])
    : [8, 20];
  if (counts.length > 10) {
    throw new AppError('LIMIT_EXCEEDED', 'iterationsList 最多 10 组');
  }
  const rows = counts.map((n) => {
    const b = { ...body, iterations: n };
    delete (b as Record<string, unknown>).iterationsList;
    if (op === 'rotate') return computeRotate(dbPath, b);
    if (op === 'vector') return computeVector(dbPath, b);
    return computeUnitCircle(dbPath, b);
  });
  return { op, compared: rows };
}

export async function startServer(dbPath: string, preferredPort?: number): Promise<{
  port: number;
  close: () => void;
}> {
  const port = preferredPort ?? (await findFreePort());

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const path = url.pathname;
      const method = req.method ?? 'GET';

      if (method === 'GET' && path === '/health') {
        return send(res, 200, { ok: true });
      }

      if (method === 'POST' && path === '/api/cordic/unit-circle') {
        return send(res, 200, computeUnitCircle(dbPath, await readJson(req)));
      }
      if (method === 'POST' && path === '/api/cordic/rotate') {
        return send(res, 200, computeRotate(dbPath, await readJson(req)));
      }
      if (method === 'POST' && path === '/api/cordic/vector') {
        return send(res, 200, computeVector(dbPath, await readJson(req)));
      }
      if (method === 'POST' && path === '/api/cordic/batch') {
        const body = await readJson(req);
        return send(res, 200, { results: runBatch(dbPath, body.items) });
      }
      if (method === 'POST' && path === '/api/cordic/compare') {
        return send(res, 200, compare(dbPath, await readJson(req)));
      }

      const reportMatch = path.match(/^\/api\/reports\/(\d+)$/);
      if (method === 'GET' && reportMatch) {
        const id = Number(reportMatch[1]);
        const row = getReport(dbPath, id);
        if (!row) throw new AppError('NOT_FOUND', `报告 ${id} 不存在`);
        const offset = Number(url.searchParams.get('offset') ?? '0');
        const limit = Number(url.searchParams.get('limit') ?? '48');
        const allSteps = JSON.parse(row.steps_json) as unknown[];
        const o = Math.max(0, Number.isFinite(offset) ? offset : 0);
        const l = Math.min(48, Math.max(1, Number.isFinite(limit) ? limit : 48));
        return send(res, 200, {
          id: row.id,
          kind: row.kind,
          createdAt: row.created_at,
          unit: row.unit,
          iterations: row.iterations,
          angleTableVersion: row.angle_table_version,
          params: JSON.parse(row.params_json),
          result: JSON.parse(row.result_json),
          explain: JSON.parse(row.explain_json),
          steps: {
            items: allSteps.slice(o, o + l),
            total: allSteps.length,
            offset: o,
            limit: l,
          },
        });
      }

      if (method === 'GET' && path === '/api/reports') {
        const limit = Math.min(100, Number(url.searchParams.get('limit') ?? '20') || 20);
        const rows = listReports(dbPath, limit).map((r) => ({
          id: r.id,
          kind: r.kind,
          createdAt: r.created_at,
          unit: r.unit,
          iterations: r.iterations,
          angleTableVersion: r.angle_table_version,
        }));
        return send(res, 200, { reports: rows });
      }

      if (method === 'GET' && path === '/') {
        return send(res, 200, {
          service: 'cordic-teaching-backend',
          endpoints: [
            'POST /api/cordic/unit-circle',
            'POST /api/cordic/rotate',
            'POST /api/cordic/vector',
            'POST /api/cordic/batch',
            'POST /api/cordic/compare',
            'GET /api/reports',
            'GET /api/reports/:id?offset=&limit=',
            'GET /health',
          ],
        });
      }

      throw new AppError('NOT_FOUND', `无此路由: ${method} ${path}`);
    } catch (e) {
      const err = e as AppError;
      const status = err.status ? err.status() : 500;
      send(res, status, {
        error: {
          code: err.code ?? 'INTERNAL',
          message: err.message ?? String(e),
        },
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return {
    port: (server.address() as { port: number }).port,
    close: () => server.close(),
  };
}

// 仅为可能的静态使用保留
export { fromRadians, paginateSteps };
