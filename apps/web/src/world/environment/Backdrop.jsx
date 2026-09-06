import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { SRGBColorSpace } from 'three';

/**
 * The distance, as a photograph rather than as geometry.
 *
 * WHY THIS REPLACES REAL TERRAIN. The far hills were the single largest source
 * of trouble in the scene: hundreds of thousands of triangles that are smaller
 * than a pixel by the time you see them, so they alias and shimmer whenever the
 * camera moves, and every fix for that traded away detail somewhere else. A
 * plate has none of those problems. It never aliases, never z-fights, costs one
 * texture fetch per pixel, and — since the camera is now held still — it cannot
 * be caught out by parallax it does not have.
 *
 * COVER-FIT, NOT STRETCH. three renders a background texture across the whole
 * viewport without correcting for aspect, so a 16:9 plate on a 21:9 window comes
 * out visibly squashed. The repeat and offset below crop the image the way CSS
 * `background-size: cover` does: match whichever axis is tighter and centre the
 * overflow on the other. Recomputed on resize, because the window is the half of
 * that ratio that changes.
 *
 * The background is not fogged — three composites it behind everything after the
 * scene is drawn — so the fog colour has to match the plate where the ground
 * meets it, or the terrain fades into a band of the wrong grey. See Atmosphere,
 * where the fog is set from colours sampled out of this image.
 */
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

  useLayoutEffect(() => {
    const image = texture.image;
    if (!image || !image.width) return;

    const imageAspect = image.width / image.height;
    const viewAspect = size.width / size.height;

    if (viewAspect > imageAspect) {
      /* Window is wider than the plate: fill the width, crop top and bottom. */
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
