/**
 * Real damage on the kit bodies, as a shader patch rather than geometry. The bodies are a few
 * thousand triangles, so pushing vertices makes pyramids; the precedent is the zone tint in
 * `Car.tsx` — `onBeforeCompile`, a radial falloff around a point — and this does the same per
 * mark, from the packing in `damageUniforms.ts`, into every material of one instance:
 *
 * - a **dent** (bodywork) tilts the fragment normal into a cosine dish, darkens the albedo
 *   15 % toward the centre and cuts the clearcoat to a fifth, so the reflection breaks;
 * - a **scratch** (bodywork) is a thin streak along the panel's own horizontal, hashed for
 *   ragged, broken edges, showing bare metal — grey, rough, metallic — through the paint;
 * - a **crack** (glass, lamps) is Voronoi cells and a few spokes spreading from the point,
 *   their edges catching the light, fading out by the radius;
 * - a **missing** part is the whole zone, painted an unlit cavity colour that darkens toward
 *   the centre with a torn rim. Not a discard: the kit's shells have no floor, so a discarded
 *   hood seen from the map shows the road through the car.
 *
 * All of it is compared in the body's own frame — metres, nose +Z, up +Y — carried from the
 * vertex shader as `vCmBody`, so the same program serves the studio (where world *is* that
 * frame) and the map layer (where the car stands anywhere, mirrored, at mercator scale) with
 * the same uniforms and no per-frame bookkeeping. The patch composes over any
 * `onBeforeCompile` already on the material, which is how it stacks on the studio's tint.
 *
 * `strength` blends every effect from none to full for a before/after; `heat` swaps the
 * paint for a blue-to-red map of accumulated damage. Both are the marker's view state and
 * never reach the document.
 */
import * as THREE from 'three'
import { roles, type Role } from '../vehicles/load'
import type { V3 } from '../zones'
import { MAX_MARKS, type DamagePack } from './damageUniforms'

export type DamageUniforms = {
  uCmCount: { value: number }
  uCmPoints: { value: Float32Array }
  uCmRadii: { value: Float32Array }
  uCmSeverities: { value: Float32Array }
  uCmKinds: { value: Float32Array }
  uCmStrength: { value: number }
  uCmHeat: { value: number }
  /** the body's kit-to-metres scale, `PROPORTION[body]` */
  uCmScale: { value: THREE.Vector3 }
}

/** the cavity colour a missing part shows, sRGB, at its rim; it darkens to a third of this at the centre */
export const CAVITY: V3 = [0.2, 0.19, 0.18]

/** one set per body instance, shared by all of that instance's materials */
export function createDamageUniforms(scale: V3): DamageUniforms {
  return {
    uCmCount: { value: 0 },
    uCmPoints: { value: new Float32Array(MAX_MARKS * 3) },
    uCmRadii: { value: new Float32Array(MAX_MARKS) },
    uCmSeverities: { value: new Float32Array(MAX_MARKS) },
    uCmKinds: { value: new Float32Array(MAX_MARKS) },
    uCmStrength: { value: 1 },
    uCmHeat: { value: 0 },
    uCmScale: { value: new THREE.Vector3(...scale) },
  }
}

/** three.js uniforms are mutable by contract: writing .value is how the GPU sees the marks */
export function applyDamage(u: DamageUniforms, pack: DamagePack) {
  u.uCmCount.value = pack.count
  u.uCmPoints.value = pack.points
  u.uCmRadii.value = pack.radii
  u.uCmSeverities.value = pack.severities
  u.uCmKinds.value = pack.kinds
}

/** the view: how much of the damage shows, and whether the paint is the severity map instead */
export function applyView(u: DamageUniforms, strength: number, heatmap: boolean) {
  u.uCmStrength.value = strength
  u.uCmHeat.value = heatmap ? 1 : 0
}

/** which effects a material takes: bodywork dents and scratches, glass cracks, a wheel only goes missing */
const ROLE_CODE: Record<Role, number> = { paint: 0, trim: 0, plastic: 0, glass: 1, headlight: 1, taillight: 1, rim: 2, rubber: 2 }

/**
 * Where a mesh sits in its body, in the kit's units. The kit's nodes carry translations only
 * (a wheel at its arch, the SUV's spare on the tailgate), so the sum up to the instance root
 * is the whole transform; the root's own scale is `uCmScale`.
 */
export function nodeOffset(mesh: THREE.Object3D, root: THREE.Object3D): V3 {
  const off = new THREE.Vector3()
  for (let o: THREE.Object3D | null = mesh; o && o !== root; o = o.parent) off.add(o.position)
  return [off.x, off.y, off.z]
}

const PARS_VERTEX = /* glsl */ `
varying vec3 vCmBody;
varying vec3 vCmBodyN;
varying mat3 vCmToView;
uniform vec3 uCmOffset;
uniform vec3 uCmScale;`

const VERTEX = /* glsl */ `
vCmBody = (transformed + uCmOffset) * uCmScale;
vCmBodyN = normalize(objectNormal / uCmScale);
vCmToView = mat3(modelViewMatrix);`

