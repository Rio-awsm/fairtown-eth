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
  plugins: [react(), tailwindcss()],
  server: { port: 8080, allowedHosts: TUNNEL_HOSTS },
  preview: { allowedHosts: TUNNEL_HOSTS },
  build: {
    rollupOptions: {
      output: { manualChunks: { phaser: ["phaser"] } },
      onwarn(warning, warn) {
        // zod 4.6.7 places @__PURE__ comments where Rollup cannot use them. Harmless; see NOTES.md.
        if (warning.code === "INVALID_ANNOTATION" && warning.id?.includes("/zod/")) return
        warn(warning)
      },
    },
    // Phaser alone is about 1.7 MB minified; it loads only on /town and /board.
    chunkSizeWarningLimit: 1800,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
})
