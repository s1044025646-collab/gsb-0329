/**
 * 圆周模式 CORDIC 核心实现。
 *
 * 微旋转角 theta_i = atan(2^-i)，i = 0,1,2,...
 * 每次微旋转（忽略共同因子）：
 *   x_{i+1} = x_i - d_i * y_i * 2^-i
 *   y_{i+1} = y_i + d_i * x_i * 2^-i
 *   z_{i+1} = z_i - d_i * theta_i
 * 两条坐标更新都读取更新前的 x、y（d_i 只依赖进入本步时的状态）。
 *
 * 每次微旋转带来增益因子 k_i = sqrt(1 + 2^-2i)，
 * n 次累计增益 K_n = prod(k_i)，最终用 1/K_n 补偿。
 */

export const ANGLE_TABLE_VERSION = 'CT-v1-atantable-double';

export const MIN_ITERATIONS = 1;
export const MAX_ITERATIONS = 48;
export const DEFAULT_ITERATIONS = 16;

/** 公开允许的输入量级上限（角度单位：弧度） */
export const MAX_ABS_RADIANS = 1000;
/** 公开允许的坐标量级上限 */
export const MAX_ABS_COORD = 1e9;

export type AngleUnit = 'rad' | 'deg';

/** 单步微旋转记录 */
export interface CordicStep {
  index: number;
  /** 方向选择 d_i：+1 逆时针旋转（旋转模式下用于减小正剩余角时为 -1，见下） */
  d: 1 | -1;
  /** 移位因子 2^-i */
  shift: number;
  /** 进入本步前的坐标 */
  xBefore: number;
  yBefore: number;
  /** 本步微旋转角 theta_i（弧度） */
  theta: number;
  /** 本步之后的坐标 */
  xAfter: number;
  yAfter: number;
  /** 本步之后的剩余角（弧度） */
  zAfter: number;
}

export interface CordicBaseResult {
  iterations: number;
  angleTableVersion: string;
  /** 累计增益 K_n（补偿前） */
  gain: number;
  /** 增益补偿因子 1/K_n */
  gainCompensation: number;
  /** 象限/半平面修正量（弧度），用于从内部角恢复最终角 */
  steps: CordicStep[];
}

/** 旋转模式结果（旋转模式以剩余角归零为目标） */
export interface RotateResult extends CordicBaseResult {
  mode: 'rotate';
  /** 输入角（弧度，未规范化） */
  inputAngle: number;
  /** 象限修正量（弧度） */
  quadrantCorrection: number;
  /** 增益补偿并还原象限后的最终坐标 */
  x: number;
  y: number;
  /** 迭代结束后的剩余角（弧度），旋转模式期望其接近 0 */
  residualAngle: number;
  /** 补偿后输出向量的模长（旋转模式下应≈输入模长） */
  outputMagnitude: number;
  inputMagnitude: number;
}

/** 向量模式结果（向量模式以 y 归零为目标） */
export interface VectorResult extends CordicBaseResult {
  mode: 'vector';
  xIn: number;
  yIn: number;
  /** 增益补偿后的模长；零向量时为 0 */
  magnitude: number;
  /** 方向角（弧度），规范区间 (-pi, pi]；零向量为 null（未定义） */
  angle: number | null;
  angleDefined: boolean;
  /** 轴上向量的确定规则标记 */
  axis: 'none' | 'positive-x' | 'positive-y' | 'negative-x' | 'negative-y';
  /** 左半平面处理时应用的 180° 修正（弧度，0 或 +/- pi） */
  halfPlaneCorrection: number;
  /** 迭代结束后的剩余 y（弧度口径为 z，y 期望接近 0）；这里给最终 z（弧度）与剩余 y */
  zFinal: number;
  residualY: number;
}

