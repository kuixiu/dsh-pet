# DeepSeek Pet (`@kuixiu/dsh-pet`)

右下角的 Q 版小猫电子宠物 + DeepSeek 高峰/低谷时段提示。
A Q-style kitten in the bottom-right corner of the DeepSeek Harness Web GUI, with a
live DeepSeek peak / off-peak pricing indicator.

```
┌──────────────────────────────┐
│   🐱  (drag to move)         │
│   小橘 · 开心                 │
│   ┌──────────────────────┐   │
│   │ ● 低谷期    04:12:33 │   │   ← 徽章：点击展开详情
│   └──────────────────────┘   │
└──────────────────────────────┘
```

## 功能 / Features

| | |
|---|---|
| **右下角常驻浮层** | 注册在 `shell.overlay`（整帧浮层，click-through），`position: fixed` 落在右下角，不遮挡主界面。 |
| **Q 版小动物** | 内联 SVG 小猫，纯 CSS 动画：呼吸浮动、尾巴摇摆、耳朵抖动、定时眨眼、被摸时跳一下并冒爱心；心情变化会换表情。 |
| **高峰 / 低谷提示** | 徽章实时显示当前处于 **高峰期** 还是 **低谷期**，低谷期圆点呼吸闪烁，并显示距下次切换的倒计时。 |
| **多时区对照** | 面板同时给出北京时间（UTC+8）、你的本地时间和 UTC 时间，以及下次切换的具体时刻。 |
| **换季 / 节假日** | 内置 2026 年中国法定节假日表；周末与法定节假日全天按低谷期计。表过期时可手动勾选「今天是节假日」强制按低谷期显示。 |
| **可拖动 / 记忆位置** | 按住小猫拖动到任意位置，位置存 `localStorage`；面板里可一键复位到右下角。 |
| **养成数值** | 饱食度 / 心情 / 精力三个数值，按真实时间衰减（最多累计 48 小时）。喂食、摸头、玩耍、睡觉会改变数值并提升羁绊计数。数值存 `localStorage`。 |
| **跟随 agent 状态** | 读取当前会话的实时状态，小猫据此改变表情并在头顶显示气泡：正在工作（专注表情 + 闪烁圆点）、等待你操作（担心表情）、本轮完成（开心表情 + 冒爱心，持续 4 秒）、空闲。面板里可查看状态文字，也可关闭气泡。 |
| **中英双语** | 通过 `ctx.locale` 注册字典，跟随 Harness 语言设置。 |
| **可隐藏** | 双击宠物可隐藏为 🐾 按钮，随时点回来。 |

## 高峰 / 低谷规则依据

官方文档（[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/) 与
[模型 & 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)）原文：

> Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC,
> Monday through Friday, **excluding Chinese public holidays**. All other hours are off-peak,
> including weekends and Chinese public holidays in full.
>
> 空闲时段价格为高峰时段价格的一半。北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、
> 14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。

因此代码在 **Asia/Shanghai** 时区做判断（用 UTC 判断周几会在 UTC 16:00 之后与北京日期不一致）：

```
高峰 = 北京时间周一至周五 09:00–12:00、14:00–18:00，且当天不在节假日表中
低谷 = 其余全部时间（含周末、法定节假日全天），价格为高峰的一半（省 50%）
```

> ⚠️ 2025 年那套「北京时间 00:30–08:30 夜间错峰」的规则**已经失效**，不要沿用。
> 区间按左闭右开 `[start, end)` 处理；04:00 / 10:00 UTC 那一分钟的归属官方未明确说明。

`SCHEDULE.verified` 记录规则核对日期，`HOLIDAYS_2026` 是 2026 年
（国办发明电〔2025〕7号）需要翻转的**工作日**节假日；落在周末的节假日无需列出，因为周末本身已是低谷。

## 安装 / Install

### 从 npm 安装（发布后）

```sh
dsh plugin --profile desktop add @kuixiu/dsh-pet
```

