import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

// VITE_* values live in the repo-root .env, next to every other service's env.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url))
// Phones reach the app through `pnpm tunnel` (HTTPS, which the camera needs). Vite blocks unknown host
// names, so allow Cloudflare quick-tunnel hosts.
const TUNNEL_HOSTS = [".trycloudflare.com"]

export default defineConfig({
  base: "/",
  envDir: repoRoot,
  // PUBLIC_WEB_URL (contract 4) is the public phone address for the walk-in QR; nothing secret.
  envPrefix: ["VITE_", "PUBLIC_WEB_URL"],
  plugins: [react(), tailwindcss()],
  server: { port: 8080, allowedHosts: TUNNEL_HOSTS },
  preview: { allowedHosts: TUNNEL_HOSTS },
  build: {
    rollupOptions: {
      output: { manualChunks: { three: ["three"] } },
      onwarn(warning, warn) {
        // zod 4.6.7 places @__PURE__ comments where Rollup cannot use them. Harmless; see NOTES.md.
        if (warning.code === "INVALID_ANNOTATION" && warning.id?.includes("/zod/")) return
        warn(warning)
      },
    },
    // three.js is about 700 kB minified; it loads only on /town.
    chunkSizeWarningLimit: 1800,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    // Unit tests must not depend on the developer's root .env (envDir above); the tunnel URL changes per run.
    env: { PUBLIC_WEB_URL: "" },
  },
})
