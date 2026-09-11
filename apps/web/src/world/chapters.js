import { Vector3, CatmullRomCurve3 } from 'three';

/**
 * The journey: where the camera goes, where it looks, and which act it is in.
 *
 * ONE CONTINUOUS PATH, NOT SEVEN SCENES. The acts are not separate places that
 * get swapped in and out — they are named stretches of a single curve through a
 * single world. That is the whole difference between travelling somewhere and
 * cutting between slides, and it is why there is exactly one spline here rather
 * than a camera position per section.
 *
 * The world is a corridor running along -Z (see terrain.js). The figure walks
 * down it and the camera travels with him, so every waypoint below is further
 * along -Z than the one before it. Nothing ever doubles back: reversing along Z
 * mid-path would read as the journey undoing itself.
 *
 * TWO CURVES, NOT ONE. Position and aim are separate splines sampled at the same
 * progress. A single path with the camera always facing along its own tangent
 * can only ever produce a rollercoaster: it cannot look sideways at something as
 * it passes, or hold its gaze on a structure while moving past it. Decoupling
 * the aim is what buys actual camera choreography.
 */

/** Chapter boundaries as scroll fractions, and the copy each one carries. */
/*
 * THREE ACTS, AND THE JOURNEY PULLS AWAY.
 *
 * The seven-act rail belonged to a path that travelled down -Z past the igloo
 * and out the other side. That was switched off, correctly — the note in
 * CameraRig records that scrolling away along it lost the only thing in the
 * frame worth looking at, because it went PAST the structure and left it
 * behind.
 *
 * This does the opposite thing with the same instinct. The camera lifts back
 * and up, and the igloo stays dead centre the whole way — it never leaves the
 * frame, it recedes in it, until it is one small dark mark in an enormous white
 * field. Retreating while holding the subject is what the reference does, and
 * it is the shot the landscape was built for: you only find out how big the
 * country is by leaving.
 */
/*
 * THE CUT COMES STRAIGHT AFTER THE HORIZON.
 *
 * The Expanse went first, then the Retreat: the opening frame and the first
 * of the pull-back are the whole journey now, and the cut to the work page
 * follows immediately. The reference does the same — a short move off its
 * igloo, then the cut while the igloo still fills a good part of the frame —
 * and the lift-out only reads when there is something of size to lift.
 *
 * The act boundaries are still in camera-journey units (see JOURNEY below), so
 * the work act begins exactly where the cut does.
 */
export const ACTS = [
  { id: 'horizon', index: 1, start: 0.0, end: 0.34, label: 'Horizon' },
  { id: 'work', index: 2, start: 0.34, end: 1.0, label: 'Selected Work' },
];

export function actAt(progress) {
  return ACTS.find((a) => progress >= a.start && progress < a.end) || ACTS[ACTS.length - 1];
}

/** 0..1 within the given act. Used for beats that fire inside a chapter. */
export function actProgress(progress, act) {
  const span = act.end - act.start;
  return span <= 0 ? 0 : Math.min(1, Math.max(0, (progress - act.start) / span));
}

/*
 * THE SCROLL, IN THREE STRETCHES, measured in screens.
 *
 *   world  the Horizon, and nothing after it. Half a screen — the pace the
 *          Horizon already had — so the cut starts three or four wheel
 *          notches in. The rig's damping keeps the pull-back a glide rather
 *          than a jump.
 *   cut    the wipe to the work page. 0.9 of a screen — but nobody scrolls
 *          through it by hand: ScrollProvider plays it through the moment it
 *          starts, so this is how far that play travels, not how far you do.
 *   page   whatever the work page measures (ScrollProvider adds it).
 */
export const SEGMENTS = { world: 0.5, cut: 0.9 };

/*
 * Where on the camera curve the world stretch ends, and how much further the
 * lens drifts while the cut runs. Still retreating as it lifts out, like the
 * reference; the curve's last waypoint is simply never reached, and the curve
 * itself is untouched.
 */