或在 Harness 里让 Agent 调用 `plugin_manager action=install_bundle target=@kuixiu/dsh-pet`。

### 从本地目录安装（开发）

已通过 `plugin_manager` 安装进 `desktop` profile（`link:` 到本目录），改动源文件后刷新页面即可。

```
plugin_manager action=install_bundle target=<本目录绝对路径>
```

卸载：`plugin_manager action=remove_bundle target=@kuixiu/dsh-pet`。

> **首次生效需要刷新一次页面。** client bundle 由 client-modules 在首次请求时构建并缓存
> （`/plugins/<id>/client.js` 的 body "built once on its first GET"），所以本次安装后请刷新一次
> 页面（Ctrl+R / F5）。若刷新后仍看不到，重启一次宿主进程即可确定加载最新代码。

## 发布到 npm

包名 **`@kuixiu/dsh-pet`**，scope 与 npm 账号同名。发布前：

```sh
cd dsh-pet
node verify-all.mjs          # 九套校验；prepublishOnly 也会自动跑
npm login
npm publish --access public  # 带 scope 的包默认是 private，必须显式 public
```

**三个容易踩的点**：

1. **`--access public` 不能省。** scoped 包默认按私有发布，漏了会报 `402 Payment Required`
   （私有包要付费账号）。
2. **必须先拥有 `@kuixiu` scope。** npm 的 `@scope` 是**组织/发布域**，不是个人用户名 ——
   首次发布时 `@kuixiu` 会被自动创建为你的用户 scope，但如果你加入过同名组织就会冲突。
3. **包名必须等于三处标识**：`package.json` 的 `name`、`cordis.patch.yml` 的 loader 行 `name`、
   `client.js` 里 `__ModuleLoader__.load({ id })`。三处不一致时**浏览器端 bundle 会找不到**
   （host 半边形如能加载，但界面什么都不出现）。`verify-publish.mjs` 专门盯这一点。

`files` 白名单只发布运行所需文件，测试脚本不会进 tarball：

```
index.js  client.js  cordis.patch.yml  icon.svg  locale/*.json  README.md  LICENSE
```

安装方只需 `dsh plugin add @kuixiu/dsh-pet`，无需手写 `cordis.patch.yml` 的 loader 行 ——
bundle 自带的 patch 会插入。

**因为本包是纯手写 JavaScript、没有构建步骤**，它也可以直接从 Git 安装：

```sh
dsh plugin add github:kuixiu/dsh-pet
```

（有构建步骤的插件不能这样装 —— 那需要 `prepare` 脚本和可用的构建工具链。本包发布什么就能跑什么。）

## 本地开发 / Development

```sh
git clone git@github.com:kuixiu/dsh-pet.git
cd dsh-pet
node verify-all.mjs      # 九套校验，无需装任何依赖（零依赖）
```

把插件挂进本机 profile 调试：

```sh
dsh plugin --profile desktop add "$PWD"   # 或在 Harness 里 plugin_manager install_bundle
```

**没有构建步骤**：`client.js` 就是浏览器实际执行的 factory 格式（手写），
所以「发布什么就能跑什么」，`git` 安装和目录安装都不需要编译。

### 提交前

`npm run verify`（= `node verify-all.mjs`）应当全绿；`npm publish` 会自动跑（`prepublishOnly`）。
改代码时优先看这几条不变量：

- 三处标识必须一致：`package.json` 的 `name`、`cordis.patch.yml` 的 loader 行、`client.js` 的模块 id；
- 不 `require` 任何 Harness Client 包（只能用 React seed），样式只用 `--dsw-alias-*` token；
- 时间相关的判断按**北京时间**，台词相关按**本地时间**（两回事，别混）。

## 怎么读到会话状态（关键机制）

右下角常驻必须用 **root 作用域** 的 `shell.overlay`，而 `useSessionStatus` / `useSessions`
在 slot 检查里只列在 session 作用域上。但 `@deepseek-ai/dsh-client-ui-session` 是通过
**`ctx.slots.provideRoot`** 发布它们的：

