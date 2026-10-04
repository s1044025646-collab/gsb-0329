import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  cordicRotate,
  cordicVector,
  normalizeAnglePi,
  fromRadians,
} from '../src/cordic.js';
import {
  computeRotate,
  computeUnitCircle,
  computeVector,
  runBatch,
} from '../src/service.js';
import { AppError } from '../src/errors.js';

const dbPath = resolve(process.cwd(), 'data', 'test.sqlite');
rmSync(dbPath, { force: true });

const N = 20;
const TOL_20 = 2e-6; // 20 次微旋转剩余误差约 2^-20 ≈ 9.5e-7，留余量

test('单位圆固定角度对照标准 sin/cos', () => {
  const anglesDeg = [0, 30, 45, 60, 90, -30, -120, 170, -170, 360, 720, -540];
  for (const deg of anglesDeg) {
    const rad = (deg * Math.PI) / 180;
    const r = cordicRotate(rad, 1, 0, N);
    assert.ok(Math.abs(r.x - Math.cos(rad)) < TOL_20, 'cos ' + deg);
    assert.ok(Math.abs(r.y - Math.sin(rad)) < TOL_20, 'sin ' + deg);
    assert.ok(Math.abs(r.residualAngle) < TOL_20, 'residual ' + deg);
  }
  // 高次数可逼近双精度极限（但非任意高精度保证）
  const hi = cordicRotate(0.6, 1, 0, 40);
  assert.ok(Math.abs(hi.x - Math.cos(0.6)) < 1e-11);
  assert.ok(Math.abs(hi.y - Math.sin(0.6)) < 1e-11);
});

test('四条坐标轴方向（向量模式）', () => {
  const cases: Array<[number, number, number, string]> = [
    [1, 0, 0, 'positive-x'],
    [0, 1, Math.PI / 2, 'positive-y'],
    [-1, 0, Math.PI, 'negative-x'],
    [0, -1, -Math.PI / 2, 'negative-y'],
  ];
  for (const [x, y, expectAngle, axis] of cases) {
    const r = cordicVector(x, y, N);
    assert.ok(r.angleDefined);
    assert.ok(Math.abs((r.angle as number) - expectAngle) < 1e-12, 'angle ' + axis);
    assert.equal(r.axis, axis);
    assert.ok(Math.abs(r.magnitude - 1) < TOL_20, 'mag ' + axis);
  }
});

test('负角与整周等价', () => {
  const a = cordicRotate(-Math.PI / 6, 1, 0, N);
  assert.ok(Math.abs(a.y - Math.sin(-Math.PI / 6)) < TOL_20);
  const b = cordicRotate(2 * Math.PI + Math.PI / 6, 1, 0, N);
  const c = cordicRotate(Math.PI / 6, 1, 0, N);
  assert.ok(Math.abs(b.x - c.x) < 1e-9);
  assert.ok(Math.abs(b.y - c.y) < 1e-9);
});

test('零向量：模长零且方向未定义', () => {
  const r = cordicVector(0, 0, N);
  assert.equal(r.angleDefined, false);
  assert.equal(r.angle, null);
  assert.equal(r.magnitude, 0);
  assert.equal(r.steps.length, 0);
});

test('非单位输入向量模长与方向（含左半平面）', () => {
  const vectors: Array<[number, number]> = [
    [3, 4],
    [-3, 4],
    [3, -4],
    [-3, -4],
    [1e8, 1],
    [-1e8, -1],
    [0.5, -0.25],
  ];
  for (const [x, y] of vectors) {
    const r = cordicVector(x, y, N);
    assert.ok(
      Math.abs(r.magnitude - Math.hypot(x, y)) < 1e-6 * Math.hypot(x, y) + 1e-8,
      'mag',
    );
    assert.ok(
      Math.abs(normalizeAnglePi((r.angle as number) - Math.atan2(y, x))) < TOL_20,
      'angle ' + x + ',' + y,
    );
  }
});

test('旋转后再反转近似恢复原向量', () => {
  const rad = 1.23456;
  const x0 = 2.5;
  const y0 = -1.75;
  const fwd = cordicRotate(rad, x0, y0, N);
  const back = cordicRotate(-rad, fwd.x, fwd.y, N);
  assert.ok(Math.abs(back.x - x0) < 1e-5, 'back x');
  assert.ok(Math.abs(back.y - y0) < 1e-5, 'back y');
});

test('增益补偿后模长保持', () => {
  for (const deg of [0, 30, 100, 170, -170, -90]) {
    const rad = (deg * Math.PI) / 180;
    const x0 = 3;
    const y0 = 4;
    const r = cordicRotate(rad, x0, y0, N);
    assert.ok(Math.abs(r.outputMagnitude - 5) < 1e-5, 'mag keep ' + deg);
  }
});

