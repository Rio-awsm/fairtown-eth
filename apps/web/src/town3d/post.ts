import * as THREE from "three"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import type { SceneLook } from "./theme"

/**
 * One finishing pass: a vignette and a whisper of film grain, so the ground never looks flat. The
 * tilt-shift blur of D-113 is gone (D-122): it made the town murky from across a room.
 */
const Finish = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    vignette: { value: 0.4 },
    time: { value: 0 },
    grain: { value: 0.012 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignette;
    uniform float time;
    uniform float grain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float v = smoothstep(0.95, 0.35, distance(vUv, vec2(0.5, 0.5)));
      c.rgb *= mix(1.0 - vignette, 1.0, v);
      c.rgb += (hash(vUv * 1000.0) - 0.5) * grain;
      gl_FragColor = c;
    }
  `,
}

export type Post = {
  composer: EffectComposer
  setSize(w: number, h: number): void
  setLook(look: SceneLook): void
  tick(t: number, still: boolean): void
}

/** The finishing chain: scene, bloom (its blur at half size), one finishing pass, output. */
export function buildPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Post {
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(960, 540), 1, 0.5, 0.75)
  // Bloom is soft by nature: its blur chain runs at half the size the composer hands it.
  const sized = bloom.setSize.bind(bloom)
  bloom.setSize = (w: number, h: number) => sized(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)))
  composer.addPass(bloom)
  const finish = new ShaderPass(Finish)
  composer.addPass(finish)
  composer.addPass(new OutputPass())
  return {
    composer,
    setSize(w, h) {
      composer.setSize(w, h)
    },
    setLook(look) {
      bloom.strength = look.bloom.strength
      bloom.radius = look.bloom.radius
      bloom.threshold = look.bloom.threshold
      finish.uniforms.vignette!.value = look.vignette
    },
    tick(t, still) {
      finish.uniforms.time!.value = still ? 0 : (t % 10000) / 1000
    },
  }
}