```js
ctx.slots.provideRoot({
  hooks: { sessions: ctx.sessions.list, sessionStatus: service.sessionStatus },
  keyedHooks: { sessionRetainInfo: (key) => ctx.sessions.retainInfo(key) },
});
```

而 `dsh-client-resources` 的文档把这条契约写得很明确：通过 `provideRoot` 贡献的根键钩子，
**每个 slot 组件不论作用域都能收到**（"every slot component receives it whatever its scope"）。
从 `dsh-client-ui-layout` 的 `AppFrame` 也能看到同一事实：它把 hook 透传给 root 作用域的
`sidebar.workspaces`（`ui-workspace` 在那里就用 `useSessionStatus((s) => s)` 画会话状态点）。

所以本插件直接把这两个 hook 当 props 用（root 弹层也会收到）：

```
useSessions(s => s)      -> { ids, byId: { [id]: { running, retainedBy: { mainView } } } }
useSessionStatus(s => s) -> Map<sessionId, { running?, pendingInteraction?, completionUnread? }>
```

判定逻辑（`deriveActivity`）：

| 条件 | 状态 | 小猫 |
|---|---|---|
| `pendingInteraction` 存在 | 等待你操作 | 担心表情 |
| `running`（Map 或目录行） | 正在工作 | 专注表情 + 气泡闪烁 |
| `completionUnread` | 本轮完成 | 开心 + 冒爱心，4 秒后回到空闲 |
| 其余 | 空闲 | 交给养成数值决定表情 |

「活跃会话」取 `retainedBy.mainView > 0` 的那一个（与宿主 `DocumentTitle` 的取法一致），
所以后台别的会话在跑不会误导宠物。

**为什么不做报错心情**：root 根键只提供 `running` / `pendingInteraction` / `completionUnread`
三个字段，**没有**错误字段；错误文本在 `session.promptError` / `lastAgentError` 上，属于
session 作用域的 `useSession`。所以本项目不猜、不编造错误状态。

**降级**：hook 缺失、抛错、目录为空、status Map 里没有该会话，全部回退到「空闲 / 暂无会话」，
绝不让 slot entry 崩溃（组件抛错会直接让整个 entry 空白）。

## 已修的一个真实缺陷（持久化修复）

早期版本用 `Object.assign(emptyPet(), JSON.parse(raw))` 合并存档，这会让存档里
**显式为 `null` / `undefined` 的字段覆盖掉默认值**，于是界面上出现：

```
undefined · 肚子饿了，喂食 · 摸头 · 玩耍
undefined · undefined · undefined
```

现在改为 `sanitizePet`：逐字段挑取 + 类型校验（名字必须是非空字符串、数值必须有限并夹在
0–100、计数为非负整数、布尔必须是真布尔、`updatedAt` 不能在未来），非对象 / 坏 JSON /
数组 / 字符串存档一律回落默认值。渲染层再加一道 `displayName` / `bond` 兜底，
所以字面量 `undefined` **不可能**再出现在界面上。旧存档会被自动修好，无需手动清理。

紧接着又修了第二个同源缺陷：面板出现

```
饱食度 NaN   心情 NaN   精力 NaN
```

根因在衰减函数里 —— 当时是

```js
const minutes = Math.min(48*60, Math.max(0, (nowMs - pet.updatedAt) / 60000));
if (minutes < 1) return pet;          // NaN < 1 是 false，所以这里不返回
satiety: clamp(pet.satiety - minutes * 0.5)   // clamp(NaN) 仍然是 NaN
```

