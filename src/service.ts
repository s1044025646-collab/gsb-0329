import {
  rotate, vector, MIN_ITERATIONS, MAX_ITERATIONS, TABLE_VERSION,
  StepRecord,
} from "./cordic";

export type Unit = "rad" | "deg";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export const MAX_ABS_VALUE = 1e6; // 公开量级上限：坐标与模长
export const MAX_ABS_ANGLE_RAD = 1e6; // 角度量级上限（弧度）
export const MAX_STEPS_RETURNED = 500; // 解释（步记录）条数上限
export const MAX_BATCH = 64; // 批量上限

export function requireFinite(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new ApiError("INVALID_NUMBER", `${name} 必须是有限数值`);
  }
  return v;
}

export function requireUnit(u: unknown): Unit {
  if (u !== "rad" && u !== "deg") {
    throw new ApiError("INVALID_UNIT", `unit 必须是 "rad" 或 "deg"，收到: ${JSON.stringify(u)}`);
  }
  return u;
}

export function requireIterations(n: unknown): number {
  if (typeof n !== "number" || !Number.isInteger(n) || n < MIN_ITERATIONS || n > MAX_ITERATIONS) {
    throw new ApiError(
      "INVALID_ITERATIONS",
      `iterations 必须是 ${MIN_ITERATIONS}..${MAX_ITERATIONS} 的整数`,
    );
  }
  return n;
}

export function toRadians(angle: number, unit: Unit): number {
  return unit === "deg" ? (angle * Math.PI) / 180 : angle;
}

export function fromRadians(angle: number, unit: Unit): number {
  return unit === "deg" ? (angle * 180) / Math.PI : angle;
}

export interface StepPage {
  steps: StepRecord[];
  total: number;
  offset: number;
  limit: number;
}

export function pageSteps(steps: StepRecord[], offset = 0, limit = MAX_STEPS_RETURNED): StepPage {
  const off = Math.max(0, Math.floor(offset));
  const lim = Math.min(MAX_STEPS_RETURNED, Math.max(1, Math.floor(limit)));
  return { steps: steps.slice(off, off + lim), total: steps.length, offset: off, limit: lim };
}

export interface SincosOutput {
  kind: "sincos";
  input: { angle: number; unit: Unit };
  iterations: number;
  tableVersion: string;
  result: { cos: number; sin: number; residual: number; residualInUnit: number };
  explanation: {
    quadrantShift: number;
    reducedAngle: number;
    gain: number;
    note: string;
  };
  steps: StepRecord[];
}

export function computeSincos(angle: number, unit: Unit, n: number): SincosOutput {
  requireUnit(unit);
  requireIterations(n);
  requireFinite(angle, "angle");
  const theta = toRadians(angle, unit);
  if (Math.abs(theta) > MAX_ABS_ANGLE_RAD) {
    throw new ApiError("ANGLE_TOO_LARGE", `角度超出量级上限 ±${MAX_ABS_ANGLE_RAD} rad`);
  }
  const r = rotate(1, 0, theta, n);
  return {
    kind: "sincos",
    input: { angle, unit },
    iterations: n,
    tableVersion: TABLE_VERSION,
    result: {
      cos: r.x,
      sin: r.y,
      residual: r.residual,
      residualInUnit: fromRadians(r.residual, unit),
    },
    explanation: {
      quadrantShift: r.quadrantShift,
      reducedAngle: r.reducedAngle,
      gain: r.gain,
      note: "角度已化到 [-PI/2, PI/2]，增益已预补偿；residual 为收敛后剩余角（弧度）。",
    },
    steps: r.steps,
  };
}

export interface RotateOutput {
  kind: "rotate";
  input: { x: number; y: number; angle: number; unit: Unit };
  iterations: number;
  tableVersion: string;
  result: {
    x: number;
    y: number;
    residual: number;
    magnitudeBefore: number;
    magnitudeAfter: number;
  };
  explanation: { quadrantShift: number; reducedAngle: number; gain: number; note: string };
  steps: StepRecord[];
}

export function computeRotate(
  x: number, y: number, angle: number, unit: Unit, n: number,
): RotateOutput {
  requireUnit(unit);
  requireIterations(n);
  requireFinite(x, "x");
  requireFinite(y, "y");
  requireFinite(angle, "angle");
  if (Math.hypot(x, y) > MAX_ABS_VALUE) {
    throw new ApiError("VALUE_TOO_LARGE", `向量模长超出量级上限 ${MAX_ABS_VALUE}`);
  }
  const theta = toRadians(angle, unit);
  if (Math.abs(theta) > MAX_ABS_ANGLE_RAD) {
    throw new ApiError("ANGLE_TOO_LARGE", `角度超出量级上限 ±${MAX_ABS_ANGLE_RAD} rad`);
  }
  const r = rotate(x, y, theta, n);
  return {
    kind: "rotate",
    input: { x, y, angle, unit },
    iterations: n,
    tableVersion: TABLE_VERSION,
    result: {
      x: r.x,
      y: r.y,
      residual: r.residual,
      magnitudeBefore: Math.hypot(x, y),
      magnitudeAfter: Math.hypot(r.x, r.y),
    },
    explanation: {
      quadrantShift: r.quadrantShift,
      reducedAngle: r.reducedAngle,
      gain: r.gain,
      note: "增益补偿后模长应保持（误差随迭代次数减小）。",
    },
    steps: r.steps,
  };
}

export interface PolarOutput {
  kind: "polar";
  input: { x: number; y: number; unit: Unit };
  iterations: number;
  tableVersion: string;
  result: {
    magnitude: number;
    angle: number | null; // 请求单位下的角度；零向量为 null
    angleRad: number | null;
    angleDefined: boolean;
    residual: number;
  };
  explanation: { halfPlaneShift: number; gain: number; note: string };
  steps: StepRecord[];
}

export function computePolar(x: number, y: number, unit: Unit, n: number): PolarOutput {
  requireUnit(unit);
  requireIterations(n);
  requireFinite(x, "x");
  requireFinite(y, "y");
  if (Math.hypot(x, y) > MAX_ABS_VALUE) {
    throw new ApiError("VALUE_TOO_LARGE", `向量模长超出量级上限 ${MAX_ABS_VALUE}`);
  }
  if (x === 0 && y === 0) {
    return {
      kind: "polar",
      input: { x, y, unit },
      iterations: n,
      tableVersion: TABLE_VERSION,
      result: {
        magnitude: 0,
        angle: null,
        angleRad: null,
        angleDefined: false,
        residual: 0,
      },
      explanation: {
        halfPlaneShift: 0,
        gain: 1,
        note: "零向量：模长为 0，方向未定义。",
      },
      steps: [],
    };
  }
  const r = vector(x, y, n);
  return {
    kind: "polar",
    input: { x, y, unit },
    iterations: n,
    tableVersion: TABLE_VERSION,
    result: {
      magnitude: r.magnitude,
      angle: fromRadians(r.angle, unit),
      angleRad: r.angle,
      angleDefined: true,
      residual: r.residual,
    },
    explanation: {
      halfPlaneShift: r.halfPlaneShift,
      gain: r.gain,
      note: "方向角规范区间为 (-PI, PI]（或度制 (-180, 180]）；左半平面已做 90 度预旋转修正。",
    },
    steps: r.steps,
  };
}