export const JOURNEY = { atCut: 0.34, end: 0.42 };

/** How far each picture travels vertically across the cut, as a share of the frame. From the reference. */
export const CUT_PARALLAX = 0.4;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Scroll pixels to the three things the world reads: where the camera is on its
 * journey, how far through the cut, and how far into the page. Writes into
 * `out` because it runs every frame.
 */
export function scrollState(scroll, vh, out = {}) {
  const worldPx = SEGMENTS.world * vh;
  const cutPx = SEGMENTS.cut * vh;
  const cut = clamp01((scroll - worldPx) / cutPx);

  out.journey =
    scroll < worldPx
      ? JOURNEY.atCut * clamp01(scroll / worldPx)
      : JOURNEY.atCut + (JOURNEY.end - JOURNEY.atCut) * cut;
  out.cut = cut;
  out.page = Math.max(0, scroll - worldPx - cutPx);
  return out;
}

/*
 * The camera's own path.
 *
 * Y values are authored as a *floor* — CameraRig lifts the camera above the
 * terrain wherever the ground would otherwise come through the lens. Authoring
 * absolute heights against procedural ground is a losing game: change one noise
 * constant and the shot is suddenly underground.
 */
const CAMERA_POINTS = [
  /* Act I opens at eye level, close in on the igloo — standing in front of it
     rather than looking down on it from a ridge. The high vantage made the
     hero object read as a model on a table. */
  /*
   * THE OPENING FRAME, and it is composed against the reference rather than
   * authored as the start of a move — which is why the solve below is in terms
   * of where things land in the picture rather than in world units.
   *
   * It was for a while the ONLY frame: the journey was switched off and the
   * camera held here permanently. It travels again now (see CameraRig), but
   * this waypoint has not moved and must not — it is the first thing anyone
   * sees, it is the frame every tonal measurement in the scene was taken
   * against, and every other waypoint on the path was chosen to lead away from
   * it rather than to re-compose it.
   *
   * Measured off igloo.inc: the dome stands centred, filling about half the
   * frame's height, seen from very slightly above and from a little more than
   * its own diameter away. Three things had to change. The lens sat at y=30
   * looking down at 13 — a raised vantage, which makes the structure read as a
   * model on a table; it is now near enough level with the dome's shoulder. It
   * aimed at x=3 while the igloo stands at x=-30, so the subject sat well off
   * to the left; the aim is now on the structure's own axis. And it was close
   * enough to fill two thirds of the frame, leaving no landscape around it.
   */
  /* Pulled back with the dome's height. At heightScale 1.72 the structure is
     37.8 units tall against 28 before, so the same framing needs a third more
     distance; and the lens rises with it, because a taller subject seen from
     the same height fills the frame upward and loses its ground. */
  /*
   * SOLVED FROM THE REFERENCE FRAME, not composed by eye.
   *
   * Measured off igloo.inc at 1568x652: its dome's top edge sits 26% down the
   * frame and its base 72% down, and its centre is 2.4% of the frame's width
   * left of centre. With a 42-degree vertical field that is all the constraint
   * needed, because those two percentages are angles:
   *
   *   above the axis   (0.50 - 0.26) x 2 x 21 =  10.1 deg
   *   below the axis   (0.72 - 0.50) x 2 x 21 =   9.2 deg
   *   total                                      19.3 deg
   *
   * Our dome is 33 units tall (radius 22, heightScale 1.5), so the distance
   * follows: 33 / tan(19.3) = 94. And the split between above and below fixes
   * the lens height — the base has to fall 9.2 degrees below the axis, which at
   * 94 units is 15.3 above it. The ground at the igloo is 15.78, so the camera
   * stands at 31.1 and looks HORIZONTALLY.
   *
   * That last part is the real change. The old frame was at y=32 aiming down at
   * 20, which is a raised vantage looking onto the structure; the reference is
   * level with the dome's shoulder looking straight out. Nothing else moves the
   * read from "model on a table" to "building on a hillside" as directly.
   *
   * The distance is 108 rather than the 94 the arithmetic gives, and the
   * correction is honest: the solve uses the PROFILE's height, and the built
   * dome stands a little taller than its profile because the blocks and their
   * fillets sit proud of the shell and the crown caps it. Rendered at 94 the
   * dome measured 53% of frame height against the reference's 46%, so the
   * distance is scaled by that ratio. The lens height and aim are re-solved at
   * the new distance rather than left behind, or the angles stop agreeing.
   */
  /* Lifted 8 units above the level solve, so the lens looks down about four
     and a half degrees: enough to see the top of the dome and to put some
     ground between the structure and the bottom of the frame, not so much that
     it becomes a raised vantage again. */
  /*
   * RAISED FROM 24.1, AND IT IS A FRAMING FIX RATHER THAN A TASTE ONE.
   *
   * The lens and its aim were both at 24.1 — dead level, no pitch at all — and
   * a level lens puts the horizon exactly halfway up the frame. Measured, ours
   * sat at 50% of frame height against the reference's 22%: half our picture
   * was empty sky while igloo.inc gives that half to the ground the igloo
   * stands on, which is where all of its depth comes from.
   *
   * Lifting the lens while the aim stays put pitches the camera down about
   * eight degrees. On a 42-degree vertical field that carries the horizon up
   * roughly a fifth of the frame, and it does it WITHOUT moving the dome, which
   * sits on the aim point and therefore stays where it was composed.
   */
  /*
   * THE PULL-AWAY.
   *
   * Every waypoint is further from the igloo than the one before it and higher
   * than the one before it, and the aim stays on the structure throughout — so
   * the shot is one continuous retreat with the subject pinned in the middle of
   * the frame, shrinking.
   *
   * IT LIFTS RATHER THAN REVERSING FLAT, and that is a terrain constraint
   * before it is a taste one. The ground behind the opening camera climbs hard:
   * sampled straight back along +Z it reaches 37 units by z=492 and 80 by
   * z=578, so a level dolly would be into a hillside within a couple of
   * seconds, and CameraRig's clearance clamp would spend the whole move shoving
   * the lens upward to stay out of it. Climbing deliberately keeps 60 to 85
   * units of air under the camera the whole way and makes the rise part of the
   * shot instead of an artefact of avoiding the ground.
   */
  /*
   * RE-SOLVED AGAINST THE REFERENCE FRAME, and the three measurements are:
   *
   *   the dome spans 18% of frame width      (it was 26%)
   *   its centre sits 58% down the frame     (it was 50%)
   *   the far valley floor sits 37% down     (it was off the top of frame)
   *
   * Every one of those is an angle, so the solve is direct. 26 to 18 per cent
   * of width is a distance multiplied by 1.43, which takes the lens from 124
   * units out to 177. The dome's centre 8.3% below frame centre is 3.5 degrees
   * below the axis, and the valley floor 13% above it is 5.5 degrees above —
   * which fixes the pitch at 5.5 degrees down and, with the dome's centre 9
   * degrees below the lens's own horizontal, puts the lens at 60.
   *
   * THE AIM IS DELIBERATELY NOT ON THE DOME any more. Pitch and subject height
   * are two constraints and one point cannot satisfy both: aiming at the igloo
   * pins it to the exact middle of frame by construction, which is where it
   * was and is not where the reference has it. So the aim sits about eleven
   * units above the crown and the dome hangs below it.
   *
   * WHAT THIS BUYS BEYOND THE SUBJECT'S SIZE is the sky. At the old pitch the
   * horizon sat above the top of the frame and there was no sky in the picture
   * at all — which is why the sun could not be seen, why the ranges had nothing
   * to stand against, and why the blue in Sky.jsx was invisible however it was
   * graded.
   */
  [12.8, 60, 422], // 1  the held opening frame — solved above
  [15, 80, 468], //   1  starting back and up, the dome still reads as the subject
  [18, 112, 524], //  2  the drift and the near hills come into view around it
  [22, 155, 588], //  2  the igloo is one object in a landscape now
  [27, 210, 660], //  3  and finally a mark on an empty white plain
];