test('步记录最后状态与结果一致', () => {
  const r = cordicRotate(0.6, 1, 0, N);
  const last = r.steps[r.steps.length - 1];
  assert.ok(Math.abs(last.xAfter * r.gainCompensation - r.x) < 1e-15);
  assert.ok(Math.abs(last.yAfter * r.gainCompensation - r.y) < 1e-15);
  assert.ok(Math.abs(last.zAfter - r.residualAngle) < 1e-15);

  const v = cordicVector(-2, 3, N);
  const lv = v.steps[v.steps.length - 1];
  assert.ok(Math.abs(lv.xAfter * v.gainCompensation - v.magnitude) < 1e-12);
});

test('坐标更新读取更新前 x/y：直接核对单步公式', () => {
  const r = cordicRotate(0.5, 1, 0, 5);
  const s0 = r.steps[0];
  assert.equal(s0.d, 1);
  assert.equal(s0.shift, 1);
  // d=+1: x1 = x0 - y0 = 1, y1 = y0 + x0 = 1
  assert.ok(Math.abs(s0.xAfter - 1) < 1e-15);
  assert.ok(Math.abs(s0.yAfter - 1) < 1e-15);
});

test('精度随次数改善（8 次误差大于 20 次）', () => {
  const rad = 1.0;
  const e8 = Math.abs(cordicRotate(rad, 1, 0, 8).x - Math.cos(rad));
  const e20 = Math.abs(cordicRotate(rad, 1, 0, 20).x - Math.cos(rad));
  assert.ok(e20 < e8);
});

test('服务层：度单位端到端并持久化', () => {
  const o = computeUnitCircle(dbPath, { angle: 30, unit: 'deg', iterations: 16 });
  assert.ok(Math.abs(o.cos - Math.cos(Math.PI / 6)) < 2e-5);
  assert.ok(o.reportId > 0);
  assert.equal(o.angleTableVersion.startsWith('CT-v1'), true);
});

test('服务层：零向量不以统一成功布尔掩盖，方向标记未定义', () => {
  const o = computeVector(dbPath, { x: 0, y: 0, unit: 'deg', iterations: 16 });
  assert.equal(o.angleDefined, false);
  assert.equal(o.angle.rad, null);
  assert.equal(o.angle.deg, null);
  assert.equal(o.reference.errorAngleRad, null);
});

test('批量：非法项返回错误码且不影响其他项', () => {
  const results = runBatch(dbPath, [
    { op: 'unit-circle', body: { angle: 30, unit: 'deg', iterations: 16 } },
    { op: 'unit-circle', body: { angle: 30, unit: 'bogus', iterations: 16 } },
    { op: 'vector', body: { x: 0, y: 0, unit: 'deg', iterations: 16 } },
  ]);
  assert.equal(results.length, 3);
  assert.ok('cos' in (results[0] as Record<string, unknown>));
  assert.equal((results[1] as { code: string }).code, 'INVALID_UNIT');
  assert.equal((results[2] as { angleDefined: boolean }).angleDefined, false);
});

test('非法参数被拒绝并带错误码', () => {
  assert.throws(
    () => computeUnitCircle(dbPath, { angle: NaN, unit: 'rad' }),
    (e: AppError) => e.code === 'NON_FINITE_NUMBER',
  );
  assert.throws(
    () => computeUnitCircle(dbPath, { angle: 10, unit: 'rad', iterations: 0 }),
    (e: AppError) => e.code === 'ITERATIONS_OUT_OF_RANGE',
  );
  assert.throws(
    () => computeUnitCircle(dbPath, { angle: 10, unit: 'rad', iterations: 49 }),
    (e: AppError) => e.code === 'ITERATIONS_OUT_OF_RANGE',
  );
  assert.throws(
    () => computeUnitCircle(dbPath, { angle: 5000, unit: 'rad' }),
    (e: AppError) => e.code === 'ANGLE_OUT_OF_RANGE',
  );
  assert.throws(
    () => computeRotate(dbPath, { x: 1e10, y: 0, angle: 1, unit: 'rad' }),
    (e: AppError) => e.code === 'COORD_OUT_OF_RANGE',
  );
  assert.throws(
    () => computeUnitCircle(dbPath, { angle: 30, unit: 'deg' as unknown as string, iterations: 1.5 }),
    (e: AppError) => e.code === 'ITERATIONS_OUT_OF_RANGE',
  );
});

test('角表版本与增益在步间单调累积', () => {
  const r10 = cordicRotate(0.3, 1, 0, 10);
  const r20 = cordicRotate(0.3, 1, 0, 20);
  assert.ok(r20.gain > r10.gain);
  assert.ok(r10.gainCompensation > r20.gainCompensation);
  assert.equal(r10.angleTableVersion, r20.angleTableVersion);
});

test('方向角规范化区间 (-pi, pi]：-pi 归为 +pi', () => {
  assert.equal(normalizeAnglePi(-Math.PI), Math.PI);
  assert.ok(Math.abs(normalizeAnglePi(3 * Math.PI) - Math.PI) < 1e-12);
  const negX = cordicVector(-1, 0, N);
  assert.equal(negX.angle, Math.PI);
});

test('fromRadians 单位换算', () => {
  assert.ok(Math.abs(fromRadians(Math.PI, 'deg') - 180) < 1e-12);
});