/** 生成 n 步角表（弧度）与增益参数。仅在初始化使用标准 atan。 */
export function buildAngleTable(n: number): {
  thetas: number[];
  shifts: number[];
  gain: number;
  compensation: number;
} {
  if (!Number.isInteger(n) || n < MIN_ITERATIONS || n > MAX_ITERATIONS) {
    throw new RangeError(
      `iterations must be an integer in [${MIN_ITERATIONS}, ${MAX_ITERATIONS}]`,
    );
  }
  const thetas: number[] = [];
  const shifts: number[] = [];
  let gain = 1;
  for (let i = 0; i < n; i++) {
    const shift = 2 ** -i;
    shifts.push(shift);
    thetas.push(Math.atan(shift));
    gain *= Math.sqrt(1 + shift * shift);
  }
  return { thetas, shifts, gain, compensation: 1 / gain };
}

const TWO_PI = 2 * Math.PI;

/**
 * 旋转模式 CORDIC。
 * @param angleRad 目标旋转角（弧度），内部会做半平面预处理以进入可收敛区间。
 * @param x0 y0 旋转前向量
 * @param n 微旋转次数
 */
export function cordicRotate(
  angleRad: number,
  x0: number,
  y0: number,
  n: number = DEFAULT_ITERATIONS,
): RotateResult {
  const { thetas, shifts, gain, compensation } = buildAngleTable(n);

  let x = x0;
  let y = y0;
  let correction = 0;

  // CORDIC 旋转模式收敛范围约为 [-99.9°, 99.9°]。
  // 用 90° 旋转（同时改变角的符号）把任意角折到 [-pi/2, pi/2]。
  let target = angleRad;
  // 先对超大角做整周折叠（仅为收敛；输出仍对应折叠后等价角）。
  let wrapped = target - TWO_PI * Math.round(target / TWO_PI);
  if (wrapped > Math.PI / 2) {
    // 旋转 +90°：(x,y)->(-y,x)，目标角减 90°
    const nx = -y;
    const ny = x;
    x = nx;
    y = ny;
    wrapped -= Math.PI / 2;
    correction += Math.PI / 2;
  } else if (wrapped < -Math.PI / 2) {
    // 旋转 -90°：(x,y)->(y,-x)，目标角加 90°
    const nx = y;
    const ny = -x;
    x = nx;
    y = ny;
    wrapped += Math.PI / 2;
    correction -= Math.PI / 2;
  }

  let z = wrapped;
  const steps: CordicStep[] = [];
  for (let i = 0; i < n; i++) {
    const xBefore = x;
    const yBefore = y;
    // 旋转模式：z 是尚需完成的旋转角。z>=0 取 d=+1 向 +z 方向旋转并从 z 扣除，
    // z<0 取 d=-1。两条坐标更新均只使用进入本步时的 x、y。
    const d: 1 | -1 = z >= 0 ? 1 : -1;
    const s = shifts[i];
    const nx = xBefore - d * yBefore * s;
    const ny = yBefore + d * xBefore * s;
    const nz = z - d * thetas[i];
    steps.push({
      index: i,
      d,
      shift: s,
      xBefore,
      yBefore,
      theta: thetas[i],
      xAfter: nx,
      yAfter: ny,
      zAfter: nz,
    });
    x = nx;
    y = ny;
    z = nz;
  }

  const fx = x * compensation;
  const fy = y * compensation;
  const outMag = Math.hypot(fx, fy);

  return {
    mode: 'rotate',
    iterations: n,
    angleTableVersion: ANGLE_TABLE_VERSION,
    gain,
    gainCompensation: compensation,
    inputAngle: angleRad,
    quadrantCorrection: correction,
    x: fx,
    y: fy,
    residualAngle: z,
    outputMagnitude: outMag,
    inputMagnitude: Math.hypot(x0, y0),
    steps,
  };
}

/**
 * 向量模式 CORDIC：从 (x0,y0) 出发，用微旋转把 y 旋到 0，
 * 过程中累计旋转角，并由增益补偿得到模长。
 * 左半平面先做 180° 翻转进入 x>0，再据翻转量与 y 符号恢复 atan2 方向角。
 */
