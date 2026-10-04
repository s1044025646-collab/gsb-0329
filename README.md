# CORDIC 平面旋转与角度求取解释后端（教学用）

纯本地运行的 TypeScript + Node.js + SQLite 后端，实现**圆周模式 CORDIC** 的旋转模式与向量模式。
只提供 HTTP API 与 CLI，无前端。不依赖 Docker、WSL 或任何外部在线服务。

## 功能

- `sincos`：给定角度计算 cos/sin（单位圆值）
- `rotate`：把二维向量 (x, y) 旋转指定角度
- `polar`：给定向量求模长与带象限的方向角（规范区间 `(-π, π]`，度制 `(-180, 180]`）
- 单步记录（每步的方向、移位因子、微旋转角、更新前后坐标、剩余角）
- 不同迭代次数对比、批量计算、历史报告查询（含步记录分页）
- 所有运行持久化到 SQLite，重复计算确定，重启后旧报告可读取

## 环境要求

- Windows 本地，Node.js ≥ 22.5（使用内置 `node:sqlite`，无需原生编译依赖）
- 仅开发依赖：`typescript`、`@types/node`

## 快速开始

```powershell
npm install
npm run build     # 编译 TypeScript 到 dist/
npm test          # 构建并运行全部测试
npm run demo      # 演示：30° 单位向量、跨象限旋转、左半平面方向角、8 vs 20 次迭代
npm start         # 启动 HTTP 服务（默认自动选择空闲端口）
npm start -- --port 8080   # 指定端口
```

CLI 示例：

```powershell
npm run cli -- sincos --angle 30 --unit deg --iterations 12 --steps
npm run cli -- rotate --x 1 --y 2 --angle 90 --unit deg --iterations 16
npm run cli -- polar --x -3 --y 4 --unit deg --iterations 16
npm run cli -- compare --kind sincos --angle 30 --unit deg --iterations 8,20
npm run cli -- report --id 1 --steps
npm run cli -- runs
```

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查、角表版本、迭代范围 |
| POST | `/api/sincos` | `{angle, unit, iterations}` |
| POST | `/api/rotate` | `{x, y, angle, unit, iterations}` |
| POST | `/api/polar` | `{x, y, unit, iterations}` |
| POST | `/api/batch` | `{items: [{kind, ...}]}`，上限 64 项 |
| POST | `/api/compare` | `{kind, ..., iterations: [8, 20]}`，每个次数单独保存 |
| GET | `/api/runs` | 历史报告列表 |
| GET | `/api/runs/:id?offset=&limit=` | 报告详情，步记录分页（不影响已完成的迭代） |

`unit` 只接受 `"rad"` 或 `"deg"`；`iterations` 为 1..40 的整数。

### 错误码

`INVALID_NUMBER`（非有限数值）、`INVALID_UNIT`、`INVALID_ITERATIONS`、
`ANGLE_TOO_LARGE`（|角度| > 1e6 rad）、`VALUE_TOO_LARGE`（向量模长 > 1e6）、
`BATCH_TOO_LARGE`、`INVALID_JSON`、`PAYLOAD_TOO_LARGE`、`NOT_FOUND`。
失败请求不会写入或覆盖任何已有报告。

## 算法说明

### 微旋转与迭代核心

第 i 步微旋转角为 `atan(2^-i)`。方向选择：

- 旋转模式：`d = sign(剩余角 z)`，目标是把 z 驱向 0
- 向量模式：`d = -sign(y)`，目标是把 y 驱向 0

每步更新（两条坐标都读取**更新前**的 x、y）：

```
x' = x - d * y * 2^-i
y' = y + d * x * 2^-i
z' = z - d * atan(2^-i)
```

### 增益补偿

每次微旋转把向量模长放大 `sqrt(1 + 2^-2i)`。n 步总增益的倒数
`K(n) = Π 1/sqrt(1 + 2^-2i)` 在迭代前预乘到输入上（旋转模式），
或在输出时乘回（向量模式求模长），因此结果模长保持，而不是只累计角度。

### 收敛区间处理

角表总和约为 ±99.9°，因此：

- 旋转模式：先把角度化到 `(-π, π]`，再通过象限修正（对输入向量做一次精确 90° 旋转）
  化到 `[-π/2, π/2]`，修正量记录在 `quadrantShift`
- 向量模式：左半平面（x < 0）先做 ±90° 预旋转移到右半平面，
  修正角 `±π/2` 记录在 `halfPlaneShift` 并加回结果

### 输出规范

- 方向角规范区间：`(-π, π]`（度制 `(-180, 180]`）；负 x 轴上的向量按确定规则归一到 `+π`
- 零向量：模长 0，`angleDefined = false`，方向角为 `null`（未定义），不用统一成功布尔值掩盖
- 每次输出包含 `residual`（旋转模式为剩余角，向量模式为补偿后的剩余 y）与模长变化，便于核对

## 精度与适用范围

- 这是**普通双精度数值实验**，不模拟硬件寄存器、不追求正确舍入，也不含双曲/线性 CORDIC
- 迭代次数越多通常误差越小（残余角量级约为 `atan(2^-(n-1))`），但受双精度限制，
  不是任意精度保证；约 24 次后误差进入 1e-7 量级，继续增加收益递减
- 角表与增益在初始化时用 `Math.atan`/`Math.sqrt` 生成；测试中的 `sin/cos/hypot/atan2`
  仅作独立参考对照，不参与求值路径
- 输入量级上限：坐标/模长 ≤ 1e6，角度 ≤ 1e6 rad（超大角度先取模，精度随量级下降）

## 持久化

- SQLite 数据库位于项目内 `data/cordic.db`（自动创建）
- 每次运行保存：原始输入、单位、迭代次数、角表版本（`cordic-circular-v1`）、结果与解释摘要（含全部步记录）
- 不同迭代次数的结果各自成行保存，绝不把高次数结果填入低次数运行

## 项目结构

```
src/cordic.ts   迭代核心（角表、增益、旋转/向量模式、步记录）
src/service.ts  参数校验、单位换算、错误码、批量/分页上限
src/db.ts       SQLite 持久化（node:sqlite）
src/server.ts   HTTP API、端口选择
src/cli.ts      命令行表格输出（坐标、残余角、参考误差）
src/demo.ts     演示脚本
test/           node:test 测试（核心 + API）
```

## 测试覆盖

四条坐标轴、负角、整周等价、零向量、非单位输入、非法参数与错误码、
固定角度/向量对照 `sin/cos/hypot/atan2`（阈值随迭代次数设定）、
旋转再反转恢复、增益补偿后模长保持、步记录最后状态与结果一致、
坐标更新结构校验（两条更新均读取更新前的 x、y）、API 报告分页与批量。
