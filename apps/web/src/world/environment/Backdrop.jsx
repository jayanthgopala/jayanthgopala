import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { SRGBColorSpace } from 'three';

// Distant plate background texture
export default function Backdrop({ url = '/environments/arctic-backdrop.jpg' }) {
  const texture = useTexture(url);
  const { scene, size } = useThree();

  useLayoutEffect(() => {
    texture.colorSpace = SRGBColorSpace;
    scene.background = texture;
    return () => {
      scene.background = null;
    };
  }, [scene, texture]);

  // Aspect-ratio correction to cover-fit viewport
  useLayoutEffect(() => {
    const image = texture.image;
    if (!image || !image.width) return;

    const imageAspect = image.width / image.height;
    const viewAspect = size.width / size.height;

    if (viewAspect > imageAspect) {
      // Fill width and center crop top/bottom
      const scale = imageAspect / viewAspect;
      texture.repeat.set(1, scale);
      texture.offset.set(0, (1 - scale) / 2);
    } else {
      const scale = viewAspect / imageAspect;
      texture.repeat.set(scale, 1);
      texture.offset.set((1 - scale) / 2, 0);
    }

    texture.needsUpdate = true;
  }, [texture, size]);

  return null;
}
