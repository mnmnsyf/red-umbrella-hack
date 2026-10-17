import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DoubleSide, PlaneGeometry, ShaderMaterial, Vector3, Vector4 } from 'three';
import { COLORS, HORIZON, WORLD_SIZE } from '../theme';

// Glassy harbour surface: pale blue body, white fresnel sheen and moving sun glints.
export default function WaterSurface() {
  const geometry = useMemo(() => new PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1), []);
  const material = useMemo(() => new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWater: { value: new Color('#5aaed0') },
      uDeep: { value: new Color('#3f7f9e') },
      uSun: { value: new Vector3(0.5, 0.65, 0.45).normalize() },
      uFog: { value: new Color(HORIZON.color) },
      uUnder: { value: new Color(COLORS.underwaterFog) },
      uHorizon: { value: new Vector4(HORIZON.near, HORIZON.far, HORIZON.fadeStart, HORIZON.fadeEnd) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPosition = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uWater;
      uniform vec3 uDeep;
      uniform vec3 uSun;
      uniform vec3 uFog;
      uniform vec3 uUnder;
      uniform vec4 uHorizon;
      varying vec3 vWorldPosition;

      vec2 wave(vec2 p, vec2 dir, float freq, float speed, float amp) {
        float phase = dot(p, dir) * freq + uTime * speed;
        return dir * cos(phase) * amp * freq;
      }

      void main() {
        vec2 p = vWorldPosition.xz;
        vec2 slope = wave(p, normalize(vec2(1.0, 0.3)), 0.045, 1.1, 0.9)
          + wave(p, normalize(vec2(-0.4, 1.0)), 0.07, 1.6, 0.5)
          + wave(p, normalize(vec2(0.8, -0.7)), 0.13, 2.3, 0.22)
          + wave(p, normalize(vec2(-0.9, -0.2)), 0.21, 3.1, 0.1);
        vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
        vec3 view = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(clamp(1.0 - dot(normal, view), 0.0, 1.0), 4.0);
        vec3 halfway = normalize(uSun + view);
        float glint = pow(max(dot(normal, halfway), 0.0), 220.0);
        vec3 color = mix(uWater, uDeep, 0.25);
        color = mix(color, vec3(1.0), fresnel * 0.45);
        color += vec3(1.0) * glint * 1.4;
        float alpha = clamp(0.34 + fresnel * 0.3 + glint, 0.0, 0.7);
        float viewDistance = distance(cameraPosition, vWorldPosition);
        bool underwater = cameraPosition.y < 0.0;
        float horizon = underwater
          ? smoothstep(50.0, 900.0, viewDistance)
          : max(smoothstep(uHorizon.x, uHorizon.y, viewDistance), smoothstep(uHorizon.z, uHorizon.w, length(vWorldPosition.xz)));
        vec3 fogColor = underwater ? uUnder : uFog;
        gl_FragColor = vec4(mix(color, fogColor, horizon), mix(underwater ? max(alpha, 0.55) : alpha, 1.0, horizon));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  }), []);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <mesh rotation-x={-Math.PI / 2} geometry={geometry} renderOrder={2}>
      <primitive object={material} attach="material" />
    </mesh>
  );
}
