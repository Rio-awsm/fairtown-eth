import * as THREE from "three"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"

/**
 * One finishing pass. Tilt-shift: a sharp band through the middle of the view, blurring towards
 * the top and bottom, which makes a real city read as a miniature (a 12-tap disc). Then a soft
 * vignette and a whisper of film grain, so the dark ground never looks flat.
 */
const Finish = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    texel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
    focus: { value: 0.5 },
    band: { value: 0.2 },
    amount: { value: 0 },
    time: { value: 0 },
    grain: { value: 0.014 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 texel;
    uniform float focus;
    uniform float band;
    uniform float amount;
    uniform float time;
    uniform float grain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = clamp(max(0.0, abs(vUv.y - focus) - band) / (0.5 - band), 0.0, 1.0);
      float r = d * amount;
      if (r > 0.01) {
        vec4 sum = c;
        for (int i = 0; i < 12; i++) {
          float a = float(i) * 0.5235988;
          float k = mod(float(i), 2.0) == 0.0 ? 1.0 : 2.2;
          sum += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * texel * r * k);
        }
        c = sum / 13.0;
      }
      float v = smoothstep(0.95, 0.35, distance(vUv, vec2(0.5, 0.5)));
      c.rgb *= mix(0.6, 1.0, v);
      c.rgb += (hash(vUv * 1000.0) - 0.5) * grain;
      gl_FragColor = c;
    }
  `,
}

export type Post = {
  composer: EffectComposer
  setSize(w: number, h: number): void
  tick(t: number, still: boolean): void
}

/** The finishing chain: scene, bloom (its blur at half size), one finishing pass, output. */
export function buildPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  quality: "high" | "low",
): Post {
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(960, 540), 0.85, 0.5, 0.78)
  // Bloom is soft by nature: its blur chain runs at half the size the composer hands it.
  const sized = bloom.setSize.bind(bloom)
  bloom.setSize = (w: number, h: number) => sized(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)))
  composer.addPass(bloom)
  const finish = new ShaderPass(Finish)
  finish.uniforms.amount!.value = quality === "high" ? 2.4 : 0
  composer.addPass(finish)
  composer.addPass(new OutputPass())
  return {
    composer,
    setSize(w, h) {
      composer.setSize(w, h)
      finish.uniforms.texel!.value = new THREE.Vector2(1 / w, 1 / h)
    },
    tick(t, still) {
      finish.uniforms.time!.value = still ? 0 : (t % 10000) / 1000
    },
  }
}