const PARS_FRAGMENT = /* glsl */ `
#define CM_MAX ${MAX_MARKS}
varying vec3 vCmBody;
varying vec3 vCmBodyN;
varying mat3 vCmToView;
uniform vec3 uCmScale;
uniform int uCmCount;
uniform vec3 uCmPoints[CM_MAX];
uniform float uCmRadii[CM_MAX];
uniform float uCmSeverities[CM_MAX];
uniform float uCmKinds[CM_MAX];
uniform float uCmStrength;
uniform float uCmHeat;
uniform float uCmRole;
float cmHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 cmHash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
// blue, cyan, yellow, red: the severity map's scale
vec3 cmHeatColour(float h) {
  h = clamp(h, 0.0, 1.0);
  vec3 c = mix(vec3(0.16, 0.30, 0.95), vec3(0.10, 0.85, 0.90), smoothstep(0.0, 0.33, h));
  c = mix(c, vec3(0.98, 0.85, 0.15), smoothstep(0.33, 0.66, h));
  return mix(c, vec3(0.90, 0.12, 0.10), smoothstep(0.66, 1.0, h));
}`

/** after map_fragment: every mark's contribution to this fragment, then the albedo */
const MARKS = /* glsl */ `
float cmDish = 0.0;      // a dent: 1 at the centre, 0 at the rim
vec3 cmBend = vec3(0.0); // a dent: the normal's tilt, in the body frame
float cmScratch = 0.0;   // bare metal showing
float cmGroove = 0.0;    // the scratch's own shadow, just outside the metal
float cmCrack = 0.0;     // crack edges catching the light
float cmHole = 0.0;      // a missing part
float cmHoleT = 1.0;     // how far into the hole, 0 at the centre
float cmHeatSum = 0.0;
float cmHeatOn = uCmRole < 2.0 ? uCmHeat : 0.0;
{
  vec3 cmN = normalize(vCmBodyN);
  // the panel's own horizontal and vertical: across a hood or a roof, along everything else
  vec3 cmH = abs(cmN.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : normalize(cross(cmN, vec3(0.0, 1.0, 0.0)));
  vec3 cmV = cross(cmN, cmH);
  for (int i = 0; i < CM_MAX; i++) {
    if (i >= uCmCount) break;
    vec3 d = vCmBody - uCmPoints[i];
    float r = length(d);
    float R = uCmRadii[i];
    float k = uCmKinds[i];
    float sev = uCmSeverities[i];
    cmHeatSum += sev * (1.0 - smoothstep(0.0, R * 2.0, r));
    if (r >= R) continue;
    float t = r / R;
    vec2 p = vec2(dot(d, cmH), dot(d, cmV));
    // a missing panel takes bodywork and glass; a missing wheel takes the wheel and nothing else
    if ((k == 3.0 && uCmRole < 2.0) || (k == 4.0 && uCmRole == 2.0)) {
      float wobble = 0.06 * (cmHash(floor(p * 40.0)) - 0.5);
      cmHole = max(cmHole, 1.0 - smoothstep(0.97, 1.0, t + wobble));
      cmHoleT = min(cmHoleT, t);
    } else if (uCmRole == 0.0 && k == 1.0) {
      float dish = 0.5 * (1.0 + cos(3.14159265 * t));
      cmDish = max(cmDish, dish);
      // the tilt is kept modest: under a studio environment — bright above, dark below — a steep
      // lower lip mirrors the ceiling and the whole dish reads lighter, not deeper
      cmBend -= (d / max(r, 1e-4)) * sin(3.14159265 * t) * (0.15 + 0.25 * sev);
    } else if (uCmRole == 0.0 && k == 0.0) {
      // three ragged streaks of different lengths, the way a key or a wall leaves them
      for (int j = 0; j < 3; j++) {
        float fj = float(j);
        float y0 = (fj - 1.0) * 0.03 * (0.6 + 0.8 * cmHash(vec2(fj, float(i))));
        float width = 0.005 + 0.014 * cmHash(vec2(floor(p.x * 60.0) + fj * 9.0, float(i)));
        float ends = 1.0 - smoothstep(R * (0.4 + 0.45 * cmHash(vec2(fj + 3.0, float(i)))), R, abs(p.x));
        float gaps = step(0.15, cmHash(vec2(floor(p.x * 25.0) + 7.0 * fj, float(i))));
        float streak = (1.0 - smoothstep(width * 0.5, width, abs(p.y - y0))) * ends * gaps;
        cmScratch = max(cmScratch, streak);
        cmGroove = max(cmGroove, (1.0 - smoothstep(width, width * 2.2, abs(p.y - y0))) * ends * gaps - streak);
      }
    } else if (uCmRole == 1.0 && k == 2.0) {
      vec2 q = p / (R * 0.16);
      vec2 cell = floor(q);
      float f1 = 8.0;
      float f2 = 8.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 g = cell + vec2(float(x), float(y));
          vec2 o = g + cmHash2(g + float(i)) - q;
          float dist = dot(o, o);
          if (dist < f1) { f2 = f1; f1 = dist; } else if (dist < f2) { f2 = dist; }
        }
      }
      float edge = 1.0 - smoothstep(0.0, 0.05, sqrt(f2) - sqrt(f1));
      float spoke = 1.0 - smoothstep(0.0, 0.07, abs(fract(atan(q.y, q.x) * 1.1 + cmHash(vec2(float(i), 3.0))) - 0.5));
      cmCrack = max(cmCrack, max(edge, spoke * 0.8) * (1.0 - smoothstep(0.6, 1.0, t)) * sev);
    }
  }
}
cmDish *= uCmStrength;
cmBend *= uCmStrength;
cmScratch *= uCmStrength;
cmGroove *= uCmStrength;
cmCrack *= uCmStrength;
cmHole *= uCmStrength;
// the dish: 15 % darker toward the centre, and its upper wall in shadow whatever the scene's
// light does — a dent is mostly its shadow, and the tilted normal alone barely showed under the
// studio's near-uniform environment; the lower rim's highlight is what the tilt reflects
float cmShade = clamp(-cmBend.y * 3.0, 0.0, 1.0);
diffuseColor.rgb *= (1.0 - 0.15 * cmDish) * (1.0 - 0.55 * cmShade);
// bare metal in the streak, and its groove darker beside it, so it shows on light paint and dark
diffuseColor.rgb *= 1.0 - 0.5 * cmGroove;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.70, 0.71, 0.72), cmScratch);
diffuseColor.rgb = mix(diffuseColor.rgb, cmHeatColour(cmHeatSum), cmHeatOn);`