只要存档里 `updatedAt` 不是有限数（`NaN` / `Infinity` / `null`），`minutes` 就是 `NaN`，
`< 1` 判不出来，`clamp(NaN)` 依旧 `NaN` —— 三个数值就被写成 `NaN` 存进 localStorage，
刷新后显示成 `NaN`（JSON 会把 `NaN` 写成 `null`，再读回来就是 `null`）。
现在 `decayed` 先把每个输入夹成有限数（`finiteOr` / `decayed` 自带 `updatedAt` 上限），
`mutate` 合并后再走一遍 `sanitizePet`，所以任何路径都产不出 `NaN`。

## 拖动：为什么之前隐藏后动不了

`useDrag` 原来把 document 监听器装在 `useEffect(..., [onDrop])` 里，监听器的存活依赖
effect 的依赖身份；另外 🐾 那个「显示宠物」按钮**根本没有绑拖动**，所以隐藏后只剩一个不能拖的
按钮。现在：

- 监听器在 **pointerdown 时安装、pointerup / pointercancel / window blur 时移除**，
  不再依赖 effect 存活；
- `onDrop` 放进 ref，回调身份变化也不会让拖动失效；
- 加了 `setPointerCapture`，指针移出元素/窗口也能拿到事件流；
- 🐾 按钮同样绑 `onPointerDown`，隐藏状态也能拖；
- 位置夹取抽成纯函数 `dragClamp`，视口比组件还小时也不会算出负坐标。

## 宠物名字（默认 `小橘`）

显示名默认是 **`小橘`**（`DEFAULT_PET_NAME`），面板顶部可以随时改：输入框 + `✓` 保存 +
`↺` 恢复默认。Enter 保存、Escape 撤销，只按提交才落盘，所以改一半不会写进存储。

名字会被清洗再存：去首尾空白、换行/制表符压成空格、截到 24 字符；**清洗后为空则回落默认名**，
所以标签永远不会空白。想写成 `@kuixiu` 或 `@kuixiu 的小橘` 都可以 —— 纯显示名，随便填。

### 名字的三种含义（别混）

| 名字 | 值 | 说明 |
|---|---|---|
| **显示名** | `小橘`（可改） | 纯界面文字，随便写成 `@kuixiu` 也行 |
| **包名**（`package.json` 的 `name`） | `@kuixiu/dsh-pet` | npm 发布名 + 三处标识之一，**必须一致** |
| **slot entry id** | `pet.bottom-right` | 槽位标识，不给人看，不用改 |

npm 的 `@scope` 语义是**组织/发布域**，不是个人用户名 —— 首次发布 `@kuixiu/dsh-pet` 时
npm 会把这个 scope 建为你的用户 scope。

## 偶尔冒一句台词（情绪价值）

小猫会时不时冒一句梗或励志的话，气泡挂在小猫头顶，8 秒后自己消失。

**不是随机乱冒，看场景说话**（`quoteBand`）：

| 时机 | 说的话 | 例子 |
|---|---|---|
| 一轮刚结束 | 收尾/夸奖 | 「搞定了，起来伸个懒腰。」「看吧，你本来就会。」 |
| agent 在等你操作 | 安抚 | 「这段有点难，我还在。」「深呼吸，然后读栈。」 |
| 深夜（本地 23:00–05:00） | 劝休息 | 「夜深了，bug 明天还在。」「存盘，提交，睡觉。」 |
| 其余空闲 | 梗/励志 | 「你不是落后，你是在重构。」「删代码也是进度。」 |

**不烦人的四条规则**：

1. **正在干活时绝不出声**（`agent.busy` 时直接跳过），不打断真实工作；
2. **频率由你调**（见下表），在最少间隔与轮询周期上都生效；
3. **一轮结束的那句立刻说**，之后空闲计时器重新排；
4. **优先级**：花费气泡 / 状态气泡 > 台词，所以「上一轮花了多少钱」永远不会被台词顶掉。

### 频率可调（面板「台词频率」）

| 选项 | 最小间隔 | 轮询周期 | 体感 |
|---|---|---|---|
| 关 | — | — | 完全不说（并清除当前气泡） |
| 少 | 8 分钟 | 60 秒 | 偶尔 |
| **中（默认）** | 90 秒 | 30 秒 | 平均 1–2 分钟一句 |
| 多 | 25 秒 | 12 秒 | 话痨 |

