import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';

// Soft shafts of sunlight slanting down through the water column.
const RAYS: [number, number, number, number][] = [
  [-520, -260, 0.35, 150],
  [-180, 120, 0.3, 110],
  [160, -420, 0.38, 170],
  [420, 260, 0.33, 120],
  [700, -80, 0.36, 140],
  [-760, 520, 0.32, 100],
];

export default function LightRays() {
  const rayMaterial = useMemo(() => new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      varying float vSeed;
      void main() {
        vUv = uv;
        vSeed = modelMatrix[3][0] * 0.013;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying float vSeed;
      void main() {
        float across = sin(clamp(vUv.x, 0.0, 1.0) * 3.14159265);
        float down = pow(clamp(vUv.y, 0.0, 1.0), 1.6);
        float shimmer = 0.75 + 0.25 * sin(uTime * 0.6 + vSeed * 7.0);
        gl_FragColor = vec4(vec3(1.0), across * across * down * 0.1 * shimmer);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  }), []);
  const rayGeometry = useMemo(() => new PlaneGeometry(1, 1), []);

  useFrame(({ clock }) => {
    rayMaterial.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <>
      {RAYS.map(([x, z, tilt, width]) => (
        <mesh
          key={`${x}:${z}`}
          geometry={rayGeometry}
          material={rayMaterial}
          position={[x, -75, z]}
          rotation={[0, 0.55, tilt]}
          scale={[width, 170, 1]}
          renderOrder={4}
        />
      ))}
    </>
  );
}
