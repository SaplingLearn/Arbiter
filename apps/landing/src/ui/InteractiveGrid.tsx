import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * The interactive dot grid behind the hero.
 *
 * VENDORED FROM framer.com/m/Interactive-Grid-eYMeUf.js@7mMtAh3TW7ebk5DN8y9P
 * (its internal name is Dot_Background), and transcribed rather than imported.
 * Like GooglyEyes and unlike the two canvas components, its only Framer dependency
 * is `addPropertyControls`/`ControlType` - the editor panel, inert outside Framer -
 * so the import would have resolved. Transcribing avoids a runtime request to
 * framerusercontent.com on every page load and a `framer` dependency pulled in for
 * two symbols that do nothing here.
 *
 * THE SHADERS, THE GEOMETRY AND THE INTERACTION MATHS ARE THE ORIGINAL'S, verbatim:
 * the four deformation styles, the exp(-x²) falloff, the raycast onto an invisible
 * hit plane, the parallax tilt, the fade in and out of the hover state.
 *
 * IT COSTS THREE.JS, which is the honest price of using it and the reason
 * `Hero.tsx` loads this file with a dynamic import. Three is ~170KB gzipped, over
 * twice the rest of the page put together; code-split, it never delays first paint
 * and a reader on a slow connection gets the whole page while the decoration is
 * still arriving.
 */

export type InteractionStyle = "Pull" | "Push" | "Twist" | "Lens";

export type InteractiveGridProps = {
  /** World-space extent of the grid. */
  gridSize?: number;
  /** Points per side. The mesh is (density + 1)² vertices. */
  density?: number;
  dotColor?: string;
  lineColor?: string;
  dotSize?: number;
  lineOpacity?: number;
  interactionStyle?: InteractionStyle;
  /** World-space radius of the cursor's influence. */
  radius?: number;
  strength?: number;
  className?: string;
};

const STYLE_INDEX: Record<InteractionStyle, number> = { Pull: 0, Push: 1, Twist: 2, Lens: 3 };

