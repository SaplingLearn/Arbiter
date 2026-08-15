import { AdditiveBlending, Color, GLSL3, Mesh, PlaneGeometry, ShaderMaterial } from "three";

/**
 * The volume of scattered light around an emitter, as a camera-facing billboard.
 *
 * A scaled backside box was tried first and it is wrong: the fresnel term peaks on the
 * faces seen edge-on, so a scaled cube renders its four sides as a hard bright FRAME
 * around the object. It read as a picture border. A radial billboard has no edges to
 * catch, which is what a volume of scattered light actually looks like.
 */

const VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  // Billboard: strip the rotation out of the model-view matrix so the quad always faces
  // the camera however the camera arcs.
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
in vec2 vUv;
uniform vec3 uGlow;
uniform float uTime;
out vec4 fragColor;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;

  // Two falloffs summed: a tight core that reads as the object's own light, and a very
  // wide soft one that is really atmospheric haze. One exponent alone gives either a
  // hard disc or a grey wash.
  float hot = exp(-d * d * 11.0);
  float wide = exp(-d * d * 2.6) * 0.16;
  float breath = 0.9 + 0.1 * sin(uTime * 0.55);

  float al = (hot + wide) * breath;
  fragColor = vec4(uGlow * al, al);
}
`;

export type Glow = {
  mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  material: ShaderMaterial;
  dispose(): void;
};

export function makeGlow(size: number, color: Color): Glow {
  const geo = new PlaneGeometry(size, size);
  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uGlow: { value: color } },
  });
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = -1;
  return {
    mesh,
    material: mat,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