设置存 `localStorage`，刷新后保持。**旧的布尔开关已升级**：如果你之前关过
`quotesEnabled`，会被识别为「关」而不是悄悄重置成默认。

台词库共 **28 句**（4 组，中英各一份，写在 `client.js` 的 `QUOTES` 里，不放进语言字典）。

> 说明：`stuck` 组**不是**由宠物自己的心情值触发的 —— 宠物「肚子饿」是个玩具数值，
> 拿它决定对你说什么话是荒谬的。这组只在 **agent 等你操作** 时使用；
> 它们的文案偏安抚，正合那个时刻。`quoteBand` 接受 `hour` 参数，
> 所以「深夜」按你的**本地时间**判断，而不是北京时间。

## 每轮对话结束后报花费

用的是**宿主已经算好的精确用量**，不是自己数 token。

客户端根键里能拿到 `useSessions`，而会话目录行上的
`projectionValues.tokenUsage` 就是 `@deepseek-ai/dsh-token-meter` 注册的投影，值是四个**计费桶**的累计：

```js
tokenUsage: { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
```

投影是全会话累计的，而它**在每一轮里的每一次模型调用后都会增长**。所以：

- **每一笔增量都入账一次**（分别累加到 `peak` / `offpeak`），这才让「本次会话花费」正确；
- **但"一轮花了多少"不是某一次增量** —— 而是 `当前总额 − 轮次起点`。

轮次起点在 **agent 开始工作时**钉住（`markTurnStart`），合计值只在**这一轮真正结束**（`agent.busy`
由 true 变 false）时显示一次。这正是修正前的缺陷：原来每次投影增长就报一次金额，
所以看到的是**每次调用**的钱，而不是一轮的合计。

| 显示 | 含义 |
|---|---|
| 本次会话花费 | 本页观察到的增量累计（高峰 + 低谷），存 `localStorage` |
| 本轮合计 / 本轮进行中 | 本轮所有调用的合计；进行中时实时累加，结束时气泡浮出一次 |
| 高峰 / 低谷 | 分别累计，低谷按半价（省 50%） |
| 累计 tokens | 投影的四个桶之和 |

**一条设计取舍（诚实说明）**：本页打开之前就已经存在的用量**永远不计费**。
因为投影是整个持久日志的累计值，如果首次读数就计费，那么切换会话或刷新页面就会
把该会话的**全部历史**重新收一遍钱 —— 少报一次读数是有界的、可接受的损失，
重复计费不是。所以：**页面加载时正在进行的那一轮，会漏掉它在加载前已产生的花费。**

价目表（`RATES`，每 100 万 tokens，人民币，核对日期 `2026-10-06`）：

| 模型 | 缓存命中输入 | 未缓存输入 | 输出 |
|---|---|---|---|
| `deepseek-flash` | ¥0.02 | ¥1 | ¥4 |
| `deepseek-v4-pro` | ¥0.15 | ¥4.5 | ¥13.5 |

模型名按前缀匹配（`DeepSeek-V4-Pro-0813` → `deepseek-v4-pro`）；
**匹配不到价目的模型会显示「无价目」而不是编一个数**。

## 面板精简（第二轮反馈）

原来的价格区块是一串键值对，太啰嗦。现在压成**一条标题行 + 一个大倒计时 + 一行时间 + 两行脚注**：

```
● 低谷期                                    至 2026-10-08 09:00
38:04:32
时间      18:55 北京 · 18:55 本地 · 10:55 UTC
今天为法定节假日，全天低谷期。
高峰：北京时间周一至周五 9:00-12:00、14:00-18:00（不含节假日），其余时段半价（省 50%）。
☐ 强制按低谷期（今天放假）
```

