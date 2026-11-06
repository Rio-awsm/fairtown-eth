import { readEnv } from "./env"

/** Parsed once at startup. An invalid VITE_* value throws EnvError here, before anything renders. */
export const env = readEnv(import.meta.env)
