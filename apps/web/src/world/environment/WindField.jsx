import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { updateWind, setCursor, wind } from '../lib/wind-field.js';
import { heightAt, MOUND_AT } from '../lib/terrain.js';

/**
 * Drives the wind field. Renders nothing.
 *
 * ONE COMPONENT ADVANCES THE AIR AND ONE COMPONENT PROJECTS THE POINTER INTO IT.
 * Everything else in the scene only ever READS — see lib/wind-field.js for why
 * that split matters. Putting the update anywhere else, or in more than one
 * place, would make the field's rate depend on how many consumers happened to be
 * mounted.
 *
 * WHY THE POINTER IS PROJECTED INTO THE WORLD RATHER THAN USED AS A SCREEN
 * VECTOR. The obvious version of "cursor affects the scene" reads state.pointer,
 * a pair of numbers in [-1, 1], and multiplies something by it. That produces an
 * effect that is strongest at the edges of the SCREEN, which is a property of
 * the window rather than of the place — move the camera and the disturbance
 * stays stuck to the same corner of the monitor.
 *
 * Casting the pointer ray onto the ground plane instead gives a position in the
 * WORLD. The disturbance then belongs to the snow it lands on: it sits still
 * when the camera moves past it, and it is somewhere the igloo, the wisps and
 * the grains can each measure their own distance from. That is the difference
 * between the environment reacting and the page reacting.
 */
export default function WindField() {
  const { camera } = useThree();

  const ray = useRef(new Raycaster());
  const ndc = useRef(new Vector2());
  const hit = useRef(new Vector3());
  const last = useRef({ x: MOUND_AT[0], z: MOUND_AT[1], has: false });

  /*
   * A HORIZONTAL PLANE AT THE GROUND'S TYPICAL HEIGHT, rather than the terrain
   * mesh itself.
   *
   * Raycasting the real terrain would be exact and costs a BVH traversal of a
   * 512x512 grid every frame to answer a question whose precision does not
   * matter — this decides where a soft ninety-unit disturbance is centred, so
   * being a few units out is invisible. The plane is set at the height under the
   * igloo, which is where the pointer spends nearly all its time.
   */
  const plane = useRef(new Plane(new Vector3(0, 1, 0), -heightAt(MOUND_AT[0], MOUND_AT[1])));

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    updateWind(dt, state.clock.elapsedTime);

    ndc.current.set(state.pointer.x, state.pointer.y);
    ray.current.setFromCamera(ndc.current, camera);

    if (ray.current.ray.intersectPlane(plane.current, hit.current)) {
      const x = hit.current.x;
      const z = hit.current.z;

      /*
       * THE PUSH SCALES WITH POINTER SPEED, NOT POSITION.
       *
       * A cursor resting on the snow should disturb nothing — air does not care
       * where you are looking. What moves air is movement. So the strength comes
       * from how far the projected point travelled since the last frame, which
       * means a slow drag stirs gently, a flick gusts, and a still hand leaves
       * the scene to settle back to its own weather.
       *
       * Divided by dt so it is a speed rather than a per-frame delta — otherwise
       * the same gesture would disturb twice as much at thirty frames as at
       * sixty.
       */
      if (last.current.has) {
        const moved = Math.hypot(x - last.current.x, z - last.current.z);
        const speed = moved / Math.max(dt, 1e-3);
        /* 900 units/s is a brisk flick across the frame; that saturates it. */
        setCursor(x, z, Math.min(0.45, speed / 900) * dt * 8);
      }
      last.current.x = x;
      last.current.z = z;
      last.current.has = true;
    }

    /* DEV-ONLY PROBE. The field is a module singleton with no DOM presence, so
       there is otherwise no way to confirm from outside that the pointer is
       reaching it — the visible result is a few per cent of opacity on a wisp,
       which is unfalsifiable by eye. Same reasoning as Diagnostics.jsx, and it
       is stripped from the production bundle by the same flag. */
    if (import.meta.env.DEV) window.__wind = wind;
  });

  return null;
}
