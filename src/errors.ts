/** 统一错误码与可校验的输入校验。 */
import {
  AngleUnit,
  MAX_ABS_COORD,
  MAX_ABS_RADIANS,
  MAX_ITERATIONS,
  MIN_ITERATIONS,
  toRadians,
} from './cordic.js';

export type ErrorCode =
  | 'INVALID_UNIT'
  | 'NON_FINITE_NUMBER'
  | 'ANGLE_OUT_OF_RANGE'
  | 'COORD_OUT_OF_RANGE'
  | 'ITERATIONS_OUT_OF_RANGE'
  | 'ZERO_VECTOR_DIRECTION_UNDEFINED'
  | 'LIMIT_EXCEEDED'
  | 'NOT_FOUND'
  | 'INVALID_JSON'
  | 'INVALID_BATCH';

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
  status(): number {
    return this.code === 'NOT_FOUND' ? 404 : 400;
  }
}

export function isAngleUnit(u: unknown): u is AngleUnit {
  return u === 'rad' || u === 'deg';
}

export function requireFinite(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new AppError('NON_FINITE_NUMBER', `${field} 必须是有限数值，收到: ${String(v)}`);
  }
  return v;
}

export function requireUnit(u: unknown): AngleUnit {
  if (!isAngleUnit(u)) {
    throw new AppError('INVALID_UNIT', `单位必须是 'rad' 或 'deg'，收到: ${String(u)}`);
  }
  return u;
}

export function requireIterations(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new AppError(
      'ITERATIONS_OUT_OF_RANGE',
      `iterations 必须是 [${MIN_ITERATIONS}, ${MAX_ITERATIONS}] 内的整数`,
    );
  }
  if (v < MIN_ITERATIONS || v > MAX_ITERATIONS) {
    throw new AppError(
      'ITERATIONS_OUT_OF_RANGE',
      `iterations 必须在 [${MIN_ITERATIONS}, ${MAX_ITERATIONS}] 内，收到: ${v}`,
    );
  }
  return v;
}

export function validateAngle(
  angle: number,
  unit: AngleUnit,
  field = 'angle',
): { radians: number } {
  const rad = toRadians(angle, unit);
  if (Math.abs(rad) > MAX_ABS_RADIANS) {
    throw new AppError(
      'ANGLE_OUT_OF_RANGE',
      `${field} 弧度绝对值不得超过 ${MAX_ABS_RADIANS}（收到 ${rad}）`,
    );
  }
  return { radians: rad };
}

export function validateCoord(v: number, field: string): number {
  if (Math.abs(v) > MAX_ABS_COORD) {
    throw new AppError(
      'COORD_OUT_OF_RANGE',
      `${field} 绝对值不得超过 ${MAX_ABS_COORD}（收到 ${v}）`,
    );
  }
  return v;
}

export const MAX_BATCH = 50;
export const MAX_EXPLAIN_STEPS = 48;
