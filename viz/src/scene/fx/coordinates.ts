import { VEXAG } from '../../theme';
import type { Vec3 } from '../../types';

export function scenePosition(position: Vec3): Vec3 {
  return [position[0], position[1] * VEXAG, position[2]];
}
