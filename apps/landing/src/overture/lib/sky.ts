import { Color, GLSL3, Mesh, PlaneGeometry, ShaderMaterial } from "three";
import { PALETTE } from "./palette.js";

/**
 * THE SKY — a backdrop gradient, drawn before everything else.
 *
 * WHY THIS EXISTS. A dark landform against a cleared black buffer is not a silhouette,
 * it is nothing: the unlit parts of a ridge are the same value as the void behind them,
 * so the shape only appears where a light happens to touch it and the frame reads as a
 * few glowing streaks floating in a vacuum. Every one of these scenes lost its landscape
 * that way before this was added. Giving the void a hue, and a vertical gradient, is
 * what turns "black" into "night" — and a ridge you cannot see the lit side of still
 * reads, because it is darker than the sky it cuts into.
 *
 * The gradient is violet at the top and navy near the horizon, which is the palette's
 * ramp rule applied to the largest surface in the frame: deep tones go violet.
 *
 * Drawn as a fullscreen quad with depth testing off and a very negative render order,
 * so it is always behind and never occludes. Not `scene.background`, because a flat
 * background colour cannot carry a gradient and a cube texture is six images to load
 * for what is two colours and a mix.
 */
export function makeSky(opts?: { top?: Color; horizon?: Color; power?: number }): {
  mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  dispose(): void;
} {
  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTop: { value: opts?.top ?? PALETTE.abyss.clone().lerp(PALETTE.violet, 0.10) },
      uHorizon: { value: opts?.horizon ?? PALETTE.abyss.clone().lerp(PALETTE.navy, 0.62) },
      uPower: { value: opts?.power ?? 2.1 },
    },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec2 vUv;
      out vec4 fragColor;
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform float uPower;
      void main(){
        // Weighted toward the horizon, not linear. A straight lerp puts the midpoint
        // halfway up the frame, where it reads as a visible band; the power curve keeps
        // most of the sky dark and concentrates the lift into the last stretch above
        // the ground, which is where a real night sky actually brightens.
        float g = pow(1.0 - clamp(vUv.y, 0.0, 1.0), uPower);
        fragColor = vec4(mix(uTop, uHorizon, g), 1.0);
      }
    `,
  });

  const geo = new PlaneGeometry(2, 2);
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;

  return {
    mesh,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
