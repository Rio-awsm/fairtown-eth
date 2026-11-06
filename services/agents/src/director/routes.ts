import { DirectorScenarioRequest, DirectorScenarioResponse, DirectorStatus } from "@fairtown/shared/api"
import type { FastifyInstance } from "fastify"
import { HttpError, parse } from "../listing/routes"
import type { Director } from "./director"

export function registerDirectorRoutes(app: FastifyInstance, director: Director) {
  app.post("/api/director/scenario", async (req) => {
    const body = parse(DirectorScenarioRequest, req.body)
    const r = await director.start(body.name, body.speed ?? 1)
    if (!r.started) throw new HttpError(409, "not_started", r.reason ?? "Scenario not started")
    return DirectorScenarioResponse.parse({ started: true })
  })
  app.get("/api/director/status", async () => DirectorStatus.parse(director.status()))
}
