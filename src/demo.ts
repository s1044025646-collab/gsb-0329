import { computePolar, computeRotate, computeSincos } from "./service";
import { saveRun } from "./db";

function line(s = ""): void {
  console.log(s);
}

function show(label: string, value: unknown): void {
  line(`${label}: ${JSON.stringify(value)}`);
}

function main(): void {
  line("=== CORDIC 演示 ===");

  line("\n[1] 30 度单位向量（sincos，20 次迭代）");
  const s = computeSincos(30, "deg", 20);
  saveRun("sincos", s.input, "deg", 20, s.tableVersion, s.result, { ...s.explanation, steps: s.steps });
  show("cos/sin", { cos: s.result.cos, sin: s.result.sin });
  show("参考", { cos: Math.cos(Math.PI / 6), sin: Math.sin(Math.PI / 6) });
  show("残余角(rad)", s.result.residual);

  line("\n[2] 跨象限旋转：向量 (1, 0) 旋转 200 度");
  const r = computeRotate(1, 0, 200, "deg", 20);
  saveRun("rotate", r.input, "deg", 20, r.tableVersion, r.result, { ...r.explanation, steps: r.steps });
  show("旋转后", { x: r.result.x, y: r.result.y });
  show("参考", { x: Math.cos((200 * Math.PI) / 180), y: Math.sin((200 * Math.PI) / 180) });
  show("模长保持", { before: r.result.magnitudeBefore, after: r.result.magnitudeAfter });

  line("\n[3] 左半平面方向角：向量 (-3, 4)");
  const p = computePolar(-3, 4, "deg", 20);
  saveRun("polar", p.input, "deg", 20, p.tableVersion, p.result, { ...p.explanation, steps: p.steps });
  show("模长/方向角(deg)", { magnitude: p.result.magnitude, angle: p.result.angle });
  show("参考", { magnitude: Math.hypot(-3, 4), angle: (Math.atan2(4, -3) * 180) / Math.PI });

  line("\n[4] 8 次 vs 20 次迭代对比（30 度 sincos）");
  for (const n of [8, 20]) {
    const o = computeSincos(30, "deg", n);
    const id = saveRun("sincos", o.input, "deg", n, o.tableVersion, o.result, { ...o.explanation, steps: o.steps });
    const err = Math.max(
      Math.abs(o.result.cos - Math.cos(Math.PI / 6)),
      Math.abs(o.result.sin - Math.sin(Math.PI / 6)),
    );
    line(`  n=${String(n).padStart(2)}  id=${id}  cos=${o.result.cos.toPrecision(12)}  sin=${o.result.sin.toPrecision(12)}  参考误差=${err.toExponential(3)}`);
  }
  line("\n演示完成。以上运行均已保存到 data/cordic.db，可用 `npm run cli -- report --id <ID>` 查看。");
}

main();
