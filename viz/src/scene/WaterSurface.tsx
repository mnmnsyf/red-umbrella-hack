import { useMemo } from 'react';
import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Color, DoubleSide, PlaneGeometry, ShaderMaterial, SRGBColorSpace, Vector3, Vector4 } from 'three';
import { ANGELS_GATE_MAP } from '../location';
import { COLORS, HORIZON, SCENE_SIZE, WORLD_SIZE } from '../theme';

// Glassy harbour surface with the real Angels Gate coastline: pale blue water, white fresnel sheen, sun glints and pale land.
export default function WaterSurface() {
  const map = useTexture(ANGELS_GATE_MAP.image);
  const contextMap = useTexture(ANGELS_GATE_MAP.contextImage);
  const landMask = useTexture(ANGELS_GATE_MAP.land);
  const contextLandMask = useTexture(ANGELS_GATE_MAP.contextLand);
  map.colorSpace = SRGBColorSpace;
  contextMap.colorSpace = SRGBColorSpace;
  const geometry = useMemo(() => new PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1), []);
  const material = useMemo(() => new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMap: { value: map },
      uContextMap: { value: contextMap },
      uLand: { value: landMask },
      uContextLand: { value: contextLandMask },
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
      uniform sampler2D uMap;
      uniform sampler2D uContextMap;
      uniform sampler2D uLand;
      uniform sampler2D uContextLand;
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
        bool underwater = cameraPosition.y < 0.0;
        // The imagery only supplies the coastline; water keeps the glassy look and land is drawn as pale relief.
        vec2 uv = vec2(0.5 - p.x / ${SCENE_SIZE.toFixed(1)}, 0.5 + p.y / ${SCENE_SIZE.toFixed(1)});
        vec2 contextUv = vec2(0.5 - p.x / ${ANGELS_GATE_MAP.contextSize.toFixed(1)}, 0.5 + p.y / ${ANGELS_GATE_MAP.contextSize.toFixed(1)});
        float contextEdge = min(min(contextUv.x, 1.0 - contextUv.x), min(contextUv.y, 1.0 - contextUv.y));
        float contextCoverage = smoothstep(0.0, 0.015, contextEdge);
        float mapEdge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
        float mapCoverage = smoothstep(0.0, 0.04, mapEdge);
        vec2 mapUv = clamp(uv, 0.0, 1.0);
        vec2 wideUv = clamp(contextUv, 0.0, 1.0);
        float land = mix(texture2D(uContextLand, wideUv).r * contextCoverage, texture2D(uLand, mapUv).r, mapCoverage);
        if (underwater) land = 0.0;
        vec3 imagery = mix(texture2D(uContextMap, wideUv).rgb, texture2D(uMap, mapUv).rgb, mapCoverage);
        float luma = dot(imagery, vec3(0.299, 0.587, 0.114));
        vec3 landColor = mix(vec3(0.93, 0.935, 0.925), mix(vec3(luma), imagery, 0.45) * 1.25 + 0.06, 0.4);
        float solid = smoothstep(0.35, 0.65, land);
        float rim = smoothstep(0.06, 0.4, land) * (1.0 - smoothstep(0.4, 0.8, land));
        color += vec3(1.0) * glint * 1.4 * (1.0 - solid);
        color = mix(color, landColor, solid);
        color = mix(color, vec3(1.0), rim * 0.7);
        float alpha = clamp(0.34 + fresnel * 0.3 + glint, 0.0, 0.7);
        alpha = max(alpha, max(solid, rim * 0.8));
        float viewDistance = distance(cameraPosition, vWorldPosition);
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
  }), [map, contextMap, landMask, contextLandMask]);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <mesh rotation-x={-Math.PI / 2} geometry={geometry} renderOrder={2}>
      <primitive object={material} attach="material" />
    </mesh>
  );
}
