import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing';

export default function PostFX() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom luminanceThreshold={1.15} luminanceSmoothing={0.18} intensity={0.8} mipmapBlur />
      <Vignette eskil={false} offset={0.3} darkness={0.42} />
      <Noise opacity={0.025} />
    </EffectComposer>
  );
}
