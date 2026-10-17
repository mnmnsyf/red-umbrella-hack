import type { Vec3, Zone } from '../types';

export function distanceToZone(pos: Vec3, zone: Zone): number {
  const dx = Math.max(zone.min[0] - pos[0], 0, pos[0] - zone.max[0]);
  const dz = Math.max(zone.min[1] - pos[2], 0, pos[2] - zone.max[1]);
  return Math.hypot(dx, dz);
}