/*
 * What the camera is looking at.
 *
 * ONE SUBJECT THE WHOLE WAY, which is the difference between this rail and the
 * one it replaces. The old targets ran ahead down -Z so the shot always faced
 * down the journey; here the journey has a destination, so the aim converges on
 * the entrance and then on the inside of the dome and simply stays there.
 *
 * The aim leads the lens through the swing. While the camera is arcing right to
 * get onto the tunnel axis, the target is already sitting on the mouth — so the
 * structure stays framed and the move reads as walking around to a door rather
 * than as the camera being flown somewhere.
 *
 * NO TWO POINTS ARE IDENTICAL, deliberately. The curve is centripetal
 * Catmull-Rom, which divides by the distance between consecutive points; a
 * repeated waypoint is a divide by zero and the whole path comes out NaN. Where
 * the aim is conceptually holding still it still creeps a unit or two.
 */
const TARGET_POINTS = [
  /* Level with the lens — see above — and nudged 3 units to the dome's right
     so the dome itself lands 2.4% left of frame centre, where the reference
     puts it, leaving the entrance the room it needs on the right. */
  /*
   * RAISED TO 42.8 WITH THE REFRAME. See the camera points above: the aim is
   * what sets the PITCH, and it is no longer the same thing as the subject.
   * Eleven units over the crown, which at 176 units out is 5.5 degrees of
   * downward pitch and drops the dome to 58% of frame height.
   */
  [-24.4, 42.8, 250], // 1  the hero framing
  /*
   * THE AIM BARELY MOVES, AND THAT IS THE ENTIRE SHOT.
   *
   * The old targets ran ahead of the camera down -Z so the lens always faced
   * along the journey. Here the journey has no ahead — it is a retreat — and
   * the one thing that must not happen is the igloo sliding out of frame while
   * the camera backs off. So the aim simply stays on the structure and creeps a
   * few units, which is what keeps it centred as the perspective changes.
   *
   * It rises very slightly, and only because the camera rises much faster: at
   * 150 units up the lens is looking down steeply, and letting the aim drift up
   * a little keeps some horizon in the frame instead of pitching into a plan
   * view of the snow.
   *
   * NO TWO POINTS ARE IDENTICAL. The curve is centripetal Catmull-Rom, which
   * divides by the distance between consecutive points; a repeated waypoint is
   * a divide by zero and the whole path comes out NaN. Where the aim is
   * conceptually holding still it still creeps.
   */
  [-25, 43.5, 250.5], // 1
  [-26, 45, 251], //     2
  [-27, 47, 251.5], //   2
  [-28, 50, 252], //     3
];

const toVec = (p) => new Vector3(p[0], p[1], p[2]);

/*
 * Centripetal Catmull-Rom.
 *
 * The default 'centripetal' parameterisation is the one that matters: with
 * uniform parameterisation, waypoints that are unevenly spaced — which these
 * deliberately are, because the acts have different lengths — make the curve
 * loop and overshoot between them. Centripetal is guaranteed not to form cusps
 * or self-intersections, which for a camera path is the difference between a
 * move and a lurch.
 */
export const CAMERA_CURVE = new CatmullRomCurve3(CAMERA_POINTS.map(toVec), false, 'centripetal');
export const TARGET_CURVE = new CatmullRomCurve3(TARGET_POINTS.map(toVec), false, 'centripetal');

/**
 * Where the character is at a given progress.
 *
 * Derived from the camera's target rather than authored separately, so he can
 * never drift out of frame — wherever the shot is pointing, he is a little
 * beyond it, walking away down the corridor. Authoring a third path would mean
 * keeping three things in sync by hand and losing that guarantee.
 */
export function characterPosition(progress, out = new Vector3()) {
  TARGET_CURVE.getPointAt(Math.min(1, Math.max(0, progress)), out);
  out.z -= 16;
  out.x *= 0.35;
  return out;
}
