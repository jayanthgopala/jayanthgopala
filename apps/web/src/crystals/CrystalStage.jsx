import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, MeshTransmissionMaterial } from '@react-three/drei';
import { EffectComposer, Bloom, ToneMapping, Vignette, ChromaticAberration } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { BackSide, CanvasTexture, Color, FogExp2, SRGBColorSpace, Vector2, Vector3, WireframeGeometry } from 'three';
import { makeCrystalGeometry, makePlexus } from './crystal-geometry.js';
import { makeEmblemGeometry } from './emblem-geometry.js';
import { getFrost } from './frost.js';
import { clamp, damp, easeInOut, easeOutCubic, hashString, makeRng, smoothstep } from './util.js';

/**
 * The crystal room: one ice crystal per project, stacked down the Y axis, with
 * the camera travelling down the stack as the page scrolls — so each crystal
 * rises up through the frame and the next one rises in from below, which is
 * how igloo.inc's portfolio moves.
 *
 * Everything here reads one shared ref owned by CrystalSite. Nothing that
 * changes per frame goes through React state.
 */

/** World units between crystals. */
export const SPACING = 7;

const ACCENTS = {
  iris: '#6E7BFF',
  violet: '#A78BFA',
  mint: '#63D2C3',
  amber: '#F5B45C',
  rose: '#E86A8A',
};

/* Scene-referred values: the ACES pass at the end of the chain lifts ~0.2
   linear to the pale grey the reference room sits at. */
const FOG = new Color().setRGB(0.235, 0.244, 0.265);
const NAVY = new Color().setRGB(0.012, 0.016, 0.028);

/* ── Backdrop ─────────────────────────────────────────────────────────────
   A sphere that travels with the camera: pale cool gradient, a soft lift
   behind the subject, a faint screen-space dot grid, and — while a project is
   open — a grade down to the navy of being inside the ice. */

const BACKDROP_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BACKDROP_FRAG = /* glsl */ `
  uniform float uDark;
  varying vec3 vDir;
  void main() {
    float h = vDir.y * 0.5 + 0.5;
    vec3 col = mix(vec3(0.205, 0.214, 0.235), vec3(0.300, 0.310, 0.335), smoothstep(0.15, 0.85, h));
    float front = max(0.0, -vDir.z);
    col += vec3(0.075, 0.077, 0.082) * pow(front, 5.0);
    vec2 g = mod(gl_FragCoord.xy, 28.0) - 14.0;
    col += (1.0 - smoothstep(0.7, 1.4, length(g))) * 0.03;
    vec3 navy = vec3(0.012, 0.016, 0.028) * (1.0 + pow(front, 3.0));
    gl_FragColor = vec4(mix(col, navy, uDark), 1.0);
  }
`;

function Backdrop({ shared }) {
  const ref = useRef(null);
  const uniforms = useMemo(() => ({ uDark: { value: 0 } }), []);
  useFrame(({ camera }) => {
    ref.current.position.copy(camera.position);
    uniforms.uDark.value = easeInOut(shared.current.detail);
  });
  return (
    <mesh ref={ref} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[80, 32, 16]} />
      <shaderMaterial
        side={BackSide}
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={BACKDROP_VERT}
        fragmentShader={BACKDROP_FRAG}
      />
    </mesh>
  );
}

/* ── Camera ───────────────────────────────────────────────────────────────
   The damping is the weight: the rig chases the scroll position rather than
   equalling it, so the stack coasts into place. Opening a project pushes the
   lens into the crystal and the room goes dark around it. */

function Rig({ shared }) {
  const { camera, scene } = useThree();
  const lean = useRef({ x: 0, y: 0 });
  const look = useMemo(() => new Vector3(), []);

  useEffect(() => {
    scene.fog = new FogExp2(FOG.clone(), 0.028);
    return () => {
      scene.fog = null;
    };
  }, [scene]);

  useFrame((state, delta) => {
    const s = shared.current;
    const dt = Math.min(delta, 1 / 20);
    s.f = damp(s.f, s.fTarget, 4.2, dt);
    s.detail = damp(s.detail, s.detailTarget, 2.4, dt);
    /* Wall clock, not summed dt: dt is clamped for the damping, and summing
       clamped deltas makes a timeline crawl on a slow or throttled frame loop. */
    if (s.started) {
      if (!s.introAt) s.introAt = performance.now();
      s.intro = Math.min(1, (performance.now() - s.introAt) / 1900);
    }

    lean.current.x = damp(lean.current.x, state.pointer.x, 2.6, dt);
    lean.current.y = damp(lean.current.y, state.pointer.y, 2.6, dt);

    const push = easeInOut(s.detail);
    const free = 1 - push;
    const y = -s.f * SPACING;
    camera.position.set(lean.current.x * 0.5 * free, y + lean.current.y * 0.3 * free, 10.5 - 5.6 * push);
    look.set(lean.current.x * 0.15 * free, y, 0);
    camera.lookAt(look);

    scene.fog.color.copy(FOG).lerp(NAVY, push);
    scene.environmentIntensity = 1 - 0.75 * push;
  });

  return null;
}

