# Harbor Handoff — 3D 水下可视化实现规格

> 用途：交给 GPT 逐步实现。**我（Claude）负责构思，GPT 负责写代码。**
> 范围：只做演示用的 3D 水下视图；值班员仪表盘（dashboard）不归我们。
> 优先级：P0 必须有 → P1 应该有 → P2 加分项。

---

## 怎么用这份文档

1. 先把下面的「第 0 步：给 GPT 的总提示」原样发给 GPT，再把整份文档贴给它作为背景。
2. 然后**一次只发一步**（第 1 步、第 2 步……），每一步的提示词都在代码块里，直接复制即可。
3. 每做完一步：
   - 运行 `npm run dev`，对照这一步的「验收标准」检查画面；
   - 报错就把完整的报错信息贴回给 GPT；
   - 通过后用 git 提交一次（`git add -A` 再 `git commit -m "step N"`），出问题时可以退回。
4. P0（第 1–8 步）全部通过之前，不开始 P1。
5. **18:00 功能冻结。** 不管做到哪一步，冻结后立刻录备用视频、截海报图。

---

## 一、设计思路

### 1.1 这个视图要讲清楚什么

题目问的是：**在"发现了"和"处理了"之间，到底发生什么？平台自己能决定什么，什么必须由人批准？**

所以 3D 视图不是拿来炫技的，而是把这条链演出来：

```
DETECT（听到）→ LOCATE（定位）→ INSPECT（无人艇查看）→ HANDOFF（交给值班员）
```

画面上要始终让人看懂三件事：
1. **系统现在在哪一步**：顶部的阶段条。
2. **哪些动作是自动做的，哪些要人批准**：右侧的动作日志。绿色表示自动，琥珀色表示需要值班员批准。
3. **还剩多少时间**（P1）：倒计时，按入侵者到保护区的最短时间计算。

### 1.2 视觉风格："Elegant beats loud"

- **克制**：不用爆炸、闪烁、满屏警报。声波是淡淡扩散的环，扫描是半透明的光锥。
- **配色**（统一放在 `src/theme.ts` 里）：

| 用途 | 颜色 |
|---|---|
| 背景、深水 | `#06121f` |
| 浅水、雾 | `#0b2a3d` |
| 海底 | `#2b3a42` |
| 中性的线和文字 | `#9fb3c8` |
| 声波、水听器（青色） | `#4fd1c5` |
| 自动动作（绿色） | `#48bb78` |
| 需要批准（琥珀色） | `#f6ad55` |
| 保护区、紧急倒计时（红色，只用在这两处） | `#f56565` |
| 入侵者（未确认时） | `#e2e8f0`，半透明 |

- **字体**：系统无衬线字体（`Inter, system-ui, sans-serif`），不从网上加载字体。
- 文字一律用简单英文，比如 "Unknown object · 72%"、"Needs officer"。

### 1.3 演示剧本：入侵场景（P0）

时间单位是"剧情秒"。每一幕有自己的播放速度，平淡的部分快放，关键的部分正常速度。

| 幕 | 剧情时间 | 播放速度 | 画面 | 阶段 |
|---|---|---|---|---|
| 1 平静的港口 | 0–60 | 4× | 水面上渡轮来往；无人艇停在码头；海底很安静 | — |
| 2 听到 | 60–95 | 1× | 三个水听器依次"听到"，各自发出声波扩散环 | DETECT |
| 3 定位 | 95–120 | 1× | 三条方位线从水听器射出，交汇处出现一个"估计位置"标记，带不确定性圆圈，圆圈逐渐缩小；标签显示 "Unknown object · 72%" | LOCATE |
| 4 查看 | 120–300 | 3× | 无人艇**自动**出发（绿色日志）；到达后保持 50 米距离；向下打出扫描光锥；结果为 "Undetermined" | INSPECT |
| 5 交接 | 300–320 | 1×，**在 300 秒自动暂停** | 出现两条琥珀色动作："Approach to 10 m for close scan — needs officer"、"Broadcast to harbor traffic — needs officer"；横幅 "HANDOFF → Officer" | HANDOFF |
| 6 揭晓 | 320–380 | 1× | 值班员批准近距离扫描（日志里出现 "Approved by officer"）；无人艇靠近再扫一次；入侵者从半透明变成实体，标签 "Research AUV · Harbor Ocean Lab · lost 2 days"；结尾文字 "Owner notified. Port never closed." | — |

