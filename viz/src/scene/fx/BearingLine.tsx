import { useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, ShaderMaterial } from 'three';
import { COLORS } from '../../theme';
import type { Vec3 } from '../../types';
import { scenePosition } from './coordinates';

interface BearingLineProps {
  position: Vec3;
  bearingDeg: number;
  length?: number;
  width?: number;
  t?: number;
  startTime?: number;
  opacity?: number;
}

export default function BearingLine({ position, bearingDeg, length = 300, width = 3, t, startTime = 0, opacity = 1 }: BearingLineProps) {
  const geometry = useMemo(() => {
    const angle = bearingDeg * Math.PI / 180;
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    const sideX = dz * width / 2;
    const sideZ = -dx * width / 2;
    const buffer = new BufferGeometry();
    buffer.setAttribute('position', new BufferAttribute(new Float32Array([
      -sideX, 0, -sideZ,
      sideX, 0, sideZ,
      dx * length - sideX, 0, dz * length - sideZ,
      dx * length + sideX, 0, dz * length + sideZ,
    ]), 3));
    buffer.setAttribute('aProgress', new BufferAttribute(new Float32Array([0, 0, 1, 1]), 1));
    buffer.setIndex([0, 1, 2, 2, 1, 3]);
    return buffer;
  }, [bearingDeg, length, width]);
  const material = useMemo(() => new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(COLORS.acoustic) },
      uOpacity: { value: opacity },
    },
    vertexShader: `
      attribute float aProgress;
      varying float vProgress;
      void main() {
        vProgress = aProgress;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vProgress;
      void main() {
        float alpha = 0.8 * uOpacity * pow(1.0 - vProgress, 1.5);
        gl_FragColor = vec4(uColor * 2.2, alpha);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  }), []);

  material.uniforms.uOpacity.value = opacity;
  if (t !== undefined && t < startTime) return null;
  return <mesh position={scenePosition(position)} geometry={geometry} material={material} renderOrder={10} />;
}
