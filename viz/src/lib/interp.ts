import type { Keyframe, Vec3 } from '../types';

export function positionAt(path: Keyframe[], t: number): Vec3 {
  if (path.length === 0) return [0, 0, 0];
  if (t <= path[0].t) return [...path[0].pos];
  if (t >= path[path.length - 1].t) return [...path[path.length - 1].pos];

  for (let i = 0; i < path.length - 1; i += 1) {
    const start = path[i];
    const end = path[i + 1];
    if (t <= end.t) {
      const fraction = (t - start.t) / (end.t - start.t);
      return start.pos.map((value, axis) =>
        value + (end.pos[axis] - value) * fraction,
      ) as Vec3;
    }
  }

  return [...path[path.length - 1].pos];
}

export function headingAt(path: Keyframe[], t: number): number {
  if (path.length < 2) return 0;

  const active = path.findIndex((frame, i) =>
    i < path.length - 1 && t < path[i + 1].t && t >= frame.t,
  );
  const segment = t < path[0].t ? 0 : active < 0 ? path.length - 2 : active;

  for (let i = segment; i >= 0; i -= 1) {
    const dx = path[i + 1].pos[0] - path[i].pos[0];
    const dz = path[i + 1].pos[2] - path[i].pos[2];
    if (dx !== 0 || dz !== 0) return Math.atan2(dx, dz);
  }

  for (let i = segment + 1; i < path.length - 1; i += 1) {
    const dx = path[i + 1].pos[0] - path[i].pos[0];
    const dz = path[i + 1].pos[2] - path[i].pos[2];
    if (dx !== 0 || dz !== 0) return Math.atan2(dx, dz);
  }

  return 0;
}
