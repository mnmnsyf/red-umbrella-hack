import { useLayoutEffect, useRef, type ComponentRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { usePlaybackStore } from '../store';
import { displayPositionOf } from './selectable';
import type { CameraShot, Vec3 } from '../types';

function lerpVec3(from: Vec3, to: Vec3, amount: number): Vec3 {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}

function withDrift(pos: Vec3, target: Vec3, t: number, drift?: { deg: number; period: number; lift?: number }): Vec3 {
  if (!drift || drift.period <= 0) return pos;
  const phase = (2 * Math.PI * t) / drift.period;
  const angle = (drift.deg * Math.PI / 180) * Math.sin(phase);
  const dx = pos[0] - target[0];
  const dz = pos[2] - target[2];
  const lift = 1 + (drift.lift ?? 0) * Math.sin(phase * 0.5 + 1.3);
  return [
    target[0] + dx * Math.cos(angle) - dz * Math.sin(angle),
    target[1] + (pos[1] - target[1]) * lift,
    target[2] + dx * Math.sin(angle) + dz * Math.cos(angle),
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
  const drift = usePlaybackStore((state) => state.scenario?.cameraDrift);
  const freeCamera = usePlaybackStore((state) => state.freeCamera);
  const camera = useThree((state) => state.camera);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const seenRequest = useRef<number | null>(null);
  const flight = useRef<{
    started: number;
    fromPosition: Vec3;
    fromTarget: Vec3;
    toPosition: Vec3;
    toTarget: Vec3;
  } | null>(null);
  const followedAt = useRef<Vec3 | null>(null);

  useLayoutEffect(() => {
    if (!freeCamera || !shots?.length || !controls.current) return;
    const { target } = cameraPoseAt(shots, usePlaybackStore.getState().t);
    controls.current.target.set(...target);
    controls.current.update();
  }, [freeCamera, shots]);

  useFrame(({ clock }) => {
    const state = usePlaybackStore.getState();
    if (!state.freeCamera) {
      flight.current = null;
      seenRequest.current = null;
      followedAt.current = null;
      if (!shots?.length) return;
      const { pos, target } = cameraPoseAt(shots, state.t);
      camera.position.set(...withDrift(pos, target, state.t, drift));
      camera.lookAt(...target);
      return;
    }

    const orbit = controls.current;
    if (!orbit) return;
    const request = state.flyRequest;
    if (request && seenRequest.current !== request.requestedAt) {
      seenRequest.current = request.requestedAt;
      const fromPosition = camera.position.toArray() as Vec3;
      const fromTarget = orbit.target.toArray() as Vec3;
      const direction = orbit.target.clone().sub(camera.position).normalize();
      const target = request.target;
      const toPosition: Vec3 = request.position ?? [
        target[0] - direction.x * request.distance,
        Math.max(target[1] - direction.y * request.distance, target[1] + request.distance * 0.35),
        target[2] - direction.z * request.distance,
      ];
      flight.current = {
        started: clock.elapsedTime,
        fromPosition,
        fromTarget,
        toPosition,
        toTarget: [...target],
      };
      followedAt.current = request.follow ? [...target] : null;
    }

    const currentFlight = flight.current;
    if (currentFlight && request?.follow && state.scenario) {
      // Keep aiming at a moving object so following starts without a jump when the flight lands.
      const live = displayPositionOf(request.follow, state.scenario, state.t);
      if (live) {
        const shift = [0, 1, 2].map((axis) => live[axis] - currentFlight.toTarget[axis]);
        currentFlight.toTarget = live;
        currentFlight.toPosition = currentFlight.toPosition.map((value, axis) => value + shift[axis]) as Vec3;
        followedAt.current = live;
      }
    }
    if (currentFlight) {
      const progress = Math.min(1, (clock.elapsedTime - currentFlight.started) / 1.2);
      const eased = progress * progress * (3 - 2 * progress);
      camera.position.set(...lerpVec3(currentFlight.fromPosition, currentFlight.toPosition, eased));
      orbit.target.set(...lerpVec3(currentFlight.fromTarget, currentFlight.toTarget, eased));
      orbit.update();
      if (progress >= 1) flight.current = null;
      return;
    }

    if (request?.follow && state.scenario) {
      const next = displayPositionOf(request.follow, state.scenario, state.t);
      if (next && followedAt.current) {
        const previous = followedAt.current;
        camera.position.x += next[0] - previous[0];
        camera.position.y += next[1] - previous[1];
        camera.position.z += next[2] - previous[2];
        orbit.target.x += next[0] - previous[0];
        orbit.target.y += next[1] - previous[1];
        orbit.target.z += next[2] - previous[2];
        orbit.update();
        followedAt.current = next;
      }
    }
  });

  return <OrbitControls ref={controls} enabled={freeCamera} onStart={() => {
    if (flight.current) {
      flight.current = null;
      const state = usePlaybackStore.getState();
      followedAt.current = state.flyRequest?.follow && state.scenario
        ? displayPositionOf(state.flyRequest.follow, state.scenario, state.t)
        : null;
    }
  }} />;
}