/* ── One crystal ──────────────────────────────────────────────────────────── */

function CrystalUnit({ project, index, shared, small }) {
  const seed = useMemo(
    () => hashString(project.slug || project.title || String(index)),
    [project.slug, project.title, index]
  );
  const geo = useMemo(() => makeCrystalGeometry(seed), [seed]);
  const wire = useMemo(() => new WireframeGeometry(geo), [geo]);
  const emblem = useMemo(() => makeEmblemGeometry(seed), [seed]);
  const plexus = useMemo(() => makePlexus(seed), [seed]);
  const frost = getFrost();
  const accent = ACCENTS[project.accent] || ACCENTS.iris;

  useEffect(
    () => () => {
      geo.dispose();
      wire.dispose();
      emblem.dispose();
      plexus.lines.dispose();
      plexus.dots.dispose();
    },
    [geo, wire, emblem, plexus]
  );

  const outer = useRef(null);
  const spin = useRef(null);
  const core = useRef(null);
  const web = useRef(null);
  const wireMat = useRef(null);
  const lineMat = useRef(null);
  const dotMat = useRef(null);
  const hover = useRef(0);

  /* Registered so the label projector can find the active crystal. */
  useEffect(() => {
    const units = shared.current.units;
    units[index] = { outer: outer.current, spin: spin.current };
    return () => {
      delete units[index];
    };
  }, [index, shared]);

  useFrame((state, delta) => {
    const s = shared.current;
    const dt = Math.min(delta, 1 / 20);
    const t = state.clock.elapsedTime;
    const d = s.f - index;
    const ad = Math.abs(d);
    const ie = easeOutCubic(s.intro);

    /* Rises out of the fog on arrival; turns as it passes through the frame. */
    outer.current.position.y = -index * SPACING + Math.sin(t * 0.55 + index * 1.3) * 0.09 - (1 - ie) * 3.2;
    spin.current.rotation.set(
      Math.sin(t * 0.31 + index) * 0.07,
      t * 0.14 + index * 1.9 + d * 1.5,
      d * 0.24 + Math.sin(t * 0.42 + index) * 0.04
    );
    core.current.rotation.y = -t * 0.3;
    core.current.rotation.x = Math.sin(t * 0.5 + index) * 0.2;
    web.current.rotation.y = t * 0.04 + index;

    hover.current = damp(hover.current, s.hoverIndex === index ? 1 : 0, 7, dt);
    const calm = 1 - smoothstep(0, 0.35, s.detail);
    wireMat.current.opacity = hover.current * 0.3 * calm;

    /* The web draws round the crystal as it arrives and unwinds as it leaves. */
    const reveal = (1 - smoothstep(0.08, 0.5, ad)) * calm * ie;
    plexus.lines.setDrawRange(0, Math.floor(plexus.segments * reveal) * 2);
    lineMat.current.opacity = 0.5 * reveal;
    dotMat.current.opacity = 0.85 * reveal;
  });

  const canExplore = () => {
    const s = shared.current;
    return Math.abs(s.f - index) < 0.3 && s.detailTarget === 0 && s.intro > 0.6;
  };
  const enter = (e) => {
    e.stopPropagation();
    if (!canExplore()) return;
    shared.current.hoverIndex = index;
    document.body.style.cursor = 'pointer';
  };
  const leave = () => {
    if (shared.current.hoverIndex === index) shared.current.hoverIndex = -1;
    document.body.style.cursor = '';
  };

  return (
    <group ref={outer} position={[0, -index * SPACING, 0]}>
      <group ref={spin} scale={1.2}>
        <mesh
          geometry={geo}
          onPointerOver={enter}
          onPointerMove={enter}
          onPointerOut={leave}
          onClick={(e) => {
            e.stopPropagation();
            if (canExplore()) shared.current.onExplore?.(index);
          }}
        >
          <MeshTransmissionMaterial
            samples={small ? 4 : 6}
            resolution={small ? 256 : 512}
            backside
            backsideThickness={0.3}
            thickness={0.9}
            ior={1.31}
            chromaticAberration={0.06}
            anisotropicBlur={0.12}
            distortion={0.22}
            distortionScale={0.4}
            temporalDistortion={0.03}
            roughness={1}
            roughnessMap={frost.rough}
            normalMap={frost.normal}
            normalScale={[0.35, 0.35]}
            clearcoat={0.5}
            clearcoatRoughness={0.15}
            color="#f7f9fc"
            attenuationColor="#f1f4f8"
            attenuationDistance={8}
          />
        </mesh>
        <lineSegments geometry={wire}>
          <lineBasicMaterial ref={wireMat} color="#ffffff" transparent opacity={0} depthWrite={false} />
        </lineSegments>
        <mesh ref={core} geometry={emblem}>
          <meshStandardMaterial
            color="#d6dce6"
            roughness={0.4}
            metalness={0.3}
            emissive={accent}
            emissiveIntensity={0.14}
          />
        </mesh>
      </group>
      <group ref={web}>
        <lineSegments geometry={plexus.lines}>
          <lineBasicMaterial ref={lineMat} color="#ffffff" transparent opacity={0} depthWrite={false} />
        </lineSegments>
        <points geometry={plexus.dots}>
          <pointsMaterial ref={dotMat} color="#ffffff" size={0.05} transparent opacity={0} depthWrite={false} />
        </points>
      </group>
    </group>
  );
}

