import { RepeatWrapping, SRGBColorSpace, type Texture, TextureLoader } from 'three';

const loader = new TextureLoader();
const cache = new Map<string, Texture>();


// Non-suspending texture loads: the texture object is returned at once and fills in when the image arrives.
export function loadTexture(url: string, color = true): Texture {
  const cached = cache.get(url);
  if (cached) return cached;
  const texture = loader.load(url);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  if (color) texture.colorSpace = SRGBColorSpace;
  cache.set(url, texture);
  return texture;
}

// Resolves once every scene texture has its image, so the diorama never shows black placeholders.
export function preloadTextures(urls: { url: string; color?: boolean }[]): Promise<void> {
  return Promise.all(urls.map(({ url, color = true }) => new Promise<void>((resolve) => {
    const texture = loadTexture(url, color);
    if (texture.image) {
      resolve();
      return;
    }
    const image = new Image();
    image.onload = image.onerror = () => resolve();
    image.src = url;
  }))).then(() => undefined);
}
