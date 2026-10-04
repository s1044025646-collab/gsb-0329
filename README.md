# CORDIC 平面旋转与角度求取解释后端（教学用）

只做后端：TypeScript + Node.js + SQLite，提供 HTTP API 与命令行（CLI）。
在 Windows 本地直接运行，不依赖 Docker、WSL、付费服务或外部在线 API。

本服务用**自己实现的圆周模式 CORDIC**完成两类计算：

- **旋转模式（rotation mode）**：给定角度，计算单位圆的 sin/cos，或把任意二维向量旋转指定角度。目标是把剩余角 `z` 旋到 0。
- **向量模式（vectoring mode）**：给定非零二维向量 `(x,y)`，计算模长与带象限的方向角。目标是把 `y` 旋到 0。

仅做普通双精度（IEEE-754 double）数值实验：**不**模拟硬件寄存器、**不**追求正确舍入（correct rounding）、**不**包含双曲或线性 CORDIC。

## 环境要求

- Node.js >= 22（开发与验证使用 v25.5.0；使用 Node 内置实验模块 `node:sqlite`，无需编译原生扩展）。
- Windows PowerShell（命令示例可直接运行）。

> 运行时若看到 `ExperimentalWarning: SQLite is an experimental feature`，属正常提示，不影响功能。

## 构建、测试、启动、演示

```powershell
npm install        # 安装 typescript / @types/node
npm run build      # 编译到 dist/
npm test           # 编译并运行 node:test 测试（17 项）
npm run demo       # 运行教学演示（30°、跨象限、左半平面、8 次 vs 20 次）
npm start          # 启动 HTTP 服务（默认自动选择 127.0.0.1 的空闲端口）
```

也可指定端口：`node dist/src/cli.js serve --port 8731`。

数据文件固定在项目内 `data/cordic.sqlite`（演示用 `data/demo.sqlite`，测试用 `data/test.sqlite`）。

## CORDIC 算法说明

### 微旋转

第 `i` 步移位因子与微旋转角：

```
shift_i = 2^-i
theta_i = atan(shift_i)        // 仅在初始化角表时使用标准 atan
```

**旋转模式**（`z` 为尚需完成的旋转角，`z>=0 -> d=+1`，否则 `d=-1`）：

```
x_{i+1} = x_i - d_i * y_i * shift_i
y_{i+1} = y_i + d_i * x_i * shift_i
z_{i+1} = z_i - d_i * theta_i
```

**向量模式**（把 `y` 旋向 x 轴，`y>=0 -> d=-1`，否则 `d=+1`）：

```
x_{i+1} = x_i - d_i * y_i * shift_i
y_{i+1} = y_i + d_i * x_i * shift_i
z_{i+1} = z_i - d_i * theta_i     // z 从 0 累计旋转角
```

两条坐标更新都只读取**进入本步前**的 `x、y`：代码中先保存 `xBefore/yBefore`，用同一 `d_i`
同时算出 `xAfter/yAfter`，绝不会“先写 x 再用新 x 算 y”。

### 增益补偿（不会遗漏模长变化）

每次微旋转引入因子 `k_i = sqrt(1 + 2^-2i)`，`n` 次累计增益：

```
K_n = prod_i sqrt(1 + 2^-2i)      // n 增大时 K_n -> 约 1.64676
```

微旋转后的坐标整体被放大 `K_n`。最终统一乘以补偿因子 `1/K_n`：

- 旋转模式：补偿后输出向量模长应近似等于输入模长（报告给出可核对的“模长变化”）。
- 向量模式：补偿后 `x` 即原向量模长。

### 收敛区间与象限修正

圆周 CORDIC 旋转模式可直接收敛的角度约为 `[-99.9°, 99.9°]`。

- **旋转模式**：先把输入角按整周折叠到 `(-π, π]`，若超出 `[-π/2, π/2]`，先做一次精确的
  ±90° 坐标旋转（`(x,y)->(-y,x)` 或 `(y,-x)`）把角度折回收敛区间，并记录该
  **象限修正量**；CORDIC 完成后输出坐标已包含该修正，结果仍对应完整目标角。
- **向量模式**：标准 CORDIC 需要起点 `x>0`。对左半平面（`x<0`）先做 180° 翻转 `(-x,-y)`，
  记录**左半平面修正**（`y0>=0` 记 `+π`，`y0<0` 记 `-π`），迭代后用
  `angle = normalize(z - halfPlaneCorrection)` 还原完整方向角。**不是**简单的 `atan(y/x)`。

### 方向角规范与轴向规则

