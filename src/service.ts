import {
  ANGLE_TABLE_VERSION,
  AngleUnit,
  CordicStep,
  RotateResult,
  VectorResult,
  cordicRotate,
  cordicVector,
  fromRadians,
  reference,
} from './cordic.js';
import {
  AppError,
  MAX_BATCH,
  MAX_EXPLAIN_STEPS,
  requireFinite,
  requireIterations,
  requireUnit,
  validateCoord,
  validateAngle,
} from './errors.js';
import { insertReport } from './db.js';

export interface CommonMeta {
  iterations: number;
  angleTableVersion: string;
  gain: number;
  gainCompensation: number;
  unit: AngleUnit;
}

export interface ExplainSummary {
  mode: 'rotate' | 'vector';
  iterations: number;
  firstSteps: Array<{
    index: number;
    d: number;
    shift: number;
    thetaDeg: number;
    zAfterDeg: number | null;
  }>;
  finalStep: {
    index: number;
    d: number;
    shift: number;
    thetaDeg: number;
    xAfter: number;
    yAfter: number;
    zAfter: number;
  } | null;
  note: string;
}

function summarizeSteps(
  mode: 'rotate' | 'vector',
  steps: CordicStep[],
): ExplainSummary {
  const firstSteps = steps.slice(0, 3).map((s) => ({
    index: s.index,
    d: s.d,
    shift: s.shift,
    thetaDeg: fromRadians(s.theta, 'deg'),
    zAfterDeg: mode === 'rotate' ? fromRadians(s.zAfter, 'deg') : null,
  }));
  const last = steps[steps.length - 1] ?? null;
  return {
    mode,
    iterations: steps.length,
    firstSteps,
    finalStep: last
      ? {
          index: last.index,
          d: last.d,
          shift: last.shift,
          thetaDeg: fromRadians(last.theta, 'deg'),
          xAfter: last.xAfter,
          yAfter: last.yAfter,
          zAfter: last.zAfter,
        }
      : null,
    note:
      'd_i 依据进入本步前状态选择；坐标更新同时读取更新前 x、y。' +
      '迭代次数增加通常改善精度，但受双精度浮点限制，不保证任意高精度。',
  };
}

/** 分页读取单步（不影响实际迭代；迭代始终执行全部 n 步）。 */
export function paginateSteps(
  steps: CordicStep[],
  offset = 0,
  limit = MAX_EXPLAIN_STEPS,
): { steps: CordicStep[]; total: number; offset: number; limit: number } {
  if (!Number.isInteger(offset) || offset < 0) offset = 0;
  if (!Number.isInteger(limit) || limit < 1) limit = MAX_EXPLAIN_STEPS;
  limit = Math.min(limit, MAX_EXPLAIN_STEPS);
  return {
    steps: steps.slice(offset, offset + limit),
    total: steps.length,
    offset,
    limit,
  };
}

export interface UnitCircleOutput {
  kind: 'unit-circle';
  unit: AngleUnit;
  inputAngle: number;
  iterations: number;
  angleTableVersion: string;
  cos: number;
  sin: number;
  residualAngle: { rad: number; deg: number };
  gain: number;
  gainCompensation: number;
  magnitudeCheck: number;
  reference: { sin: number; cos: number; errorSin: number; errorCos: number };
  explain: ExplainSummary;
  reportId: number;
}

export interface RotateOutput {
  kind: 'rotate';
  unit: AngleUnit;
  iterations: number;
  angleTableVersion: string;
  input: { x: number; y: number; angle: number };
  quadrantCorrection: { rad: number; deg: number };
  output: { x: number; y: number };
  residualAngle: { rad: number; deg: number };
  magnitude: { input: number; output: number; change: number };
  reference: { x: number; y: number; errorX: number; errorY: number };
  explain: ExplainSummary;
  reportId: number;
}

export interface VectorOutput {
  kind: 'vector';
  unit: AngleUnit;
  iterations: number;
  angleTableVersion: string;
  input: { x: number; y: number };
  /** 方向是否有定义；零向量为 false */
  angleDefined: boolean;
  magnitude: number;
  /** 方向角，规范区间 (-pi, pi]；零向量为 null */
  angle: { rad: number | null; deg: number | null };
  angleRange: '(-pi, pi]';
  axis: string;
  halfPlaneCorrection: { rad: number; deg: number };
  residualY: number;
  reference: {
    magnitude: number;
    angleRad: number | null;
    errorMagnitude: number | null;
    errorAngleRad: number | null;
  };
  explain: ExplainSummary;
  reportId: number;
}

function resolveIterations(body: Record<string, unknown>): number {
  return requireIterations(body.iterations ?? 16);
}

export function computeUnitCircle(
  dbPath: string,
  body: Record<string, unknown>,
): UnitCircleOutput {
  const unit = requireUnit(body.unit);
  const angle = requireFinite(body.angle, 'angle');
  validateAngle(angle, unit);
  const n = resolveIterations(body);
  const rad = unit === 'deg' ? (angle * Math.PI) / 180 : angle;

  const r: RotateResult = cordicRotate(rad, 1, 0, n);
  const explain = summarizeSteps('rotate', r.steps);
  const reportId = persist(dbPath, 'unit-circle', unit, body, r, explain);

  return {
    kind: 'unit-circle',
    unit,
    inputAngle: angle,
    iterations: n,
    angleTableVersion: ANGLE_TABLE_VERSION,
    cos: r.x,
    sin: r.y,
    residualAngle: { rad: r.residualAngle, deg: fromRadians(r.residualAngle, 'deg') },
    gain: r.gain,
    gainCompensation: r.gainCompensation,
    magnitudeCheck: r.outputMagnitude,
    reference: {
      sin: reference.sin(rad),
      cos: reference.cos(rad),
      errorSin: Math.abs(r.y - reference.sin(rad)),
      errorCos: Math.abs(r.x - reference.cos(rad)),
    },
    explain,
    reportId,
  };
}