/**
 * Only the crystals near the lens are mounted. Each transmission material
 * renders the scene into its own buffer every frame, so a stack of eight
 * mounted at once would be eight extra scene renders for crystals nobody can see.
 */
function Crystals({ projects, shared, small }) {
  const last = projects.length - 1;
  const [range, setRange] = useState([0, Math.min(1, last)]);
  const key = useRef(`0-${Math.min(1, last)}`);

  useFrame(() => {
    const f = shared.current.f;
    const lo = clamp(Math.ceil(f - 1.35), 0, last);
    const hi = clamp(Math.floor(f + 1.35), 0, last);
    const k = `${lo}-${hi}`;
    if (k !== key.current) {
      key.current = k;
      setRange([lo, hi]);
    }
  });

  const out = [];
  for (let i = range[0]; i <= Math.min(range[1], last); i += 1) {
    out.push(
      <CrystalUnit key={projects[i].slug ?? projects[i].id ?? i} project={projects[i]} index={i} shared={shared} small={small} />
    );
  }
  return out;
}

/* ── Blurred data text at depth ───────────────────────────────────────────
   The reference's big out-of-focus mono lines behind the crystal. Drawn to a
   canvas in a system mono font and blurred there, so no font file is fetched
   and no depth-of-field pass is needed. */

function veilTexture(text) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = '600 72px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.font = font;
  canvas.width = Math.min(2048, Math.ceil(ctx.measureText(text).width) + 80);
  canvas.height = 160;
  ctx.font = font;
  ctx.filter = 'blur(6px)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 40, 80);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return { tex, aspect: canvas.width / canvas.height };
}

const CODES = ['DATA 00 001 22', 'PRE LOAD OFF', 'SIG STABLE', 'NODE 04 / 12', 'TRACE ON', 'BUILD PASS'];

