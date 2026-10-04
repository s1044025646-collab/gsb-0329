import { test } from "node:test";
import assert from "node:assert/strict";
import { rotate, vector, gainFor, ATAN_TABLE, MAX_ITERATIONS } from "../src/cordic";
import {
  computePolar, computeRotate, computeSincos, ApiError,
} from "../src/service";

const tol = (n: number) => Math.pow(2, -Math.min(n, 24)) * 8 + 1e-12;

test("四条坐标轴方向角", () => {
  const cases: Array<[number, number, number]> = [
    [1, 0, 0],
    [0, 1, Math.PI / 2],
    [-1, 0, Math.PI],
    [0, -1, -Math.PI / 2],
  ];
  for (const [x, y, expected] of cases) {
    const r = vector(x, y, 24);
    assert.ok(Math.abs(r.angle - expected) < 1e-6, `(${x},${y}) -> ${r.angle}`);
    assert.ok(Math.abs(r.magnitude - 1) < 1e-9);
  }
});

test("负角与整周等价", () => {
  const a = computeSincos(-30, "deg", 20);
  const b = computeSincos(330, "deg", 20);
  assert.ok(Math.abs(a.result.cos - b.result.cos) < 1e-9);
  assert.ok(Math.abs(a.result.sin - b.result.sin) < 1e-9);
  const c = computeSincos(30 + 360 * 3, "deg", 20);
  const d = computeSincos(30, "deg", 20);
  assert.ok(Math.abs(c.result.cos - d.result.cos) < 1e-9);
  assert.ok(Math.abs(c.result.sin - d.result.sin) < 1e-9);
});

test("零向量：模长 0，方向未定义", () => {
  const r = computePolar(0, 0, "rad", 12);
  assert.equal(r.result.magnitude, 0);
  assert.equal(r.result.angleDefined, false);
  assert.equal(r.result.angle, null);
});

test("非单位输入的模长保持与方向", () => {
  const r = computePolar(-3, -4, "rad", 24);
  assert.ok(Math.abs(r.result.magnitude - 5) < 1e-6);
  assert.ok(Math.abs((r.result.angleRad as number) - Math.atan2(-4, -3)) < 1e-5);
});

test("固定角度与向量的独立核对（sin/cos/hypot/atan2）", () => {
  const angles = [0, 15, 30, 45, 89.9, 120, 200, 270, 359.9, -45, -200];
  for (const deg of angles) {
    const n = 24;
    const r = computeSincos(deg, "deg", n);
    const rad = (deg * Math.PI) / 180;
    assert.ok(Math.abs(r.result.cos - Math.cos(rad)) < tol(n), `cos ${deg}`);
    assert.ok(Math.abs(r.result.sin - Math.sin(rad)) < tol(n), `sin ${deg}`);
  }
  const vecs: Array<[number, number]> = [[3, 4], [-3, 4], [-3, -4], [3, -4], [0.5, -0.25], [1e5, 1]];
  for (const [x, y] of vecs) {
    const r = computePolar(x, y, "rad", 28);
    assert.ok(Math.abs(r.result.magnitude - Math.hypot(x, y)) < 1e-6 * Math.hypot(x, y));
    assert.ok(Math.abs((r.result.angleRad as number) - Math.atan2(y, x)) < 1e-5);
  }
});

test("误差随迭代次数下降", () => {
  const rad = Math.PI / 6;
  let prev = Infinity;
  for (const n of [6, 10, 16, 24]) {
    const r = computeSincos(30, "deg", n);
    const err = Math.max(
      Math.abs(r.result.cos - Math.cos(rad)),
      Math.abs(r.result.sin - Math.sin(rad)),
    );
    assert.ok(err < prev, `n=${n} err=${err} prev=${prev}`);
    prev = err;
  }
});

test("旋转再反转近似恢复原向量", () => {
  const fwd = rotate(1.5, -2.5, 1.234, 28);
  const back = rotate(fwd.x, fwd.y, -1.234, 28);
  assert.ok(Math.abs(back.x - 1.5) < 1e-6);
  assert.ok(Math.abs(back.y - -2.5) < 1e-6);
});

test("增益补偿后模长保持", () => {
  const r = computeRotate(3, 4, 137, "deg", 24);
  assert.ok(Math.abs(r.result.magnitudeAfter - 5) < 1e-6);
  assert.ok(gainFor(1) < 1 && gainFor(MAX_ITERATIONS) > 0.6);
});

test("步记录最后状态与结果一致", () => {
  const r = computeSincos(42, "deg", 15);
  const last = r.steps[r.steps.length - 1];
  assert.equal(last.xAfter, r.result.cos);
  assert.equal(last.yAfter, r.result.sin);
  assert.equal(last.residualAfter, r.result.residual);
  const v = computePolar(-2, 7, "rad", 15);
  const vlast = v.steps[v.steps.length - 1];
  assert.ok(Math.abs(vlast.xAfter * (v.explanation.gain) - v.result.magnitude) < 1e-12);
});

test("每步坐标更新读取更新前的 x、y（结构校验）", () => {
  const r = rotate(1, 0, 0.5, 10);
  for (const s of r.steps) {
    const f = Math.pow(2, -s.shift);
    assert.ok(Math.abs(s.xAfter - (s.xBefore - s.direction * s.yBefore * f)) < 1e-15);
    assert.ok(Math.abs(s.yAfter - (s.yBefore + s.direction * s.xBefore * f)) < 1e-15);
    assert.ok(Math.abs(s.atan - ATAN_TABLE[s.i]) < 1e-18);
  }
});

test("非法参数被拒绝", () => {
  const code = (fn: () => void): string => {
    try { fn(); } catch (e) { return (e as ApiError).code; }
    return "";
  };
  assert.equal(code(() => computeSincos(NaN, "deg", 10)), "INVALID_NUMBER");
  assert.equal(code(() => computeSincos(Infinity, "deg", 10)), "INVALID_NUMBER");
  assert.equal(code(() => computeSincos(1e9, "rad", 10)), "ANGLE_TOO_LARGE");
  assert.equal(code(() => computeRotate(1e7, 0, 10, "deg", 10)), "VALUE_TOO_LARGE");
  assert.equal(code(() => computeSincos(30, "deg", 0)), "INVALID_ITERATIONS");
  assert.equal(code(() => computeSincos(30, "deg", 99)), "INVALID_ITERATIONS");
  assert.equal(code(() => computeSincos(30, "grad" as never, 10)), "INVALID_UNIT");
});

test("角表与增益", () => {
  assert.ok(Math.abs(ATAN_TABLE[0] - Math.PI / 4) < 1e-15);
  assert.ok(Math.abs(ATAN_TABLE[3] - Math.atan(0.125)) < 1e-15);
});