- 非零向量方向角规范区间为 **`(-π, π]`**。
- 轴上向量使用确定规则：`+x=0`、`+y=π/2`、`-x=+π`（注意 `-π` 归一为 `+π`）、`-y=-π/2`。
- **零向量**：模长返回 `0`，方向标记为未定义（`angleDefined=false`，`angle=null`），
  不用统一的成功布尔值掩盖。

### 迭代次数与浮点误差

- 合法范围 `1..48`，默认 `16`。微旋转的角分辨率约为 `2^-n`：
  例如 8 次误差常见在 `1e-3` 量级，16 次约 `1e-5`，20 次约 `1e-6`。
- 次数增加**通常**改善精度，但受双精度浮点限制，**不保证任意高精度**；约 40 次后提升趋于饱和。
- 参考值（标准 `sin/cos/hypot/atan2`）**只用于演示对照与测试断言**，不参与核心求值路径；
  实际答案完全来自上述自研迭代核心与角表（角表/增益允许在初始化时用标准函数生成）。

## 输入校验与错误码

- 角度与坐标必须是**有限数值**（拒绝 `NaN/Infinity`）。
- 角度量级上限 `|弧度| <= 1000`；坐标量级上限 `|x|,|y| <= 1e9`。
- 单位必须是 `rad` 或 `deg`；非法单位被拒绝。
- 迭代次数必须是 `[1,48]` 内整数。
- 批量最多 50 条；比较最多 10 组；单步解释每页最多 48 条（分页仅影响返回，不影响实际迭代，迭代始终跑满 n 步）。

错误码：`INVALID_UNIT`、`NON_FINITE_NUMBER`、`ANGLE_OUT_OF_RANGE`、`COORD_OUT_OF_RANGE`、
`ITERATIONS_OUT_OF_RANGE`、`ZERO_VECTOR_DIRECTION_UNDEFINED`、`LIMIT_EXCEEDED`、
`NOT_FOUND`、`INVALID_JSON`、`INVALID_BATCH`。HTTP 状态：参数类 400，报告不存在 404。

## HTTP API

监听 `http://127.0.0.1:<port>`，请求/响应均为 JSON。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/cordic/unit-circle` | 单位圆 sin/cos，body: `{angle,unit,iterations}` |
| POST | `/api/cordic/rotate` | 旋转向量，body: `{x,y,angle,unit,iterations}` |
| POST | `/api/cordic/vector` | 模长与方向角，body: `{x,y,unit,iterations}` |
| POST | `/api/cordic/batch` | 批量，body: `{items:[{op,body},...]}`（≤50） |
| POST | `/api/cordic/compare` | 比较不同次数，body: `{op,angle,unit,iterationsList:[8,20],x?,y?}` |
| GET | `/api/reports?limit=` | 报告摘要列表 |
| GET | `/api/reports/:id?offset=&limit=` | 读取历史报告与单步分页 |
| GET | `/health` | 健康检查 |

响应包含：使用次数 `iterations`、角表版本 `angleTableVersion`（`CT-v1-atantable-double`）、
增益与补偿、`residualAngle`（残余角）/`residualY`、可核对的模长变化，以及独立参考误差。

示例（PowerShell）：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8731/api/cordic/unit-circle -Method Post `
  -ContentType 'application/json' -Body '{"angle":30,"unit":"deg","iterations":20}'
```

## CLI

```powershell
node dist/src/cli.js unit   --angle 30 --unit deg --iterations 20
node dist/src/cli.js rotate --x 1 --y 0 --angle 200 --unit deg --iterations 20
node dist/src/cli.js vector --x -3 --y 4 --unit deg --iterations 20
node dist/src/cli.js compare --op unit --angle 30 --unit deg --list 8,20
node dist/src/cli.js steps   --id 1 --offset 0 --limit 10
node dist/src/cli.js report  --id 1
node dist/src/cli.js list   --limit 20
node dist/src/cli.js serve  --port 8731
node dist/src/cli.js help
```

CLI 以表格展示坐标、残余角与参考误差（参考仅用于对照）。

## 持久化

SQLite 表 `reports` 保存：原始参数 `params_json`、单位、迭代配置（次数）、角表版本、
结果 `result_json`、解释摘要 `explain_json` 与全量单步 `steps_json`。

- 重复计算是确定的；不同迭代次数各自独立保存，不会把高次数结果填入低次数运行。
- 报告写入仅在计算成功路径发生，**失败不会覆盖已有报告**。
- 重启后可通过 `GET /api/reports/:id` 或 `cli report/steps` 读取旧报告。

## 适用范围与限制

- 仅圆周模式，用于教学演示 CORDIC 的方向选择、移位、剩余角与增益补偿。
- 双精度数值实验，非硬件建模、非正确舍入数学库、不承诺任意高精度。
- 超大角度先做整周折叠；超大坐标/越界参数直接拒绝而非尝试计算。
- 仅后端，不含图形界面。