function DataVeil({ projects }) {
  const items = useMemo(() => {
    const rand = makeRng(hashString(projects.map((p) => p.slug).join('|')) || 7);
    const list = [];
    projects.forEach((p, i) => {
      const strings = [
        `PRJ_${String(i + 1).padStart(2, '0')} ${(p.title || '').toUpperCase()}`,
        (p.tech || []).slice(0, 4).join('  ').toUpperCase(),
        CODES[i % CODES.length],
      ].filter(Boolean);
      strings.forEach((text, k) => {
        const side = (k + i) % 2 ? 1 : -1;
        list.push({
          text,
          x: side * (2.6 + rand() * 4),
          y: -i * SPACING + (rand() - 0.5) * 5,
          z: -4.5 - rand() * 9,
          h: 0.5 + rand() * 0.35,
          o: 0.16 + rand() * 0.16,
          ...veilTexture(text),
        });
      });
    });
    return list;
  }, [projects]);

  useEffect(() => () => items.forEach((it) => it.tex.dispose()), [items]);

  const group = useRef(null);
  useFrame(({ clock }) => {
    group.current.children.forEach((m, i) => {
      m.position.x = items[i].x + Math.sin(clock.elapsedTime * 0.05 + i) * 0.4;
    });
  });

  return (
    <group ref={group}>
      {items.map((it, i) => (
        <mesh key={i} position={[it.x, it.y, it.z]} scale={[it.h * it.aspect, it.h, 1]}>
          <planeGeometry />
          <meshBasicMaterial map={it.tex} transparent opacity={it.o} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/* ── Leader-line labels ───────────────────────────────────────────────────
   DOM text pinned to points on the active crystal. Anchors live on the
   non-spinning group so the lines track the crystal's float and travel
   without whipping round as it turns. `o` is where the label attaches,
   in screen pixels from the anchor. */

const ANCHORS = [
  { p: [-0.72, 1.35, 0.4], o: [-70, -60] },
  { p: [0.86, 0.55, 0.4], o: [84, -30] },
  { p: [0.7, -1.0, 0.4], o: [72, 52] },
];

function Labels({ shared, count }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const s = shared.current;
    const L = s.labels;
    if (!L?.wrap) return;
    const a = clamp(Math.round(s.f), 0, count - 1);
    const unit = s.units[a];
    const vis = unit
      ? (1 - smoothstep(0.1, 0.32, Math.abs(s.f - a))) *
        (1 - smoothstep(0, 0.25, s.detail)) *
        smoothstep(0.55, 1, s.intro)
      : 0;
    L.wrap.style.opacity = vis.toFixed(3);
    if (!unit || vis <= 0) return;

    ANCHORS.forEach((anchor, k) => {
      v.set(anchor.p[0], anchor.p[1], anchor.p[2]);
      unit.outer.localToWorld(v);
      v.project(camera);
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      const ax = x + anchor.o[0];
      const ay = y + anchor.o[1];
      const el = L.labels[k];
      if (el) el.style.transform = `translate3d(${ax.toFixed(1)}px, ${ay.toFixed(1)}px, 0)`;
      const line = L.lines[k];
      if (line) {
        line.setAttribute('x1', x.toFixed(1));
        line.setAttribute('y1', y.toFixed(1));
        line.setAttribute('x2', ax.toFixed(1));
        line.setAttribute('y2', ay.toFixed(1));
      }
    });

    /* A live readout, the way the reference's TEMP figures tick: the
       crystal's own heading, in degrees. */
    if (L.rot && unit.spin) {
      const deg = (((unit.spin.rotation.y * 180) / Math.PI) % 360 + 360) % 360;
      L.rot.textContent = deg.toFixed(2);
    }
  });

  return null;
}

/* ── Lens ─────────────────────────────────────────────────────────────────
   Colour fringing on fast scrolls and through the open/close dissolve. The
   offset Vector2 is mutated in place, as in the world's TravelFringe. */

function Fringe({ shared }) {
  const ref = useRef(null);
  const initial = useMemo(() => new Vector2(0, 0), []);
  const scratch = useMemo(() => new Vector2(), []);
  useFrame((state) => {
    const e = ref.current;
    if (!e) return;
    const s = shared.current;
    const v = Math.min(1, Math.abs(s.velocity) * 2.2);
    const bump = 4 * s.detail * (1 - s.detail);
    const px = (v * v * 6 + bump * 14) / state.gl.getDrawingBufferSize(scratch).x;
    e.offset.set(px, px * 0.55);
  });
  return <ChromaticAberration ref={ref} offset={initial} radialModulation modulationOffset={0.25} />;
}

export default function CrystalStage({ projects, shared }) {
  const small = typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches;
  const count = projects.length;

  return (
    <div className="c-stage">
      <Canvas
        dpr={[1, 1.75]}
        camera={{ fov: 32, near: 0.5, far: 200, position: [0, 0, 10.5] }}
        gl={{ antialias: true, powerPreference: 'high-performance', alpha: false, stencil: false }}
      >
        <Backdrop shared={shared} />
        <Rig shared={shared} />

        <ambientLight intensity={0.35} />
        <directionalLight position={[3, 6, 7]} intensity={1.6} color="#f4f7fb" />
        <directionalLight position={[-5, -2, 3]} intensity={0.5} color="#b9c8dc" />

        {/* Composed from emissive panels, not a downloaded HDRI — the same
            approach the world's first environment used. The long vertical
            strips are what put crisp highlights down the crystal facets. */}
        <Environment resolution={256} frames={1}>
          <color attach="background" args={['#7a808a']} />
          <Lightformer form="rect" intensity={2.4} color="#ffffff" scale={[14, 7, 1]} position={[0, 7, -2]} rotation-x={Math.PI / 2} />
          <Lightformer form="rect" intensity={3.2} color="#eef4ff" scale={[0.8, 12, 1]} position={[-6, 0, 3]} rotation-y={Math.PI / 2} />
          <Lightformer form="rect" intensity={2.6} color="#ffffff" scale={[0.8, 12, 1]} position={[6, 0, 1]} rotation-y={-Math.PI / 2} />
          <Lightformer form="ring" intensity={1.4} color="#dfe8f5" scale={5} position={[0, -1, -9]} />
        </Environment>

        {count > 0 && <Crystals projects={projects} shared={shared} small={small} />}
        {count > 0 && <DataVeil projects={projects} />}
        {count > 0 && <Labels shared={shared} count={count} />}

        <EffectComposer multisampling={4}>
          <Bloom intensity={0.55} luminanceThreshold={0.86} luminanceSmoothing={0.25} mipmapBlur />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Vignette offset={0.28} darkness={0.55} eskil={false} />
          <Fringe shared={shared} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
