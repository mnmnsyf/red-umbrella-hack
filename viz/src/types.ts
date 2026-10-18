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
  | { t: number; type: "label"; text: string }                              // 例如 "Unusual acoustic event · score 12.2"
  | { t: number; type: "action"; text: string; mode: "auto" | "approval" | "approved" }
  | { t: number; type: "scan"; dur: number; result: "clear" | "suspicious" | "undetermined" | "identified" }
  | { t: number; type: "reveal"; text: string }                             // 入侵者从幽灵变成实体
  | { t: number; type: "banner"; text: string; style: "handoff" | "info" }
  | { t: number; type: "resolved"; incidentId: string; detector: string; title: string; outcome: string };

export interface CameraShot { t: number; pos: Vec3; target: Vec3; dur: number }

export interface Zone { name: string; min: [number, number]; max: [number, number] }  // xz 平面上的矩形

// Optional wording overrides, so a scenario can tell its own story (all fields fall back to the defaults).
export interface ScenarioText {
  summaries?: Partial<Record<Phase, string>>;  // threat-card summary per phase
}

export interface Scenario {
  title: string;
  text?: ScenarioText;
  duration: number;
  acts: Act[];
  vMax: number;            // 入侵者的最大速度，m/s，用于计算可达范围和倒计时
  tHuman: number;          // 值班员反应时间，秒
  hydrophones: Hydrophone[];
  zones: Zone[];
  fish?: { center: Vec3; radiusXZ: number; radiusY: number; count: number; label: string };
  intruder: { path: Keyframe[]; visibleFrom: number };
  droneBoat: { path: Keyframe[] };
  surfaceBoats: { id: string; path: Keyframe[] }[];
  events: ScenarioEvent[];
  camera: CameraShot[];
  // Optional slow orbit layered on the camera shots so the view never sits still:
  // swings ±deg around the shot target over `period` scenario-seconds; `lift` varies height by ±lift.
  cameraDrift?: { deg: number; period: number; lift?: number };
}