**说明**
- 结局反转直接对应题目原话："finding a lost research vehicle"。
- 第 5 幕自动暂停，主讲人可以在这里停下来讲交接，讲完按空格继续。
- 入侵者在被探测到之前**不显示**；探测到以后显示成一个模糊的半透明"幽灵"；查看清楚以后才变成实体。这一变化本身就体现了"从听到到看清"。

### 1.4 演示剧本：安静的周二（P1，两用）

| 剧情时间 | 画面 |
|---|---|
| 0–20 | 横幅 "Quiet Tuesday · Search for lost research AUV" |
| 20–150 | 无人艇按"割草机"路线（来回平行线）自动搜索；水听器听到 AUV 的信标声（声波环节奏均匀） |
| 150–200 | 定位，无人艇过去扫描，结果 "Found · AUV-07"；日志里全部是绿色的自动动作 |
| 200–220 | 结尾文字："On a quiet Tuesday, the officer approves nothing. It just works." |

两个剧本用的是**同一套代码、同一个场景，只是换了剧本文件**，这本身就是"两用"的证明。

### 1.5 坐标与单位

- 单位：**米**。原点在港口中心。
- three.js 默认 Y 轴朝上：`x` 向东，`y` 向上（水面为 0，水下为负），`z` 向南。
- 港区范围：`x, z ∈ [-1000, 1000]`。
- 水深：大约 -15 到 -40 米。**渲染时垂直方向放大 4 倍**（`VEXAG = 4`），否则海底看起来是平的。数据里一律存真实米数，只在渲染时乘以 `VEXAG`。

---

## 二、技术选型

| 项 | 选择 | 说明 |
|---|---|---|
| 构建工具 | Vite + React 18 + TypeScript | |
| 3D | three + @react-three/fiber v8 + @react-three/drei v9 | fiber v8 对应 React 18；不要用 fiber v9，它要求 React 19 |
| 状态 | zustand | 管理时钟、当前幕、播放状态 |
| 参考版本 | `react@18.3.1`、`three@0.169.0`、`@react-three/fiber@8.17.10`、`@react-three/drei@9.114.0`、`zustand@4.5.5` | 也可以用相互兼容的相近版本 |

**离线要求（现场 Wi-Fi 不可靠）**
- 所有资源都放在本地，不从任何 CDN 加载。
- **不要用** drei 的 `<Environment preset=...>`：它会从网上下载 HDR 贴图。
- **不要用** drei 的 `<Text>` 默认字体：它会从网上加载字体文件。文字标签一律用 drei 的 `<Html>`。
- 3D 模型先全部用基本几何体（胶囊体、方块、圆锥）拼出来，不依赖外部模型文件。

**性能**：在普通笔记本上要稳定 60 fps。海底网格最多 256×256 段；粒子用 instanced mesh。

---

## 三、目录结构

```
viz/
├─ index.html
├─ package.json
├─ public/
│  └─ scenarios/
│     ├─ intrusion.json      # 入侵剧本（P0）
│     └─ tuesday.json        # 安静的周二（P1）
└─ src/
   ├─ main.tsx
   ├─ App.tsx                # Canvas + HUD 布局
   ├─ theme.ts               # 颜色、VEXAG 等常量
   ├─ types.ts               # 剧本 JSON 的类型
   ├─ store.ts               # zustand：时钟、播放、当前幕
   ├─ lib/
   │  ├─ interp.ts           # 关键帧插值
   │  └─ geo.ts              # 方位角、到保护区距离等计算
   ├─ scene/
   │  ├─ Environment.tsx     # 灯光、雾、海底、水面
   │  ├─ Seabed.tsx
   │  ├─ WaterSurface.tsx
   │  ├─ SurfaceBoats.tsx
   │  ├─ DroneBoat.tsx       # 无人艇 + 扫描光锥
   │  ├─ Intruder.tsx        # 幽灵 → 实体
   │  ├─ Hydrophones.tsx     # 水听器 + 声波环
   │  ├─ BearingLines.tsx    # 方位线 + 估计位置
   │  ├─ ProtectedZones.tsx  # P1
   │  ├─ ReachRings.tsx      # P1
   │  ├─ FishCloud.tsx       # P2
   │  └─ CameraDirector.tsx
   └─ hud/
      ├─ PhaseBar.tsx
      ├─ ActionLog.tsx
      ├─ HandoffBanner.tsx
      ├─ Countdown.tsx       # P1
      ├─ Controls.tsx        # 播放控制条
      └─ EndCard.tsx
```

