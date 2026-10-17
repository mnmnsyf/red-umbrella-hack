import { useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, ShaderMaterial } from 'three';
import { COLORS, VEXAG } from '../../theme';
import type { Keyframe, Vec3 } from '../../types';

interface TrackTrailProps {
  path: Keyframe[];
  t: number;
  width?: number;
  tailDuration?: number;
  dashed?: boolean;
  startTime?: number;
  color?: string;
  opacity?: number;
}

function interpolate(start: Vec3, end: Vec3, fraction: number): Vec3 {
  return [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
    start[2] + (end[2] - start[2]) * fraction,
  ];
}

export default function TrackTrail({
  path, t, width = 4, tailDuration = 100, dashed = false, startTime = -Infinity, color = COLORS.acoustic, opacity = 0.9,
}: TrackTrailProps) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const times: number[] = [];
    const distances: number[] = [];
    const indices: number[] = [];
    let distanceAlong = 0;

    for (let i = 0; i < path.length - 1; i += 1) {
      const start = path[i];
      const end = path[i + 1];
      const dx = end.pos[0] - start.pos[0];
      const dz = end.pos[2] - start.pos[2];
      const segmentLength = Math.hypot(dx, dz);
      if (segmentLength === 0 || end.t <= start.t) continue;
      const steps = Math.ceil(segmentLength / 6);
      const sideX = dz / segmentLength * width / 2;
      const sideZ = -dx / segmentLength * width / 2;

      for (let step = 0; step < steps; step += 1) {
        const a = step / steps;
        const b = (step + 1) / steps;
        const pointA = interpolate(start.pos, end.pos, a);
        const pointB = interpolate(start.pos, end.pos, b);
        const timeA = start.t + (end.t - start.t) * a;
        const timeB = start.t + (end.t - start.t) * b;
        const startDistance = distanceAlong + segmentLength * a;
        const endDistance = distanceAlong + segmentLength * b;
        const index = positions.length / 3;
        positions.push(
          pointA[0] - sideX, pointA[1] * VEXAG, pointA[2] - sideZ,
          pointA[0] + sideX, pointA[1] * VEXAG, pointA[2] + sideZ,
          pointB[0] - sideX, pointB[1] * VEXAG, pointB[2] - sideZ,
          pointB[0] + sideX, pointB[1] * VEXAG, pointB[2] + sideZ,
        );
        times.push(timeA, timeA, timeB, timeB);
        distances.push(startDistance, startDistance, endDistance, endDistance);
        indices.push(index, index + 1, index + 2, index + 2, index + 1, index + 3);
      }
      distanceAlong += segmentLength;
    }

    const buffer = new BufferGeometry();
    buffer.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    buffer.setAttribute('aPathTime', new BufferAttribute(new Float32Array(times), 1));
    buffer.setAttribute('aDistance', new BufferAttribute(new Float32Array(distances), 1));
    buffer.setIndex(indices);
    return buffer;
  }, [path, width]);

  const material = useMemo(() => new ShaderMaterial({
    uniforms: {
      uTime: { value: t },
      uTailDuration: { value: tailDuration },
      uDashed: { value: dashed ? 1 : 0 },
      uStart: { value: 0 },
      uOpacity: { value: opacity },
      uColor: { value: new Color(color) },
    },
    vertexShader: `
      attribute float aPathTime;
      attribute float aDistance;
      varying float vPathTime;
      varying float vDistance;
      void main() {
        vPathTime = aPathTime;
        vDistance = aDistance;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uTailDuration;
      uniform float uDashed;
      uniform float uStart;
      uniform float uOpacity;
      uniform vec3 uColor;
      varying float vPathTime;
      varying float vDistance;
      void main() {
        float age = uTime - vPathTime;
        if (age < 0.0 || age > uTailDuration || vPathTime < uStart) discard;
        if (uDashed > 0.5 && mod(vDistance, 24.0) > 15.0) discard;
        float fade = 1.0 - smoothstep(0.0, uTailDuration, age);
        gl_FragColor = vec4(uColor * 2.4, fade * uOpacity);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  }), []);

  material.uniforms.uTime.value = t;
  material.uniforms.uTailDuration.value = Math.max(0.001, tailDuration);
  material.uniforms.uDashed.value = dashed ? 1 : 0;
  material.uniforms.uStart.value = Math.max(-1e6, startTime);
  material.uniforms.uOpacity.value = opacity;
  material.uniforms.uColor.value.set(color);

  if (path.length < 2 || t < path[0].t || t < startTime) return null;
  return <mesh geometry={geometry} material={material} renderOrder={10} />;
}
