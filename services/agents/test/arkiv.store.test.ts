import { describe } from "vitest"
import { MemoryArkivStore } from "../src/arkiv/MemoryArkivStore"
import { arkivSuite } from "./arkiv.suite"

describe("ArkivStore suite: memory", () => {
  arkivSuite(() => new MemoryArkivStore(), "0x00000000000000000000000000000000000000b1", "mem")
})