---

## 四、剧本 JSON 格式

整个画面都由剧本文件驱动。Software 那边的模型结果出来以后，只需要改这个文件里的几个数字（识别标签、置信度、扫描结果），代码不用动。

### 4.1 类型定义（`src/types.ts`）

```ts
export type Vec3 = [number, number, number];          // [x, y, z]，单位为米，y ≤ 0 表示水下
export interface Keyframe { t: number; pos: Vec3 }

export interface Act { id: number; name: string; start: number; end: number; rate: number; pauseAt?: number }

export interface Hydrophone { id: string; pos: Vec3 }

export type Phase = "NONE" | "DETECT" | "LOCATE" | "INSPECT" | "HANDOFF";

export type ScenarioEvent =
  | { t: number; type: "phase"; phase: Phase }
  | { t: number; type: "hear"; hydrophone: string; rhythm?: "single" | "pinger" }
  | { t: number; type: "bearings"; noiseDeg: number }                       // 根据真实位置计算方位线，加入噪声
  | { t: number; type: "estimate"; pos: Vec3; radius: number; shrinkTo: number; shrinkDur: number }
  | { t: number; type: "label"; text: string }                              // 例如 "Unknown object · 72%"
  | { t: number; type: "action"; text: string; mode: "auto" | "approval" | "approved" }
  | { t: number; type: "scan"; dur: number; result: "clear" | "suspicious" | "undetermined" | "identified" }
  | { t: number; type: "reveal"; text: string }                             // 入侵者从幽灵变成实体
  | { t: number; type: "banner"; text: string; style: "handoff" | "info" }
  | { t: number; type: "endcard"; lines: string[] };

export interface CameraShot { t: number; pos: Vec3; target: Vec3; dur: number }

export interface Zone { name: string; min: [number, number]; max: [number, number] }  // xz 平面上的矩形

export interface Scenario {
  title: string;
  duration: number;
  acts: Act[];
  vMax: number;            // 入侵者的最大速度，m/s，用于计算可达范围和倒计时
  tHuman: number;          // 值班员反应时间，秒
  hydrophones: Hydrophone[];
  zones: Zone[];
  intruder: { path: Keyframe[]; visibleFrom: number };
  droneBoat: { path: Keyframe[] };
  surfaceBoats: { id: string; path: Keyframe[] }[];
  events: ScenarioEvent[];
  camera: CameraShot[];
}
```

### 4.2 入侵剧本示例（`public/scenarios/intrusion.json`）

数值可以直接用，之后再按画面效果微调。