删掉的冗余：`当前时段` 标签（标题行本身就是时段）、`下次切换` 标签（时间已并入标题行）、
`原因` 标签、`你的本地时间` / `北京时间（UTC+8）` / `UTC 时间` 三个独立行（合并成一行）、
`规则核对日期`（移回代码里的 `SCHEDULE.verified`，不再占用界面）。

价格区块的文本节点从 **约 50 个降到 8 个**（这条数字由 `verify-render.mjs` 每次运行打印）。

## 文件 / Files

| 文件 | 作用 |
|---|---|
| `package.json` | 包清单：npm 发布名 `@kuixiu/dsh-pet`、`dsh.bundle.patch`、`dsh.client`、`icon`、`meta`、`files` 白名单、`prepublishOnly` 校验 |
| `LICENSE` | MIT |
| `cordis.patch.yml` | 一行 loader insert：`id: pet` / `name: '@kuixiu/dsh-pet'` |
| `index.js` | Host 半边：空实现（本插件是纯浏览器功能） |
| `client.js` | 浏览器半边：`window.__ModuleLoader__.load({ id, factory })`，含时段计算、宠物模型、SVG、样式与 `shell.overlay` 注册 |
| `icon.svg` | Plugin Manager 卡片图标 |
| `locale/{en,zh}.json` | 插件卡片的标题与描述 |
| `quote` 台词库 | 内联在 `client.js` 的 `QUOTES`（浏览器半边无法 import，所以只能是数据） |
| `verify-*.mjs` | 自包含校验脚本；另加 `quotes.mjs`（台词库校验），`node verify-all.mjs` 一次跑完八套 |

## 校验 / Verification

```sh
node verify-all.mjs
```

- `verify-schedule.mjs` — 用 `new Function` 解析 client 模块（等价于页面加载时的语法校验），
  再把源码里的时段计算段抽出来**直接执行**，对 40+ 个断言做检验：两个高峰窗口的半开边界、
  0=周日 的周末判定、2026 全部 19 个工作日节假日、调休上班的周末（9/20、10/10）、
  跨周末与跨国庆的下一次切换、2200+ 个采样切换点都能正确翻转相位。
- `verify-agent-status.mjs` — 把 `safeHook` / `activeSessionOf` / `hasActiveSession` /
  `deriveActivity` / `statusMood` 从源码抽出来直接跑：活跃会话选取、`running` /
  `pendingInteraction` / `completionUnread` 的优先级、`sessionId` 与 `id` 两种键、
  后台其他会话在跑时保持空闲、hook 缺失或抛错不崩、`statusMood` 的合成优先级。
- `verify-persistence.mjs` — 用 stub `localStorage` 直接跑 `emptyPet` / `sanitizePet` /
  `loadPet` / `savePet` / `decayed` / `moodLevel`：先复现上面那个 `undefined` 缺陷，
  再断言 13 种畸形存档（`undefined`、`null`、`{}`、部分字段、显式 null、类型全错、空名字、
  越界数值、负计数、`NaN`/`Infinity` 时间戳、字符串、数组）**全部**被修成完整可渲染记录，
  合法值（自定义名字、0 / 100 边界、计数、开关、时间戳）原样保留，读写往返不丢字段；
  `decayed` 在 9 种畸形输入下（含 `NaN`/`Infinity`/`null`/缺失 `updatedAt`）都只产出有限数，
  `mutate` 的完整合并链路对损坏记录和 `NaN` patch 也都收敛；显示名部分覆盖默认值 `@kuixiu`、
  自定义名保留、emoji、去空白、换行压平、24 字符截断、空/非字符串回落默认、读写往返；
  另外覆盖 `dragClamp` / `dragMoved` 的边界（越界夹取、视口小于组件、阈值判定）。
