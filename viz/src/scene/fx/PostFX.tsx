import { Bloom, EffectComposer, N8AO, TiltShift2, Vignette } from '@react-three/postprocessing';

// Diorama look: contact shadows, a little bloom on sun glints, tilt-shift focus band and a soft lens vignette.
export default function PostFX() {
  return (
    <EffectComposer multisampling={4}>
      <N8AO aoRadius={24} distanceFalloff={1} intensity={1.4} halfRes quality="medium" />
      <Bloom luminanceThreshold={0.92} luminanceSmoothing={0.08} intensity={0.45} mipmapBlur />
      <TiltShift2 blur={0.09} taper={0.6} start={[0.5, 0.0]} end={[0.5, 1.0]} samples={8} />
      <Vignette eskil={false} offset={0.3} darkness={0.32} />
    </EffectComposer>
  );
}
