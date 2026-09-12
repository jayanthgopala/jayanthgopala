import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { SRGBColorSpace } from 'three';

// The distance as a photograph rather than geometry. Real far hills were hundreds of thousands of triangles smaller
// than a pixel, so they aliased and shimmered on every camera move. A plate never aliases and costs one fetch per pixel.
// The background isn't fogged, three composites it behind everything after the scene is drawn, so the fog colour has to
// match the plate where the ground meets it or the terrain fades into a band of the wrong grey. See Atmosphere.
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

  // Cover-fit, not stretch. three renders a background across the viewport without correcting for aspect, so a 16:9
  // plate on a 21:9 window comes out squashed. Match whichever axis is tighter and centre the overflow on the other.
  useLayoutEffect(() => {
    const image = texture.image;
    if (!image || !image.width) return;

    const imageAspect = image.width / image.height;
    const viewAspect = size.width / size.height;

    if (viewAspect > imageAspect) {
      // window is wider than the plate, fill the width and crop top and bottom
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