const ROUGHNESS = /* glsl */ `
roughnessFactor = mix(roughnessFactor, 0.6, cmScratch);
roughnessFactor = mix(roughnessFactor, 0.55, cmCrack);
roughnessFactor = mix(roughnessFactor, 0.85, cmHeatOn);`

const METALNESS = /* glsl */ `
metalnessFactor = mix(metalnessFactor, 0.85, cmScratch);
metalnessFactor = mix(metalnessFactor, 0.0, max(cmCrack, cmHeatOn));`

/** the tilt is a direction in body metres; through the model matrix it is the map's 1e-7 long, so it is renormalised */
const NORMAL = /* glsl */ `
if (dot(cmBend, cmBend) > 0.0) {
  vec3 cmTilt = normalize(vCmToView * (cmBend / uCmScale)) * length(cmBend);
  normal = normalize(normal + cmTilt);
  nonPerturbedNormal = normalize(nonPerturbedNormal + cmTilt);
}`

const EMISSIVE = /* glsl */ `
totalEmissiveRadiance += vec3(0.75, 0.80, 0.85) * cmCrack;`

const CLEARCOAT = /* glsl */ `
#ifdef USE_CLEARCOAT
material.clearcoat *= (1.0 - 0.8 * cmDish) * (1.0 - cmScratch) * (1.0 - cmHeatOn);
#endif`

/** after tone mapping and colour space, so the cavity is the cavity and not what the light makes of it */
const CAVITY_GLSL = /* glsl */ `
if (cmHole > 0.0) {
  vec3 cmCav = vec3(${CAVITY.join(', ')}) * (0.3 + 0.7 * cmHoleT * cmHoleT);
  cmCav = mix(cmCav, vec3(0.46, 0.44, 0.41), smoothstep(0.88, 0.95, cmHoleT));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, cmCav, cmHole);
}`

/**
 * Patch one material — already this instance's own, never the cached template's — with the
 * damage shader. `offset` is where the mesh sits in the body (`nodeOffset`); `role` picks
 * which effects the material takes.
 */
export function patchDamage(material: THREE.Material, u: DamageUniforms, role: Role, offset: V3) {
  const uCmOffset = { value: new THREE.Vector3(...offset) }
  const uCmRole = { value: ROLE_CODE[role] }
  const before = material.onBeforeCompile
  const key = material.customProgramCacheKey()
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer)
    Object.assign(shader.uniforms, u, { uCmOffset, uCmRole })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${PARS_VERTEX}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${VERTEX}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${PARS_FRAGMENT}`)
      .replace('#include <map_fragment>', `#include <map_fragment>${MARKS}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>${ROUGHNESS}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>${METALNESS}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>${NORMAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>${EMISSIVE}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>${CLEARCOAT}`)
      .replace('#include <colorspace_fragment>', `#include <colorspace_fragment>${CAVITY_GLSL}`)
  }
  material.customProgramCacheKey = () => `${key}|cm-damage`
}

/**
 * Every material of one body instance cloned and patched with `u` — the cached template's
 * materials are never touched, and two instances never share a uniform. `dress` runs on each
 * clone first: the marker's zone tint, which the damage patch then composes over.
 */
export function patchInstance(root: THREE.Object3D, u: DamageUniforms, dress?: (material: THREE.Material) => void) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const r = roles(mesh)
    const offset = nodeOffset(mesh, root)
    const own = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m, i) => {
      const c = m.clone()
      dress?.(c)
      patchDamage(c, u, r[i] ?? 'trim', offset)
      return c
    })
    mesh.material = Array.isArray(mesh.material) ? own : own[0]
  })
}
