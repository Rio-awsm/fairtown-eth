import { env } from "../config"
import { createApiClient } from "./apiClient"

// Mock mode serves the API from the page's own origin through MSW.
const baseUrl = env.api.baseUrl || (globalThis.location?.origin ?? "")

export const api = createApiClient({ baseUrl })
