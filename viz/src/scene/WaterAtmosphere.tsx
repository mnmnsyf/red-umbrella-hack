import { useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Fog } from 'three';
import { COLORS } from '../theme';

const UNDERWATER_COLOR = new Color(COLORS.underwaterFog);
const UNDERWATER_NEAR = 50;
const UNDERWATER_FAR = 900;
const BLEND_SECONDS = 0.5;
const TINT_OPACITY = 0.15;

export default function WaterAtmosphere({ tintRef }: { tintRef: RefObject<HTMLDivElement> }) {
  const blend = useRef(0);
  const surfaceFog = useRef<{ color: Color; near: number; far: number } | null>(null);

  useFrame(({ camera, scene }, delta) => {
    const fog = scene.fog;
    if (!(fog instanceof Fog)) return;
    const surface = surfaceFog.current ?? (surfaceFog.current = {
      color: fog.color.clone(),
      near: fog.near,
      far: fog.far,
    });

    const direction = camera.position.y < 0 ? 1 : -1;
    blend.current = Math.max(0, Math.min(1, blend.current + direction * delta / BLEND_SECONDS));
    const amount = blend.current * blend.current * (3 - 2 * blend.current);

    fog.color.copy(surface.color).lerp(UNDERWATER_COLOR, amount);
    fog.near = surface.near + (UNDERWATER_NEAR - surface.near) * amount;
    fog.far = surface.far + (UNDERWATER_FAR - surface.far) * amount;
    if (tintRef.current) tintRef.current.style.opacity = String(TINT_OPACITY * amount);
  });

  return null;
}