export function cordicVector(
  x0: number,
  y0: number,
  n: number = DEFAULT_ITERATIONS,
): VectorResult {
  const { thetas, shifts, gain, compensation } = buildAngleTable(n);

  const axis: VectorResult['axis'] =
    x0 === 0 && y0 === 0
      ? 'none'
      : y0 === 0
        ? x0 > 0
          ? 'positive-x'
          : 'negative-x'
        : x0 === 0
          ? y0 > 0
            ? 'positive-y'
            : 'negative-y'
          : 'none';

  if (x0 === 0 && y0 === 0) {
    return {
      mode: 'vector',
      iterations: n,
      angleTableVersion: ANGLE_TABLE_VERSION,
      gain,
      gainCompensation: compensation,
      xIn: x0,
      yIn: y0,
      magnitude: 0,
      angle: null,
      angleDefined: false,
      axis: 'none',
      halfPlaneCorrection: 0,
      zFinal: 0,
      residualY: 0,
      steps: [],
    };
  }

  let x = x0;
  let y = y0;
  let halfPlaneCorrection = 0;
  if (x < 0) {
    // 翻转 180°：(-x,-y)，x 变为正
    x = -x;
    y = -y;
    // 翻转后 atan2(-y0,-x0) 与原 atan2(y0,x0) 相差 ±pi。
    // y0>=0 原角在 [0,pi] -> 差 +pi；y0<0 原角在 (-pi,0) -> 差 -pi。
    halfPlaneCorrection = y0 >= 0 ? Math.PI : -Math.PI;
  }

  let z = 0;
  const steps: CordicStep[] = [];
  for (let i = 0; i < n; i++) {
    const xBefore = x;
    const yBefore = y;
    // 向量模式（y->0）：y>=0 取 d=-1 向下旋把 y 压向 x 轴，y<0 取 d=+1。
    // 此约定下 z 最终累计为 -atan2(y,x)（x>0 口径），取负还原方向角。
    const d: 1 | -1 = y >= 0 ? -1 : 1;
    const s = shifts[i];
    const nx = xBefore - d * yBefore * s;
    const ny = yBefore + d * xBefore * s;
    const nz = z - d * thetas[i];
    steps.push({
      index: i,
      d,
      shift: s,
      xBefore,
      yBefore,
      theta: thetas[i],
      xAfter: nx,
      yAfter: ny,
      zAfter: nz,
    });
    x = nx;
    y = ny;
    z = nz;
  }

  const magnitude = x * compensation;
  const residualY = y * compensation;

    // 此约定下 z 即翻转后向量的方向角 atan2(-y0,-x0)。
    // 左半平面减去环绕修正 ±pi 还原 atan2(y0,x0)。
    let angle: number;
    if (axis !== 'none') {
      // 轴上向量使用确定规则给出精确方向角
      angle =
        axis === 'positive-x'
          ? 0
          : axis === 'positive-y'
            ? Math.PI / 2
            : axis === 'negative-x'
              ? Math.PI
              : -Math.PI / 2;
    } else {
      angle = normalizeAnglePi(z - halfPlaneCorrection);
    }

  return {
    mode: 'vector',
    iterations: n,
    angleTableVersion: ANGLE_TABLE_VERSION,
    gain,
    gainCompensation: compensation,
    xIn: x0,
    yIn: y0,
    magnitude,
    angle,
    angleDefined: true,
    axis,
    halfPlaneCorrection,
    zFinal: z,
    residualY,
    steps,
  };
}

/** 规范到 (-pi, pi]：+pi 保留，-pi 归为 +pi（负 x 轴确定规则）。 */
export function normalizeAnglePi(a: number): number {
  let r = a;
  while (r > Math.PI) r -= TWO_PI;
  while (r <= -Math.PI) r += TWO_PI;
  return r;
}

export function toRadians(value: number, unit: AngleUnit): number {
  return unit === 'deg' ? (value * Math.PI) / 180 : value;
}

export function fromRadians(value: number, unit: AngleUnit): number {
  return unit === 'deg' ? (value * 180) / Math.PI : value;
}

/** 独立参考值（仅用于演示/测试对照，不参与核心求值） */
export const reference = {
  sin: (rad: number) => Math.sin(rad),
  cos: (rad: number) => Math.cos(rad),
  hypot: (x: number, y: number) => Math.hypot(x, y),
  atan2: (y: number, x: number) => Math.atan2(y, x),
};