export function computeRotate(
  dbPath: string,
  body: Record<string, unknown>,
): RotateOutput {
  const unit = requireUnit(body.unit);
  const angle = requireFinite(body.angle, 'angle');
  validateAngle(angle, unit);
  const x = validateCoord(requireFinite(body.x, 'x'), 'x');
  const y = validateCoord(requireFinite(body.y, 'y'), 'y');
  const n = resolveIterations(body);
  const rad = unit === 'deg' ? (angle * Math.PI) / 180 : angle;

  const r = cordicRotate(rad, x, y, n);
  const explain = summarizeSteps('rotate', r.steps);
  const reportId = persist(dbPath, 'rotate', unit, body, r, explain);

  const refX = x * reference.cos(rad) - y * reference.sin(rad);
  const refY = x * reference.sin(rad) + y * reference.cos(rad);

  return {
    kind: 'rotate',
    unit,
    iterations: n,
    angleTableVersion: ANGLE_TABLE_VERSION,
    input: { x, y, angle },
    quadrantCorrection: {
      rad: r.quadrantCorrection,
      deg: fromRadians(r.quadrantCorrection, 'deg'),
    },
    output: { x: r.x, y: r.y },
    residualAngle: { rad: r.residualAngle, deg: fromRadians(r.residualAngle, 'deg') },
    magnitude: {
      input: r.inputMagnitude,
      output: r.outputMagnitude,
      change: r.outputMagnitude - r.inputMagnitude,
    },
    reference: {
      x: refX,
      y: refY,
      errorX: Math.abs(r.x - refX),
      errorY: Math.abs(r.y - refY),
    },
    explain,
    reportId,
  };
}

export function computeVector(
  dbPath: string,
  body: Record<string, unknown>,
): VectorOutput {
  const unit = requireUnit(body.unit ?? 'rad');
  const x = validateCoord(requireFinite(body.x, 'x'), 'x');
  const y = validateCoord(requireFinite(body.y, 'y'), 'y');
  const n = resolveIterations(body);

  const r: VectorResult = cordicVector(x, y, n);
  const explain = summarizeSteps('vector', r.steps);
  const reportId = persist(dbPath, 'vector', unit, body, r, explain);

  const refMag = reference.hypot(x, y);
  const refAngle = x === 0 && y === 0 ? null : reference.atan2(y, x);

  return {
    kind: 'vector',
    unit,
    iterations: n,
    angleTableVersion: ANGLE_TABLE_VERSION,
    input: { x, y },
    angleDefined: r.angleDefined,
    magnitude: r.magnitude,
    angle: {
      rad: r.angle,
      deg: r.angle === null ? null : fromRadians(r.angle, 'deg'),
    },
    angleRange: '(-pi, pi]',
    axis: r.axis,
    halfPlaneCorrection: {
      rad: r.halfPlaneCorrection,
      deg: fromRadians(r.halfPlaneCorrection, 'deg'),
    },
    residualY: r.residualY,
    reference: {
      magnitude: refMag,
      angleRad: refAngle,
      errorMagnitude: r.angleDefined ? Math.abs(r.magnitude - refMag) : null,
      errorAngleRad:
        r.angleDefined && r.angle !== null && refAngle !== null
          ? Math.abs(angleDiff(r.angle, refAngle))
          : null,
    },
    explain,
    reportId,
  };
}

/** 考虑 (-pi,pi] 环绕的角误差 */
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function persist(
  dbPath: string,
  kind: string,
  unit: AngleUnit,
  params: unknown,
  result: RotateResult | VectorResult,
  explain: ExplainSummary,
): number {
  // 存储时剔除 steps 放入独立列；result_json 不含 steps 以保持摘要精简。
  const { steps, ...resultNoSteps } = result as RotateResult & { steps?: CordicStep[] };
  return insertReport(dbPath, {
    kind,
    unit,
    iterations: result.iterations,
    angleTableVersion: result.angleTableVersion,
    params,
    result: resultNoSteps,
    explain,
    steps,
  });
}

export interface BatchItem {
  op: 'unit-circle' | 'rotate' | 'vector';
  body: Record<string, unknown>;
}

export function runBatch(
  dbPath: string,
  items: unknown,
): Array<Record<string, unknown> | { error: string; code: string }> {
  if (!Array.isArray(items)) throw new AppError('INVALID_BATCH', 'batch 必须是数组');
  if (items.length === 0) throw new AppError('INVALID_BATCH', 'batch 不能为空');
  if (items.length > MAX_BATCH) {
    throw new AppError(
      'LIMIT_EXCEEDED',
      `批量条数不得超过 ${MAX_BATCH}（收到 ${items.length}）`,
    );
  }
  const out: Array<Record<string, unknown> | { error: string; code: string }> = [];
  for (const it of items) {
    try {
      const item = it as BatchItem;
      if (item.op === 'unit-circle') out.push({ ...computeUnitCircle(dbPath, item.body) });
      else if (item.op === 'rotate') out.push({ ...computeRotate(dbPath, item.body) });
      else if (item.op === 'vector') out.push({ ...computeVector(dbPath, item.body) });
      else throw new AppError('INVALID_BATCH', `未知 op: ${String((it as BatchItem).op)}`);
    } catch (e) {
      const err = e as AppError;
      out.push({ code: err.code ?? 'UNKNOWN', error: err.message });
    }
  }
  return out;
}
