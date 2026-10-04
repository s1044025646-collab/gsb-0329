#!/usr/bin/env node
import { resolve } from 'node:path';
import { getReport, listReports } from './db.js';
import { AppError } from './errors.js';
import { fromRadians } from './cordic.js';
import {
  computeRotate,
  computeUnitCircle,
  computeVector,
  paginateSteps,
} from './service.js';
import { fmt, renderTable } from './table.js';

const DB_PATH = resolve(process.cwd(), 'data', 'cordic.sqlite');

const HELP = [
  'CORDIC 教学后端 CLI',
  '',
  '用法:',
  '  cordic unit --angle <数> --unit <rad|deg> [--iterations <n>]',
  '  cordic rotate --x <数> --y <数> --angle <数> --unit <rad|deg> [--iterations <n>]',
  '  cordic vector --x <数> --y <数> [--unit <rad|deg>] [--iterations <n>]',
  '  cordic steps --id <报告ID> [--offset <o>] [--limit <l>]',
  '  cordic compare --op <unit|rotate|vector> --angle <数> --unit <rad|deg> [--x --y] --list 8,12,16,20',
  '  cordic report --id <报告ID>',
  '  cordic list [--limit <n>]',
  '  cordic serve [--port <端口>]   (默认选择空闲端口)',
  '  cordic help',
  '',
  '迭代次数范围 1..48，默认 16。参考值仅用于对照，不参与核心输出。',
].join('\n');

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = 'true';
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

function num(a: Record<string, string>, key: string): number {
  if (!(key in a)) throw new AppError('NON_FINITE_NUMBER', '缺少参数 --' + key);
  const v = Number(a[key]);
  if (!Number.isFinite(v)) {
    throw new AppError('NON_FINITE_NUMBER', '--' + key + ' 必须是有限数值');
  }
  return v;
}

function iterations(a: Record<string, string>): number {
  return a.iterations ? Number(a.iterations) : 16;
}

function printUnit(o: ReturnType<typeof computeUnitCircle>): void {
  console.log(
    renderTable(
      ['项目', '值'],
      [
        ['报告ID', o.reportId],
        ['输入角(' + o.unit + ')', o.inputAngle],
        ['迭代次数', o.iterations],
        ['cos (CORDIC)', fmt(o.cos)],
        ['sin (CORDIC)', fmt(o.sin)],
        ['残余角(度)', fmt(o.residualAngle.deg, 6)],
        ['增益 K_n', fmt(o.gain)],
        ['补偿 1/K_n', fmt(o.gainCompensation)],
        ['补偿后模长', fmt(o.magnitudeCheck)],
        ['参考 cos', fmt(o.reference.cos)],
        ['参考 sin', fmt(o.reference.sin)],
        ['cos 误差', fmt(o.reference.errorCos, 12)],
        ['sin 误差', fmt(o.reference.errorSin, 12)],
      ],
      false,
    ),
  );
}

function printRotate(o: ReturnType<typeof computeRotate>): void {
  console.log(
    renderTable(
      ['项目', '值'],
      [
        ['报告ID', o.reportId],
        ['输入向量', '(' + fmt(o.input.x) + ', ' + fmt(o.input.y) + ')'],
        ['旋转角(' + o.unit + ')', o.input.angle],
        ['象限修正(度)', fmt(o.quadrantCorrection.deg, 6)],
        ['输出 x', fmt(o.output.x)],
        ['输出 y', fmt(o.output.y)],
        ['残余角(度)', fmt(o.residualAngle.deg, 6)],
        ['输入模长', fmt(o.magnitude.input)],
        ['输出模长', fmt(o.magnitude.output)],
        ['模长变化', fmt(o.magnitude.change, 12)],
        ['参考 x', fmt(o.reference.x)],
        ['参考 y', fmt(o.reference.y)],
        ['x 误差', fmt(o.reference.errorX, 12)],
        ['y 误差', fmt(o.reference.errorY, 12)],
      ],
      false,
    ),
  );
}