```json
{
  "title": "Unknown object in the harbor",
  "duration": 380,
  "vMax": 2.5,
  "tHuman": 30,
  "acts": [
    { "id": 1, "name": "Quiet harbor", "start": 0,   "end": 60,  "rate": 4 },
    { "id": 2, "name": "Detect",       "start": 60,  "end": 95,  "rate": 1 },
    { "id": 3, "name": "Locate",       "start": 95,  "end": 120, "rate": 1 },
    { "id": 4, "name": "Inspect",      "start": 120, "end": 300, "rate": 3 },
    { "id": 5, "name": "Handoff",      "start": 300, "end": 320, "rate": 1, "pauseAt": 300 },
    { "id": 6, "name": "Reveal",       "start": 320, "end": 380, "rate": 1 }
  ],
  "hydrophones": [
    { "id": "H1", "pos": [-600, -35, 400] },
    { "id": "H2", "pos": [500, -30, -500] },
    { "id": "H3", "pos": [-100, -38, -700] }
  ],
  "zones": [
    { "name": "Ferry terminal", "min": [-450, 200], "max": [-150, 400] }
  ],
  "intruder": {
    "visibleFrom": 60,
    "path": [
      { "t": 0,   "pos": [300, -14, -500] },
      { "t": 120, "pos": [150, -13, -300] },
      { "t": 300, "pos": [-50, -12, -50] },
      { "t": 380, "pos": [-70, -12, -70] }
    ]
  },
  "droneBoat": {
    "path": [
      { "t": 0,   "pos": [-800, 0, -200] },
      { "t": 125, "pos": [-800, 0, -200] },
      { "t": 280, "pos": [-90, 0, -80] },
      { "t": 300, "pos": [-90, 0, -80] },
      { "t": 330, "pos": [-60, 0, -60] },
      { "t": 380, "pos": [-60, 0, -60] }
    ]
  },
  "surfaceBoats": [
    { "id": "ferry-1", "path": [ { "t": 0, "pos": [900, 0, 300] }, { "t": 380, "pos": [-300, 0, 300] } ] },
    { "id": "ferry-2", "path": [ { "t": 0, "pos": [-300, 0, 250] }, { "t": 380, "pos": [900, 0, 250] } ] }
  ],
  "events": [
    { "t": 60,  "type": "phase", "phase": "DETECT" },
    { "t": 60,  "type": "hear", "hydrophone": "H2" },
    { "t": 72,  "type": "hear", "hydrophone": "H3" },
    { "t": 85,  "type": "hear", "hydrophone": "H1" },
    { "t": 60,  "type": "action", "text": "Sound anomaly detected — logged", "mode": "auto" },
    { "t": 95,  "type": "phase", "phase": "LOCATE" },
    { "t": 95,  "type": "bearings", "noiseDeg": 3 },
    { "t": 105, "type": "estimate", "pos": [160, -13, -315], "radius": 90, "shrinkTo": 30, "shrinkDur": 15 },
    { "t": 110, "type": "label", "text": "Unknown object · 72%" },
    { "t": 120, "type": "phase", "phase": "INSPECT" },
    { "t": 120, "type": "action", "text": "Dispatch drone boat to observe", "mode": "auto" },
    { "t": 280, "type": "action", "text": "Hold 50 m stand-off", "mode": "auto" },
    { "t": 282, "type": "scan", "dur": 15, "result": "undetermined" },
    { "t": 298, "type": "label", "text": "Scan: undetermined" },
    { "t": 300, "type": "phase", "phase": "HANDOFF" },
    { "t": 300, "type": "banner", "text": "HANDOFF → Officer", "style": "handoff" },
    { "t": 300, "type": "action", "text": "Approach to 10 m for close scan — needs officer", "mode": "approval" },
    { "t": 300, "type": "action", "text": "Broadcast to harbor traffic — needs officer", "mode": "approval" },
    { "t": 320, "type": "action", "text": "Close scan approved by officer", "mode": "approved" },
    { "t": 332, "type": "scan", "dur": 12, "result": "identified" },
    { "t": 345, "type": "reveal", "text": "Research AUV · Harbor Ocean Lab · lost 2 days" },
    { "t": 360, "type": "endcard", "lines": ["Lost research vehicle found.", "Owner notified. Port never closed."] }
  ],
  "camera": [
    { "t": 0,   "pos": [0, 700, 1300],    "target": [0, 0, 0],        "dur": 0 },
    { "t": 60,  "pos": [300, 150, 400],   "target": [0, -100, -300],  "dur": 4 },
    { "t": 95,  "pos": [200, 500, 400],   "target": [100, -60, -250], "dur": 3 },
    { "t": 120, "pos": [-500, 250, 300],  "target": [-200, 0, -150],  "dur": 4 },
    { "t": 280, "pos": [-160, 40, 60],    "target": [-50, -48, -50],  "dur": 3 },
    { "t": 300, "pos": [-250, 200, 200],  "target": [-100, -40, 0],   "dur": 3 },
    { "t": 332, "pos": [-100, -20, 0],    "target": [-60, -48, -60],  "dur": 3 },
    { "t": 360, "pos": [0, 600, 1100],    "target": [0, 0, 0],        "dur": 5 }
  ]
}
```

**注意**
- 相机里的 `y` 是**渲染后的坐标**（已经乘过 `VEXAG`）；实体位置里的 `y` 是真实米数。GPT 实现时要遵守这一点。
- 剧本里的人名、机构名都是虚构的（"Harbor Ocean Lab"），不要换成真实的机构。

### 4.3 和 Software 的对接（只需要几个数字）

演示前问 Software 要真实模型的这几个结果，直接填进 JSON：

| JSON 位置 | 含义 |
|---|---|
| `label` 事件的 `text` | 模型给出的类别和置信度，比如 "Unknown object · 72%" |
| 第一个 `scan` 的 `result` | 第一次扫描的结果 |
| 第一个 `hear` 的 `t` | 什么时候听到（可选） |

拿不到也没关系，示例里的数值本身就能演示。

---

## 五、逐步实现提示词

