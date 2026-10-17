import { useLayoutEffect, useRef, type ComponentRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { usePlaybackStore } from '../store';
import type { CameraShot, Vec3 } from '../types';

function lerpVec3(from: Vec3, to: Vec3, amount: number): Vec3 {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}

function cameraPoseAt(shots: CameraShot[], t: number) {
  let index = 0;
  for (let i = 1; i < shots.length; i += 1) {
    if (shots[i].t <= t) index = i;
  }

  const shot = shots[index];
  const previous = shots[Math.max(0, index - 1)];
  const progress = shot.dur > 0 ? Math.max(0, Math.min(1, (t - shot.t) / shot.dur)) : 1;
  const eased = progress * progress * (3 - 2 * progress);
  return {
    pos: lerpVec3(previous.pos, shot.pos, eased),
    target: lerpVec3(previous.target, shot.target, eased),
  };
}

export default function CameraDirector() {
  const shots = usePlaybackStore((state) => state.scenario?.camera);
  const freeCamera = usePlaybackStore((state) => state.freeCamera);
  const camera = useThree((state) => state.camera);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);

  useLayoutEffect(() => {
    if (!freeCamera || !shots?.length || !controls.current) return;
    const { target } = cameraPoseAt(shots, usePlaybackStore.getState().t);
    controls.current.target.set(...target);
    controls.current.update();
  }, [freeCamera, shots]);

  useFrame(() => {
    if (usePlaybackStore.getState().freeCamera || !shots?.length) return;
    const { pos, target } = cameraPoseAt(shots, usePlaybackStore.getState().t);
    camera.position.set(...pos);
    camera.lookAt(...target);
  });

  return <OrbitControls ref={controls} enabled={freeCamera} />;
}
