import { FIXTURE_FILES, Persona, SellerMessage, TownEnvelope } from "@fairtown/shared"
import { z } from "zod"
import { buildDay } from "./day"
import { MESSAGES } from "./messages"
import { PERSONAS } from "./personas"

// Validates everything before it is written, so a bad shape never reaches S3.
export function renderFixtures(): Record<string, string> {
  const day = z.array(TownEnvelope).parse(buildDay())
  const agents = z.array(Persona).parse(PERSONAS)
  const messages = z.array(SellerMessage).parse(MESSAGES)
  return {
    [FIXTURE_FILES.day]: day.map((e) => JSON.stringify(e)).join("\n") + "\n",
    [FIXTURE_FILES.agents]: JSON.stringify(agents, null, 2) + "\n",
    [FIXTURE_FILES.messages]: JSON.stringify(messages, null, 2) + "\n",
  }
}