### 第 0 步：给 GPT 的总提示（只发一次）

```
You are helping me build a 3D underwater visualization for a hackathon demo, step by step.
I will paste a spec. Follow it exactly. Rules:
- Stack: Vite + React 18 + TypeScript + three + @react-three/fiber v8 + @react-three/drei v9 + zustand.
- Must run fully offline: no CDN assets, no drei <Environment preset>, no drei <Text> (use drei <Html> for labels).
- Only do the step I ask for. Do not add features from later steps.
- Always output COMPLETE files (not diffs), with the file path above each file.
- Keep code simple and readable. No unnecessary abstractions.
- Units are meters. Entity y is real meters (negative underwater); multiply by VEXAG (=4) only when rendering. Camera positions in the scenario are already in render space.
- At the end of each step, tell me exactly how to run it and what I should see.
Here is the spec:
[paste Visualization_Spec.md here]
```

---

### P0：核心演示

#### 第 1 步：项目骨架和 HUD 布局

```
Step 1: Scaffold the project in a folder named viz/.
- Vite React TS app. Install three, @react-three/fiber@8, @react-three/drei@9, zustand.
- src/theme.ts with all colors from spec section 1.2 and VEXAG = 4.
- App.tsx: full-screen <Canvas> (background #06121f) with a placeholder box and OrbitControls.
- HUD layer as absolutely positioned HTML on top of the canvas:
  top-center: phase bar placeholder; right: action log placeholder panel (width 360px);
  bottom: controls bar placeholder; all text in Inter/system-ui, color #9fb3c8.
- Target 1920x1080, but no horizontal scroll at smaller sizes.
Acceptance: `npm run dev` shows a dark scene with a rotatable box and the three empty HUD areas.
```

**验收**：深色背景，能用鼠标旋转一个方块；顶部、右侧、底部各有一个空的 HUD 区域。

#### 第 2 步：剧本加载、时钟和播放控制

```
Step 2: Scenario loading, clock and playback.
- src/types.ts exactly as in spec 4.1. Put the JSON from spec 4.2 in public/scenarios/intrusion.json.
- src/store.ts (zustand): scenario, t (story seconds), playing, speedMultiplier (default 1), currentAct (derived from t).
  Advance t each frame by delta * act.rate * speedMultiplier (use useFrame in a small <Clock/> component inside Canvas).
  If an act has pauseAt and t crosses it, set playing=false and clamp t to pauseAt (only once per pass).
  Stop at scenario.duration.
- Load scenario by URL param ?scenario=intrusion (default intrusion).
- src/lib/interp.ts: positionAt(path: Keyframe[], t) with linear interpolation, clamped at ends; headingAt(path, t) returning yaw from movement direction.
- hud/Controls.tsx: play/pause button, restart, act buttons 1..N, speed 0.5x/1x/2x, current t as mm:ss and act name.
- Keyboard: Space play/pause, R restart, 1-9 jump to act start, ArrowLeft/ArrowRight seek ±5s, H toggle all HUD, F toggle free camera (store flag only for now).
Acceptance: controls work; time advances 4x faster in act 1; it auto-pauses at t=300.
```

**验收**：按空格开始，时间在第 1 幕走得快；按数字键能跳到对应的幕；到 300 秒时自动暂停。

#### 第 3 步：海底、水面、雾和灯光

```
Step 3: Environment.
- scene/Seabed.tsx: PlaneGeometry 2400x2400, 256x256 segments, rotated flat. Height = real depth in meters * VEXAG.
  Procedural depth: base -25 m, smooth noise ±6 m (write a tiny value-noise function, no external lib),
  plus a navigation channel along z (x near 200) about 12 m deeper. Export a function seabedDepthAt(x,z) in real meters.
  Material: MeshStandardMaterial color #2b3a42, flatShading false, slight roughness.
- scene/WaterSurface.tsx: plane at y=0, color #0b2a3d, transparent opacity 0.35, depthWrite false, double sided.
  Gentle vertex wave animation (amplitude small) in useFrame.
- Lights: dim ambient + one directional light from above. Fog color #06121f, near 600, far 3000.
- Subtle grid lines on the seabed are optional (only if cheap).
Acceptance: a calm, dark, readable seabed under a translucent surface. Smooth 60 fps.
```

**验收**：能看到起伏的海底和半透明的水面，画面安静、不花哨，帧率稳定。

#### 第 4 步：船只、无人艇、入侵者

