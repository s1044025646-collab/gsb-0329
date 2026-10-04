/**
 * 教学用圆周模式 CORDIC 核心。
 * 旋转模式与向量模式，微旋转角 atan(2^-i)。
 * 所有求值均通过迭代核心完成；Math.atan 仅用于初始化角表与增益。
 */

export const MAX_ITERATIONS = 40;
export const MIN_ITERATIONS = 1;
export const TABLE_VERSION = "cordic-circular-v1";

/** 角表：atan(2^-i)，i = 0..MAX_ITERATIONS-1 */
export const ATAN_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let i = 0; i < MAX_ITERATIONS; i++) t.push(Math.atan(Math.pow(2, -i)));
  return t;
})();

/** 增益 K(n) = prod(1/sqrt(1+2^-2i))，补偿微旋转的模长放大 */
export function gainFor(n: number): number {
  let k = 1;
  for (let i = 0; i < n; i++) k *= 1 / Math.sqrt(1 + Math.pow(2, -2 * i));
  return k;
}

export interface StepRecord {
  i: number;
  direction: number;
  shift: number;
  atan: number;
  xBefore: number;
  yBefore: number;
  xAfter: number;
  yAfter: number;
  residualBefore: number;
  residualAfter: number;
}

export interface RotateResult {
  x: number;
  y: number;
  residual: number;
  gain: number;
  quadrantShift: number;
  reducedAngle: number;
  steps: StepRecord[];
}

export interface VectorResult {
  magnitude: number;
  angle: number;
  residual: number;
  gain: number;
  halfPlaneShift: number;
  steps: StepRecord[];
}

/**
 * 旋转模式：把向量 (x,y) 旋转 theta（弧度）。
 * 预处理：theta 化到 [-PI/2, PI/2]，象限修正通过对输入向量做精确 90 度旋转实现。
 */
export function rotate(x: number, y: number, theta: number, n: number): RotateResult {
  let a = theta % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  let k = 0;
  if (a > Math.PI / 2) { k = 1; a -= Math.PI / 2; }
  else if (a < -Math.PI / 2) { k = -1; a += Math.PI / 2; }
  let cx = x;
  let cy = y;
  for (let s = 0; s < Math.abs(k); s++) {
    const nx = k > 0 ? -cy : cy;
    const ny = k > 0 ? cx : -cx;
    cx = nx;
    cy = ny;
  }
  const gain = gainFor(n);
  let xi = cx * gain;
  let yi = cy * gain;
  let z = a;
  const steps: StepRecord[] = [];
  for (let i = 0; i < n; i++) {
    const d = z >= 0 ? 1 : -1;
    const xb = xi;
    const yb = yi;
    const zb = z;
    const xn = xi - d * yi * Math.pow(2, -i);
    const yn = yi + d * xi * Math.pow(2, -i);
    z = z - d * ATAN_TABLE[i];
    xi = xn;
    yi = yn;
    steps.push({
      i, direction: d, shift: i, atan: ATAN_TABLE[i],
      xBefore: xb, yBefore: yb, xAfter: xi, yAfter: yi,
      residualBefore: zb, residualAfter: z,
    });
  }
  return { x: xi, y: yi, residual: z, gain, quadrantShift: k * Math.PI / 2, reducedAngle: a, steps };
}

/**
 * 向量模式：求 (x,y) 的模长与方向角（弧度，区间 (-PI, PI]）。
 * 左半平面先做 90 度预旋转并记录修正角。
 * 零向量：模长 0，方向未定义（angle 为 NaN，由调用方标记）。
 */
export function vector(x: number, y: number, n: number): VectorResult {
  const gain = gainFor(n);
  let xi = x;
  let yi = y;
  let shift = 0;
  if (xi < 0) {
    if (yi >= 0) {
      const nx = yi;
      const ny = -xi;
      xi = nx;
      yi = ny;
      shift = Math.PI / 2;
    } else {
      const nx = -yi;
      const ny = xi;
      xi = nx;
      yi = ny;
      shift = -Math.PI / 2;
    }
  }
  let z = 0;
  const steps: StepRecord[] = [];
  for (let i = 0; i < n; i++) {
    const d = yi >= 0 ? -1 : 1;
    const xb = xi;
    const yb = yi;
    const zb = z;
    const xn = xi - d * yi * Math.pow(2, -i);
    const yn = yi + d * xi * Math.pow(2, -i);
    z = z - d * ATAN_TABLE[i];
    xi = xn;
    yi = yn;
    steps.push({
      i, direction: d, shift: i, atan: ATAN_TABLE[i],
      xBefore: xb, yBefore: yb, xAfter: xi, yAfter: yi,
      residualBefore: zb, residualAfter: z,
    });
  }
  let angle = z + shift;
  if (angle > Math.PI) angle -= 2 * Math.PI;
  // 规范到 (-PI, PI]；迭代误差可能让 +PI 略偏到 -PI 一侧，按确定规则归一到 +PI
  if (angle <= -Math.PI + 1e-6) angle = Math.PI;
  return {
    magnitude: xi * gain,
    angle,
    residual: yi * gain,
    gain,
    halfPlaneShift: shift,
    steps,
  };
}