function printVector(o: ReturnType<typeof computeVector>): void {
  const rows: Array<[string, string | number]> = [
    ['报告ID', o.reportId],
    ['输入向量', '(' + fmt(o.input.x) + ', ' + fmt(o.input.y) + ')'],
    ['方向是否定义', o.angleDefined ? '是' : '否（零向量，方向未定义）'],
    ['模长 (CORDIC)', fmt(o.magnitude)],
    ['方向角(度)', o.angle.deg === null ? '未定义' : fmt(o.angle.deg)],
    ['规范区间', '(-pi, pi]'],
    ['轴向标记', o.axis],
    ['左半平面修正(度)', fmt(o.halfPlaneCorrection.deg, 6)],
    ['剩余 y（补偿后）', fmt(o.residualY, 12)],
    ['参考模长', fmt(o.reference.magnitude)],
    [
      '参考方向角(度)',
      o.reference.angleRad === null ? '未定义' : fmt(fromRadians(o.reference.angleRad, 'deg')),
    ],
    [
      '模长误差',
      o.reference.errorMagnitude === null ? '—' : fmt(o.reference.errorMagnitude, 12),
    ],
    [
      '方向角误差(度)',
      o.reference.errorAngleRad === null
        ? '—'
        : fmt(fromRadians(o.reference.errorAngleRad, 'deg'), 12),
    ],
  ];
  console.log(renderTable(['项目', '值'], rows, false));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const a = parseArgs(argv.slice(1));

  if (cmd === 'unit') {
    printUnit(
      computeUnitCircle(DB_PATH, {
        angle: num(a, 'angle'),
        unit: a.unit ?? 'rad',
        iterations: iterations(a),
      }),
    );
    return;
  }

  if (cmd === 'rotate') {
    printRotate(
      computeRotate(DB_PATH, {
        x: num(a, 'x'),
        y: num(a, 'y'),
        angle: num(a, 'angle'),
        unit: a.unit ?? 'rad',
        iterations: iterations(a),
      }),
    );
    return;
  }

  if (cmd === 'vector') {
    printVector(
      computeVector(DB_PATH, {
        x: num(a, 'x'),
        y: num(a, 'y'),
        unit: a.unit ?? 'rad',
        iterations: iterations(a),
      }),
    );
    return;
  }

  if (cmd === 'steps') {
    const id = num(a, 'id');
    const row = getReport(DB_PATH, id);
    if (!row) throw new AppError('NOT_FOUND', '报告 ' + id + ' 不存在');
    const all = JSON.parse(row.steps_json) as Parameters<typeof paginateSteps>[0];
    const page = paginateSteps(
      all,
      a.offset ? Number(a.offset) : 0,
      a.limit ? Number(a.limit) : 48,
    );
    console.log('报告 ' + id + ' 单步记录（共 ' + page.total + ' 步，显示 ' + page.steps.length + ' 步）');
    console.log(
      renderTable(
        ['i', 'd', '移位', 'x前', 'y前', 'x后', 'y后', '剩余角(度)'],
        page.steps.map((s) => [
          s.index,
          s.d,
          fmt(s.shift, 8),
          fmt(s.xBefore),
          fmt(s.yBefore),
          fmt(s.xAfter),
          fmt(s.yAfter),
          fmt(fromRadians(s.zAfter, 'deg'), 8),
        ]),
      ),
    );
    return;
  }

  if (cmd === 'compare') {
    const list = (a.list ?? '8,20').split(',').map((s) => Number(s.trim()));
    const op = (a.op ?? 'unit').toLowerCase();
    const unit = a.unit ?? 'rad';
    const angle = a.angle !== undefined ? num(a, 'angle') : 0;
    const rows = list.map((n) => {
      const body: Record<string, unknown> = { angle, unit, iterations: n };
      if (op === 'rotate' || op === 'vector') {
        body.x = a.x !== undefined ? num(a, 'x') : 1;
        body.y = a.y !== undefined ? num(a, 'y') : 0;
      }
      if (op === 'rotate') {
        const o = computeRotate(DB_PATH, body);
        return [
          n,
          fmt(o.output.x),
          fmt(o.output.y),
          fmt(o.residualAngle.deg, 8),
          fmt(Math.max(o.reference.errorX, o.reference.errorY), 12),
          o.reportId,
        ];
      }
      if (op === 'vector') {
        const o = computeVector(DB_PATH, body);
        return [
          n,
          fmt(o.magnitude),
          o.angle.deg === null ? '未定义' : fmt(o.angle.deg),
          fmt(o.residualY, 8),
          o.reference.errorMagnitude === null ? '—' : fmt(o.reference.errorMagnitude, 12),
          o.reportId,
        ];
      }
      const o = computeUnitCircle(DB_PATH, body);
      return [
        n,
        fmt(o.cos),
        fmt(o.sin),
        fmt(o.residualAngle.deg, 8),
        fmt(Math.max(o.reference.errorSin, o.reference.errorCos), 12),
        o.reportId,
      ];
    });
    console.log(
      renderTable(
        ['次数', '结果A(cos/x/模)', '结果B(sin/y/角)', '残余(度/剩y)', '参考误差', '报告ID'],
        rows,
      ),
    );
    return;
  }

  if (cmd === 'report') {
    const id = num(a, 'id');
    const row = getReport(DB_PATH, id);
    if (!row) throw new AppError('NOT_FOUND', '报告 ' + id + ' 不存在');
    console.log(
      JSON.stringify(
        {
          id: row.id,
          kind: row.kind,
          createdAt: row.created_at,
          unit: row.unit,
          iterations: row.iterations,
          angleTableVersion: row.angle_table_version,
          params: JSON.parse(row.params_json),
          result: JSON.parse(row.result_json),
          explain: JSON.parse(row.explain_json),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === 'list') {
    const limit = a.limit ? Number(a.limit) : 20;
    const rows = listReports(DB_PATH, limit);
    console.log(
      renderTable(
        ['ID', '类型', '单位', '次数', '角表版本', '创建时间'],
        rows.map((r) => [
          r.id,
          r.kind,
          r.unit ?? '-',
          r.iterations,
          r.angle_table_version,
          r.created_at,
        ]),
      ),
    );
    return;
  }

  if (cmd === 'serve') {
    const { startServer } = await import('./server.js');
    const preferred = a.port ? Number(a.port) : undefined;
    const { port } = await startServer(DB_PATH, preferred);
    console.log('CORDIC 服务已启动: http://127.0.0.1:' + port);
    console.log('数据文件:', DB_PATH);
    console.log('按 Ctrl+C 退出。');
    return;
  }

  if (cmd === undefined || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return;
  }

  throw new AppError('NOT_FOUND', '未知子命令: ' + cmd);
}

main().catch((e: unknown) => {
  const err = e as AppError;
  console.error('错误 [' + (err.code ?? 'INTERNAL') + ']: ' + (err.message ?? String(e)));
  process.exit(1);
});