```
Step 4: Entities.
- scene/SurfaceBoats.tsx: each surface boat = small elongated box (40x8x12) on the surface, color #9fb3c8, oriented by headingAt.
- scene/DroneBoat.tsx: small boat (14x4x6) colored #4fd1c5 with a short mast; follows droneBoat.path.
  Draw a faint dashed line from its current position to its next keyframe while moving.
- scene/Intruder.tsx: capsule (length 6 m, radius 0.8 m, scaled visually x3 so it's visible) following intruder.path.
  Hidden before intruder.visibleFrom.
  Two visual states: "ghost" (default after visible: color #e2e8f0, opacity 0.25, slightly blurred look via larger soft halo sphere)
  and "solid" (after a 'reveal' event: opaque, color #e2e8f0, with a small drei <Html> tag showing the reveal text).
  Short trail behind it (drei <Trail> or a simple line of the last positions).
- Remember: entity y * VEXAG when rendering.
Acceptance: boats move along paths; intruder appears at t=60 as a ghost; jumping to act 6 shows it solid with the tag.
```

**验收**：渡轮在水面移动；60 秒时入侵者以半透明幽灵的样子出现；跳到第 6 幕时变成实体，并带标签。

#### 第 5 步：水听器、声波、方位线、估计位置

```
Step 5: Acoustic layer.
- scene/Hydrophones.tsx: each hydrophone = small cylinder on the seabed (use seabedDepthAt) colored #4fd1c5 with a soft glow sphere.
  On each 'hear' event: spawn an expanding translucent sphere shell (wireframe or fresnel-like, opacity fading from 0.35 to 0)
  from that hydrophone, radius growing to ~600 m over 4 seconds of story time. 'pinger' rhythm = repeat every 3 s (used later).
  Effects must be driven by story time t (so seeking backward/forward works), not by wall-clock timers.
- scene/BearingLines.tsx: after the 'bearings' event, for each hydrophone draw a line from it toward the intruder's true
  position at that time, with angular noise of ±noiseDeg (deterministic, seeded by hydrophone id), length 1500 m, color #4fd1c5, opacity 0.6, fading in over 2 s.
- After the 'estimate' event: a marker at estimate.pos (small ring + vertical line to the surface) with an uncertainty circle
  whose radius shrinks from radius to shrinkTo over shrinkDur seconds.
- After a 'label' event: drei <Html> label near the estimate (or near the intruder if revealed) showing the latest label text.
Acceptance: at 60/72/85 s sound rings expand from H2/H3/H1; at 95 s three lines nearly meet; the uncertainty circle shrinks; label "Unknown object · 72%" appears.
```

**验收**：三个水听器依次发出扩散的声波；三条方位线几乎交汇在一点；不确定性圆圈逐渐缩小；出现识别标签。来回拖动时间，效果也正确。

#### 第 6 步：无人艇扫描

```
Step 6: Drone boat scan.
- In DroneBoat.tsx: during a 'scan' event window [t, t+dur], render a downward translucent cone (#4fd1c5, opacity 0.18)
  from the drone boat to the seabed below the intruder, plus a thin horizontal sweep ring moving down and up inside the cone.
- When a scan ends, show a small drei <Html> result chip above the drone boat:
  undetermined -> amber "Undetermined", suspicious -> amber "Suspicious", clear -> green "Clear", identified -> green "Identified".
Acceptance: scan cone appears at 282 s and 332 s; result chips show correct text and color.
```

**验收**：282 秒和 332 秒时出现向下的扫描光锥；扫描结束后显示正确的结果和颜色。

#### 第 7 步：阶段条、动作日志、交接横幅、结尾卡片

```
Step 7: HUD.
- hud/PhaseBar.tsx: four steps DETECT → LOCATE → INSPECT → HANDOFF. Current phase highlighted (bright text + underline),
  past phases dimmed with a check mark, future phases faint.
- hud/ActionLog.tsx: list of 'action' events up to current t, newest at top, each with time (mm:ss) and a chip:
  auto -> green "AUTO", approval -> amber "NEEDS OFFICER", approved -> green outline "APPROVED".
  At the top of the panel a one-line legend: "Green = system decides · Amber = officer decides".
- hud/HandoffBanner.tsx: on a 'banner' event with style handoff, a calm amber banner at top-center under the phase bar:
  "HANDOFF → Officer". Fade in, no blinking.
- hud/EndCard.tsx: on 'endcard', a centered translucent card with the lines, large text.
- All HUD derives from store t, so seeking works.
Acceptance: at each phase change the bar updates; the log fills with green and amber items; banner at 300 s; end card at 360 s.
```

