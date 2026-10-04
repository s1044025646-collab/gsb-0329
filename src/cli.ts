import {
  computePolar, computeRotate, computeSincos,
  requireFinite, requireIterations, requireUnit, ApiError, Unit,
} from "./service";
import { getRun, listRuns, saveRun } from "./db";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = "true";
      else { out[key] = next; i++; }
    }
  }
  return out;
}

function num(args: Record<string, string>, name: string, required = true): number {
  const raw = args[name];
  if (raw === undefined) {
    if (required) throw new ApiError("MISSING_ARG", `缺少参数 --${name}`);
    return NaN;
  }
  return requireFinite(Number(raw), name);
}

function unit(args: Record<string, string>): Unit {
  return requireUnit(args.unit ?? "rad");
}

function iters(args: Record<string, string>): number {
  return requireIterations(Number(args.iterations ?? 12));
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padStart(widths[i])).join("  ");
  return [line(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

function fmt(v: number | null, digits = 12): string {
  if (v === null) return "未定义";
  if (!Number.isFinite(v)) return "NaN";
  return Number(v.toPrecision(digits)).toString();
}

function printSteps(steps: { i: number; direction: number; shift: number; atan: number; xAfter: number; yAfter: number; residualAfter: number }[]): void {
  console.log(table(
    ["i", "dir", "shift", "atan(2^-i)", "x", "y", "residual"],
    steps.map((s) => [
      String(s.i), s.direction > 0 ? "+1" : "-1", String(s.shift),
      fmt(s.atan, 10), fmt(s.xAfter, 10), fmt(s.yAfter, 10), fmt(s.residualAfter, 10),
    ]),
  ));
}

function cmdSincos(args: Record<string, string>): void {
  const angle = num(args, "angle");
  const u = unit(args);
  const n = iters(args);
  const out = computeSincos(angle, u, n);
  const id = saveRun("sincos", out.input, u, n, out.tableVersion, out.result, { ...out.explanation, steps: out.steps });
  const rad = u === "deg" ? (angle * Math.PI) / 180 : angle;
  const refCos = Math.cos(rad);
  const refSin = Math.sin(rad);
  console.log(`运行 ID: ${id}  迭代: ${n}  角表: ${out.tableVersion}`);
  console.log(table(
    ["量", "CORDIC", "参考(演示)", "绝对误差"],
    [
      ["cos", fmt(out.result.cos), fmt(refCos), fmt(Math.abs(out.result.cos - refCos), 4)],
      ["sin", fmt(out.result.sin), fmt(refSin), fmt(Math.abs(out.result.sin - refSin), 4)],
      ["residual", fmt(out.result.residual, 6), "-", "-"],
    ],
  ));
  if (args.steps === "true") printSteps(out.steps);
}

function cmdRotate(args: Record<string, string>): void {
  const x = num(args, "x");
  const y = num(args, "y");
  const angle = num(args, "angle");
  const u = unit(args);
  const n = iters(args);
  const out = computeRotate(x, y, angle, u, n);
  const id = saveRun("rotate", out.input, u, n, out.tableVersion, out.result, { ...out.explanation, steps: out.steps });
  const rad = u === "deg" ? (angle * Math.PI) / 180 : angle;
  const refX = x * Math.cos(rad) - y * Math.sin(rad);
  const refY = x * Math.sin(rad) + y * Math.cos(rad);
  console.log(`运行 ID: ${id}  迭代: ${n}`);
  console.log(table(
    ["量", "CORDIC", "参考(演示)", "绝对误差"],
    [
      ["x", fmt(out.result.x), fmt(refX), fmt(Math.abs(out.result.x - refX), 4)],
      ["y", fmt(out.result.y), fmt(refY), fmt(Math.abs(out.result.y - refY), 4)],
      ["|v| 前", fmt(out.result.magnitudeBefore), "-", "-"],
      ["|v| 后", fmt(out.result.magnitudeAfter), "-", fmt(Math.abs(out.result.magnitudeAfter - out.result.magnitudeBefore), 4)],
      ["residual", fmt(out.result.residual, 6), "-", "-"],
    ],
  ));
  if (args.steps === "true") printSteps(out.steps);
}

function cmdPolar(args: Record<string, string>): void {
  const x = num(args, "x");
  const y = num(args, "y");
  const u = unit(args);
  const n = iters(args);
  const out = computePolar(x, y, u, n);
  const id = saveRun("polar", out.input, u, n, out.tableVersion, out.result, { ...out.explanation, steps: out.steps });
  const refMag = Math.hypot(x, y);
  const refAng = x === 0 && y === 0 ? null : Math.atan2(y, x);
  const refAngUnit = refAng === null ? null : (u === "deg" ? (refAng * 180) / Math.PI : refAng);
  const errAng = out.result.angle === null || refAngUnit === null
    ? null : Math.abs(out.result.angle - refAngUnit);
  console.log(`运行 ID: ${id}  迭代: ${n}`);
  console.log(table(
    ["量", "CORDIC", "参考(演示)", "绝对误差"],
    [
      ["模长", fmt(out.result.magnitude), fmt(refMag), fmt(Math.abs(out.result.magnitude - refMag), 4)],
      ["方向角", out.result.angleDefined ? fmt(out.result.angle) : "未定义", fmt(refAngUnit), fmt(errAng, 4)],
      ["residual", fmt(out.result.residual, 6), "-", "-"],
    ],
  ));
  if (args.steps === "true") printSteps(out.steps);
}

function cmdCompare(args: Record<string, string>): void {
  const kind = args.kind ?? "sincos";
  const list = (args.iterations ?? "8,20").split(",").map((s) => requireIterations(Number(s.trim())));
  const u = unit(args);
  const rows: string[][] = [];
  for (const n of list) {
    if (kind === "sincos") {
      const angle = num(args, "angle");
      const out = computeSincos(angle, u, n);
      const id = saveRun("sincos", out.input, u, n, out.tableVersion, out.result, { ...out.explanation, steps: out.steps });
      const rad = u === "deg" ? (angle * Math.PI) / 180 : angle;
      const err = Math.max(
        Math.abs(out.result.cos - Math.cos(rad)),
        Math.abs(out.result.sin - Math.sin(rad)),
      );
      rows.push([String(id), String(n), fmt(out.result.cos), fmt(out.result.sin), fmt(err, 4)]);
    } else if (kind === "rotate") {
      const x = num(args, "x");
      const y = num(args, "y");
      const angle = num(args, "angle");
      const out = computeRotate(x, y, angle, u, n);
      const id = saveRun("rotate", out.input, u, n, out.tableVersion, out.result, { ...out.explanation, steps: out.steps });
      const rad = u === "deg" ? (angle * Math.PI) / 180 : angle;
      const err = Math.max(
        Math.abs(out.result.x - (x * Math.cos(rad) - y * Math.sin(rad))),
        Math.abs(out.result.y - (x * Math.sin(rad) + y * Math.cos(rad))),
      );
      rows.push([String(id), String(n), fmt(out.result.x), fmt(out.result.y), fmt(err, 4)]);
    } else {
      const x = num(args, "x");
      const y = num(args, "y");
      const out = computePolar(x, y, u, n);
      const id = saveRun("polar", out.input, u, n, out.tableVersion, out.result, { ...out.explanation, steps: out.steps });
      const err = Math.abs(out.result.magnitude - Math.hypot(x, y));
      rows.push([String(id), String(n), fmt(out.result.magnitude), out.result.angleDefined ? fmt(out.result.angle) : "未定义", fmt(err, 4)]);
    }
  }
  console.log(`对比 kind=${kind}（每个迭代次数单独保存为一次运行）`);
  console.log(table(["运行ID", "迭代", "输出1", "输出2", "参考误差"], rows));
}

function cmdReport(args: Record<string, string>): void {
  const id = num(args, "id");
  const row = getRun(id);
  if (!row) throw new ApiError("NOT_FOUND", `报告 ${id} 不存在`);
  const explanation = JSON.parse(row.explanation_json) as { steps?: never[]; note?: string };
  console.log(`报告 #${row.id}  类型: ${row.kind}  单位: ${row.unit}  迭代: ${row.iterations}`);
  console.log(`角表版本: ${row.table_version}  创建时间: ${row.created_at}`);
  console.log(`输入: ${row.input_json}`);
  console.log(`结果: ${row.result_json}`);
  if (explanation.note) console.log(`说明: ${explanation.note}`);
  if (args.steps === "true" && explanation.steps) printSteps(explanation.steps);
}

function cmdRuns(): void {
  const rows = listRuns(20).map((r) => [
    String(r.id), r.kind, r.unit, String(r.iterations), r.created_at, r.input_json,
  ]);
  console.log(table(["ID", "类型", "单位", "迭代", "时间", "输入"], rows));
}

function usage(): void {
  console.log(`CORDIC CLI 用法:
  node dist/cli.js sincos  --angle 30 --unit deg --iterations 12 [--steps]
  node dist/cli.js rotate  --x 1 --y 2 --angle 90 --unit deg --iterations 12 [--steps]
  node dist/cli.js polar   --x -3 --y 4 --unit deg --iterations 12 [--steps]
  node dist/cli.js compare --kind sincos --angle 30 --unit deg --iterations 8,20
  node dist/cli.js report  --id 1 [--steps]
  node dist/cli.js runs`);
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  try {
    switch (cmd) {
      case "sincos": return cmdSincos(args);
      case "rotate": return cmdRotate(args);
      case "polar": return cmdPolar(args);
      case "compare": return cmdCompare(args);
      case "report": return cmdReport(args);
      case "runs": return cmdRuns();
      default: usage();
    }
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`错误 [${e.code}]: ${e.message}`);
      process.exit(2);
    }
    throw e;
  }
}

main();
