import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import { COLORS, SCENE_SIZE } from '../theme';

const SURFACE_SIZE = SCENE_SIZE * 1.5;

export default function WaterSurface() {
  const geometry = useMemo(() => new PlaneGeometry(SURFACE_SIZE, SURFACE_SIZE, 80, 80), []);
  const material = useMemo(() => new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWater: { value: new Color(COLORS.shallowWater) },
      uGlow: { value: new Color(COLORS.acoustic) },
    },
    vertexShader: `
      uniform float uTime;
      varying vec2 vGrid;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      void main() {
        vec3 displaced = position;
        float waveX = position.x * 0.009 + uTime * 0.35;
        float waveY = position.y * 0.014 - uTime * 0.25;
        displaced.z = 0.7 * sin(waveX) + 0.35 * sin(waveY);
        vec3 localNormal = normalize(vec3(
          -0.0063 * cos(waveX),
          -0.0049 * cos(waveY),
          1.0
        ));
        vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * localNormal);
        vGrid = position.xy;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uWater;
      uniform vec3 uGlow;
      varying vec2 vGrid;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      float gridLine(vec2 uv, float spacing, float width) {
        vec2 phase = abs(fract(uv / spacing + 0.5) - 0.5);
        vec2 aa = max(fwidth(uv / spacing) * width, vec2(0.001));
        vec2 line = 1.0 - smoothstep(vec2(0.0), aa, phase);
        return max(line.x, line.y);
      }

      void main() {
        float distanceFade = 1.0 - smoothstep(500.0, 1800.0, distance(cameraPosition, vWorldPosition));
        float fineGrid = gridLine(vGrid, 40.0, 1.0) * distanceFade;
        float majorGrid = gridLine(vGrid, 200.0, 1.6) * distanceFade;
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - abs(dot(normalize(vWorldNormal), viewDirection)), 2.4);
        float glow = fineGrid * 0.06 + majorGrid * 0.22 + fresnel * 0.3;
        vec3 color = uWater * 0.65 + uGlow * glow;
        float alpha = clamp(0.06 + fineGrid * 0.02 + majorGrid * 0.06 + fresnel * 0.12, 0.0, 0.35);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  }), []);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <mesh rotation-x={-Math.PI / 2} geometry={geometry}>
      <primitive object={material} attach="material" />
    </mesh>
  );
}