**验收**：阶段条随剧情推进；动作日志里绿色、琥珀色条目依次出现；300 秒出现交接横幅；360 秒出现结尾卡片。

#### 第 8 步：镜头调度

```
Step 8: Camera director.
- scene/CameraDirector.tsx: find the last camera shot with shot.t <= t. Smoothly move the camera position and look-at target
  from the previous shot to this one over shot.dur seconds of story time (ease in-out). Positions here are already render-space.
- When free camera mode (F key) is on, disable the director and enable OrbitControls; when off, director takes over again.
- Make sure seeking backward produces the correct camera.
Acceptance: playing from start gives a smooth cinematic sequence matching the acts; F toggles free camera.
```

**验收**：从头播放，镜头随剧情平滑切换；按 F 可以自由转动视角，再按一次回到自动运镜。

**✅ P0 检查点**：从头到尾完整播放一遍，确认第 5 幕会自动暂停，按空格能继续。这时就能用于演示了。**先 git 提交一次。**

---

### P1：增强

#### 第 9 步：保护区和可达范围

```
Step 9: Protected zones and reach.
- scene/ProtectedZones.tsx: each zone as a red (#f56565) translucent "curtain": vertical walls from the surface down to the seabed
  along the rectangle edges (opacity 0.12), plus a thin red outline on the surface and a <Html> name label.
- scene/ReachRings.tsx: after the LOCATE phase starts, around the intruder's current position draw three flat rings at the intruder's depth
  for 60 s, 120 s, 180 s ahead: radius = vMax * seconds. Color #9fb3c8, low opacity, labels "1 min", "2 min", "3 min".
  If a ring intersects a zone rectangle, that ring turns red.
- src/lib/geo.ts: distanceToZone(pos, zone) in the xz plane.
Acceptance: zone curtain visible; rings follow the intruder; the ring that touches the ferry terminal turns red.
```

**验收**：能看到红色半透明的保护区"帘子"；可达范围圈跟着入侵者移动；碰到渡轮码头的那一圈会变红。

#### 第 10 步：决策倒计时

```
Step 10: Countdown.
- hud/Countdown.tsx: visible from LOCATE phase until the endcard. Value = min over zones of distanceToZone(intruderPos)/vMax - tHuman, in seconds, never below 0.
  Show "Officer must decide in mm:ss" top-right above the action log. Color #9fb3c8; turns #f56565 below 60 s.
  When the 'Close scan approved by officer' action has happened, freeze the value and show "Decision made".
Acceptance: countdown appears at 95 s, decreases as the intruder approaches, freezes at 320 s.
```

**验收**：95 秒时出现倒计时，入侵者越靠近数字越小；320 秒值班员批准后停住，显示 "Decision made"。

> 倒计时是我们最初的核心想法：输出的不是"可疑"，而是"还剩多少时间"。

#### 第 11 步：潜入水下的运镜

```
Step 11: Above/below water transition.
- When the camera y < 0: change fog to a closer, bluer underwater fog (#0b2a3d, near 50, far 900) and add a very subtle full-screen
  blue tint (HTML overlay, opacity ~0.15). Above water: normal fog, no tint. Blend over ~0.5 s so the crossing feels smooth.
- Add one camera shot in intrusion.json so that around t=280 the camera dives from above the surface to below it.
Acceptance: the camera visibly "dives" under the surface with a smooth change of atmosphere.
```

**验收**：镜头从水面上方穿到水下时，画面氛围平滑地变成水下效果。

#### 第 12 步：安静的周二剧本

```
Step 12: Quiet Tuesday scenario (dual-use).
- Create public/scenarios/tuesday.json following spec 1.4: same hydrophones and zones; the drone boat runs a lawnmower search
  pattern (parallel lines 150 m apart) over an area; a lost AUV sits near the seabed; hydrophones emit 'pinger' rhythm events;
  all actions are mode auto; scan result identified; reveal "Lost research AUV · found"; endcard
  "On a quiet Tuesday, the officer approves nothing. It just works."
- Add a scenario switcher in the controls bar (Intrusion / Quiet Tuesday) and keyboard T to toggle. Switching resets t to 0.
Acceptance: Tuesday scenario plays end to end with only green actions.
```