export function InteractiveGrid({
  gridSize = 8000,
  density = 160,
  dotColor = "#2B2BF0",
  lineColor = "#DEDEDA",
  dotSize = 3,
  lineOpacity = 0.3,
  interactionStyle = "Lens",
  radius = 600,
  strength = 200,
  className = "",
}: InteractiveGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let w = container.clientWidth;
    let h = container.clientHeight;
    if (w === 0 || h === 0) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, w / h, 1, 15000);
    camera.position.z = 1000;

    // alpha:true so the paper behind shows through. The original painted a radial
    // gradient onto its own container; BLUEPRINT has no gradients, so the section's
    // flat ground is left to do that job.
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    // Cartesian lattice, then horizontal and vertical index pairs for the lines.
    const pts: number[] = [];
    const indices: number[] = [];
    const n = Math.floor(density);
    const half = gridSize / 2;
    for (let y = 0; y <= n; y++) {
      for (let x = 0; x <= n; x++) {
        pts.push((x / n) * gridSize - half, (y / n) * gridSize - half, 0);
      }
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = x + y * (n + 1);
        indices.push(i, i + 1, i, i + (n + 1));
      }
    }
    // The loop above stops one short on each axis; these close the far edges.
    for (let y = 0; y < n; y++) indices.push(n + y * (n + 1), n + (y + 1) * (n + 1));
    for (let x = 0; x < n; x++) indices.push(x + n * (n + 1), x + 1 + n * (n + 1));

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    geometry.setIndex(indices);

    const vertexShader = `
      uniform vec2 u_mouse;
      uniform float u_radius;
      uniform float u_strength;
      uniform float u_mouseActive;
      uniform int u_style;
      void main() {
        vec3 pos = position;
        vec2 dir = pos.xy - u_mouse;
        float dist = length(dir);
        float falloff = exp(-pow(dist / (u_radius * 0.4), 2.0));

        if (u_mouseActive > 0.0) {
          if (u_style == 0) {                       // PULL
            pos.z += falloff * u_strength * 1.5 * u_mouseActive;
            pos.xy -= dir * (falloff * 0.15) * u_mouseActive;
          } else if (u_style == 1) {                // PUSH
            pos.z -= falloff * u_strength * 1.5 * u_mouseActive;
            pos.xy += dir * (falloff * 0.15) * u_mouseActive;
          } else if (u_style == 2) {                // TWIST
            float angle = falloff * u_strength * 0.005 * u_mouseActive;
            float c = cos(angle);
            float s = sin(angle);
            pos.xy = u_mouse + mat2(c, -s, s, c) * dir;
            pos.z += falloff * u_strength * 0.5 * u_mouseActive;
          } else if (u_style == 3) {                // LENS
            pos.z += falloff * u_strength * 2.5 * u_mouseActive;
            pos.xy += dir * (falloff * 0.35) * u_mouseActive;
          }
        }

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);

        float baseSize = ${dotSize.toFixed(1)};
        float sizeMod = 0.0;
        if (u_style == 0 || u_style == 2) sizeMod = falloff * baseSize * 1.5;
        else if (u_style == 1) sizeMod = -falloff * baseSize * 0.5;
        else if (u_style == 3) sizeMod = falloff * baseSize * 3.0;
        gl_PointSize = max(0.1, baseSize + (sizeMod * u_mouseActive));
      }
    `;
    const fragmentShader = `
      uniform vec3 u_color;
      uniform float u_opacity;
      void main() {
        #ifdef IS_POINT
        if (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;
        #endif
        gl_FragColor = vec4(u_color, u_opacity);
      }
    `;

    const base = {
      u_mouse: { value: new THREE.Vector2(0, 0) },
      u_radius: { value: radius },
      u_strength: { value: strength },
      u_mouseActive: { value: 0 },
      u_style: { value: STYLE_INDEX[interactionStyle] },
    };
    const matLines = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { ...base, u_color: { value: new THREE.Color(lineColor) }, u_opacity: { value: lineOpacity } },
      transparent: true,
      depthWrite: false,
    });
    const matPoints = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: `#define IS_POINT\n${fragmentShader}`,
      uniforms: { ...base, u_color: { value: new THREE.Color(dotColor) }, u_opacity: { value: 1 } },
      transparent: true,
      depthWrite: false,
    });

    group.add(new THREE.LineSegments(geometry, matLines));
    group.add(new THREE.Points(geometry, matPoints));

    // The group tilts with the cursor, so screen coordinates no longer map to grid
    // coordinates. An invisible plane inside the group gives the raycaster something
    // to hit that tilts with it.
    const hitGeometry = new THREE.PlaneGeometry(gridSize * 2, gridSize * 2);
    const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
    const hitPlane = new THREE.Mesh(hitGeometry, hitMaterial);
    group.add(hitPlane);

    const raycaster = new THREE.Raycaster();
    const mouseNDC = new THREE.Vector2(-999, -999);
    let hovering = false;
    let active = 0;

    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouseNDC.x = ((e.clientX - rect.left) / w) * 2 - 1;
      mouseNDC.y = -((e.clientY - rect.top) / h) * 2 + 1;
      hovering = true;
    };
    const onMouseLeave = () => {
      hovering = false;
    };
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseleave", onMouseLeave);

    let frame = 0;
    const clock = new THREE.Clock();
    const draw = (): void => {
      const delta = clock.getDelta();

      active += ((hovering ? 1 : 0) - active) * 10 * delta;
      matLines.uniforms["u_mouseActive"]!.value = active;
      matPoints.uniforms["u_mouseActive"]!.value = active;

      const targetX = hovering ? mouseNDC.y * 0.15 : 0;
      const targetY = hovering ? mouseNDC.x * 0.15 : 0;
      group.rotation.x += (targetX - group.rotation.x) * 5 * delta;
      group.rotation.y += (targetY - group.rotation.y) * 5 * delta;

      if (active > 0.01) {
        raycaster.setFromCamera(mouseNDC, camera);
        const hit = raycaster.intersectObject(hitPlane)[0];
        if (hit) {
          const local = group.worldToLocal(hit.point.clone());
          const u = matLines.uniforms["u_mouse"]!.value as THREE.Vector2;
          u.lerp(new THREE.Vector2(local.x, local.y), 12 * delta);
          (matPoints.uniforms["u_mouse"]!.value as THREE.Vector2).copy(u);
        }
      }

      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    draw();

    const onResize = (): void => {
      if (!containerRef.current) return;
      w = containerRef.current.clientWidth;
      h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseleave", onMouseLeave);
      geometry.dispose();
      matLines.dispose();
      matPoints.dispose();
      hitGeometry.dispose();
      hitMaterial.dispose();
      // Without this the browser keeps the WebGL context alive, and there is a hard
      // per-page limit on those - StrictMode's mount/unmount/mount alone would burn
      // two.
      renderer.dispose();
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
    };
  }, [gridSize, density, dotColor, lineColor, dotSize, lineOpacity, interactionStyle, radius, strength]);

  return <div ref={containerRef} className={className} aria-hidden="true" />;
}

export default InteractiveGrid;