- `verify-cost.mjs` — 抽源码里的真实价目与账本逻辑，对着官方价目手算校验：
  四个桶各自 1M tokens 的金额、四桶合计、一个真实轮次的金额、低谷恰好是高峰的一半、
  未知模型报「无价目」且不入账、桶增量（含变小=新一代）、账本在切换会话 / 重复读数 /
  刷新场景下不重复计费，以及**一轮 = 多次调用的合计**这个核心契约：
  用三次不同大小的调用模拟一轮，断言报出的是三者之和、且**不等于任何单次调用**、
  大于每一次调用；另外覆盖轮次起点锚定、切换会话与切回时的基线重锚（不得重复计费）、
  刷新不重放历史、金额格式（0 / 亚分 / 分 / 元 / 千分位 / USD）。
  写这套测试时正是它抓出了一个真 bug：`scale` 读成了 `rates.per`（模型卡上没有这个字段），
  导致**所有金额都是 NaN** —— 修成 `RATES.per` 后 55 项全绿。
- `quotes.mjs` — 抽源码里的台词库与两个纯选择函数，检查它们**好不好用**而不是只是能跑：
  四组每组至少 4 句、28 个 id 全局唯一、中英双语都不缺且不为空、单行长度不超过气泡宽度、
  中英不相同；`quoteBand` 在 11 种「活动 × 小时」组合下选对组（含 done 优先于深夜、
  waiting 优先于深夜、05:00 不再是深夜）；`pickQuoteIndex` 对 `undefined`/`NaN`/负数/超界
  等恶意取值都落在范围内、上一句不会立刻重复（200 次抽样零重复）；间隔与显示时长的合理性。
- `verify-render.mjs` — 用 stub `React.createElement` **真渲染**整个 widget（含展开状态），
  遍历真实元素树：断言价格区块保留了全部必要信息（时段、倒计时、三时区、节假日原因、
  规则、手动开关）、不再渲染删掉的标签、`t()` 请求的 26 个 key 零缺失、
  三个数值行与六个按钮仍在，并打印价格区块的文本节点数作为「啰嗦程度」的客观指标。
- `verify-locale.mjs` — 中英字典键集合一致、`t()` 未使用模板字符串、所有字面 key 都存在、
  `pricing.ruleShort` / `pricing.clockValue` / `pricing.until` 占位符两边一致。
- `verify-hooks.mjs` — PetWidget 的 23 个 hook 全部在首个提前 `return` 之前、
  只用 React seed 导出或本模块自定义 hook、`useDrag` 的 3 个 document 监听器成对增删、
  定时器成对清理。

## 已知限制 / Known limitations

- **报错心情未实现。** root 根键不含错误字段（见上文机制说明），要读 `promptError`
  必须用 session 作用域的 `useSession`，那会把宠物业搬进会话内 slot，就不再常驻右下角了。
- **气泡显示的是「状态」而不是「正在调用哪个工具」。** 工具名在 session 作用域的事件流里，
  同样拿不到。所以气泡文案是「正在工作…」而不是具体工具名。
- **节假日表会过期。** 规则 5 周内改过 3 次。表过期时用面板里的手动勾选兜底，
  或更新 `SCHEDULE.verified` + `HOLIDAYS_2026`。勾选只影响显示，不写回任何远端。
  当前时间落在国庆假期窗口内，所以现在正确显示为**低谷期**；10 月 8 日（周四）起
  北京时间 09:00–12:00 / 14:00–18:00 会重新显示为高峰期。
- **宠物数值是本地装饰。** 存 `localStorage`，不跨设备同步，也不影响任何模型计费。
- **视觉未做浏览器截图验证。** 本会话没有可用的浏览器控制，也没有对页面注入脚本的能力，
  所以「右下角长什么样」只能由你刷新页面确认；已验证的是 bundle 已加载并成功注册 slot entry
  （`shell.overlay` 的 occupant `pet.bottom-right` 为 active）、语法、清单与上述逻辑。
- **规则边界未定义。** 04:00 / 10:00 UTC 那一分钟按左闭右开归入高峰内的最后一分钟，
  官方未明说，实际计费请以平台用量页「峰谷时间说明」为准。