**验收**：周二剧本能完整播放，日志里全部是绿色的自动动作。

#### 第 13 步：高清截图（给海报用）

```
Step 13: Poster screenshot.
- Canvas with gl={{ preserveDrawingBuffer: true }}.
- Key P: render one frame at 2x device pixel ratio and download it as PNG named harbor-handoff-<t>.png. HUD is HTML, so also offer
  key Shift+P which hides HUD and captures only the 3D scene.
Acceptance: pressing P downloads a sharp PNG.
```

**验收**：按 P 能下载一张清晰的 PNG。

**✅ P1 检查点**：两个剧本都能完整播放，截好海报用的图。**git 提交。**

---

### P2：加分项

#### 第 14 步：鱼群产卵聚集区（两用）

```
Step 14: Fish aggregation cloud.
- scene/FishCloud.tsx: instanced small spheres (800 points) in an ellipsoid at [500, -25, 300], radius 120 m (xz) and 8 m (y),
  each slowly circling with small random offsets (deterministic seed). Color soft teal, slight emissive.
- <Html> label "Spawning aggregation · protected zone". Only in the Tuesday scenario (add a flag in the scenario JSON: "fish": true).
Acceptance: a gentle, living cloud; 60 fps maintained.
```

#### 第 15 步：切换港口（回应第 2 个 twist：全球化）

```
Step 15: Port switch.
- Move seabed seed/shape parameters, hydrophones and zones into port config files: public/ports/la.json and public/ports/portb.json.
  Port B: different coastline shape (a narrow strait), deeper channel, 4 hydrophones, two zones.
- Scenario references a port id; add URL param ?port=portb and a switcher. Same engine, same code, only config changes.
- Small on-screen caption: "Same system · new port config".
Acceptance: switching port changes the seabed, sensors and zones without code changes.
```

> 讲的时候说："换一个港口，只改配置，不改代码。"Port B 只是一个示意港口，不要标成某个真实港口的名字。

#### 第 16 步：真实水深数据（可选）

```
Step 16: Real bathymetry (optional).
- Support loading a grayscale PNG heightmap (public/bathy/la.png) with min/max depth in the port config; sample it into the seabed
  geometry and seabedDepthAt. Fall back to the procedural seabed if the file is missing.
Acceptance: with a heightmap present, the seabed matches it; without it, nothing breaks.
```

> 水深数据可以从 NOAA 或 GEBCO 获取，下载方式和格式需要先核实。来不及就跳过这一步。

#### 第 17 步：轻微辉光（可选）

```
Step 17: Subtle bloom (optional).
- Add @react-three/postprocessing with a very subtle Bloom (low intensity, high threshold) so sound rings and the scan cone glow softly.
- Must keep 60 fps; add a toggle key B to turn it off.
Acceptance: slightly softer glow, no performance drop.
```

---

## 六、给 GPT 的通用调试提示

画面不对或报错时，用下面这段：

```
Here is the problem: [describe what you see vs expected / paste full error].
Only fix this problem. Do not refactor other parts. Output complete updated files.
```

常见问题：

| 现象 | 可能的原因 |
|---|---|
| 画面全黑 | 灯光太暗，或相机在海底以下；先按 F 切到自由视角看看 |
| 拖动时间后效果不对 | 效果用的是 `setTimeout` 或真实时间，必须改成用剧情时间 `t` 来计算 |
| 物体在水面上漂着，或埋在海底里 | 忘了乘 `VEXAG`，或者相机坐标被重复乘了 `VEXAG` |
| 加载很慢或断网就坏 | 用了 CDN 资源（Environment preset、Text 字体） |
| 帧率低 | 海底分段太多、粒子没有用 instancing，或者每帧都在新建几何体 |

---

## 七、时间安排建议

| 时间 | 内容 |
|---|---|
| 现在 – 14:30 | 第 1–4 步 |
| 14:30 – 16:30 | 第 5–8 步 → **P0 完成** |
| 16:30 – 18:00 | 第 9–13 步，按顺序做到哪算哪 |
| **18:00** | **功能冻结**：录完整的演示视频（两个剧本各一遍）；按 P 截海报图 |
| 18:00 以后 | 只修 bug，不加功能；P2 不做 |

**取舍原则**：任何一步卡住超过 30 分钟，就退回上一个 git 提交，跳过这一步。
