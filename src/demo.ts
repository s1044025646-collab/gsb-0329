/** 教学演示：30° 单位向量、跨象限旋转、左半平面方向角、8 次与 20 次对照。 */
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeRotate, computeUnitCircle, computeVector } from './service.js';
import { renderTable, fmt } from './table.js';

const dbPath = resolve(process.cwd(), 'data', 'demo.sqlite');
try {
  rmSync(dbPath, { force: true });
} catch {
  /* 忽略 */
}

console.log('=== 演示 1：30° 单位圆（度） ===');
const u30 = computeUnitCircle(dbPath, { angle: 30, unit: 'deg', iterations: 20 });
console.log(
  renderTable(
    ['量', 'CORDIC', '参考', '误差'],
    [
      ['cos', fmt(u30.cos), fmt(u30.reference.cos), fmt(u30.reference.errorCos, 12)],
      ['sin', fmt(u30.sin), fmt(u30.reference.sin), fmt(u30.reference.errorSin, 12)],
    ],
    false,
  ),
);
console.log('残余角(度):', fmt(u30.residualAngle.deg, 10), ' 补偿后模长:', fmt(u30.magnitudeCheck));

console.log('\n=== 演示 2：跨象限旋转 (1,0) 旋转 200°（进入左半平面） ===');
const r200 = computeRotate(dbPath, { x: 1, y: 0, angle: 200, unit: 'deg', iterations: 20 });
console.log('输出:', '(' + fmt(r200.output.x) + ', ' + fmt(r200.output.y) + ')');
console.log('参考:', '(' + fmt(r200.reference.x) + ', ' + fmt(r200.reference.y) + ')');
console.log('象限修正(度):', fmt(r200.quadrantCorrection.deg), ' 模长变化:', fmt(r200.magnitude.change, 12));

console.log('\n=== 演示 3：左半平面方向角 (-3, 4) ===');
const v = computeVector(dbPath, { x: -3, y: 4, unit: 'deg', iterations: 20 });
console.log('模长:', fmt(v.magnitude), ' 参考:', fmt(v.reference.magnitude));
console.log('方向角(度):', v.angle.deg === null ? '未定义' : fmt(v.angle.deg));
console.log(
  '参考方向角(度):',
  v.reference.angleRad === null ? '未定义' : fmt((v.reference.angleRad * 180) / Math.PI),
);
console.log('左半平面修正(度):', fmt(v.halfPlaneCorrection.deg));

console.log('\n=== 演示 4：8 次 vs 20 次（30° 单位圆） ===');
const rows = [8, 20].map((n) => {
  const o = computeUnitCircle(dbPath, { angle: 30, unit: 'deg', iterations: n });
  return [
    n,
    fmt(o.cos),
    fmt(o.sin),
    fmt(o.residualAngle.deg, 8),
    fmt(Math.max(o.reference.errorCos, o.reference.errorSin), 12),
  ];
});
console.log(renderTable(['次数', 'cos', 'sin', '残余角(度)', '最大参考误差'], rows));

console.log('\n报告已写入:', dbPath);
