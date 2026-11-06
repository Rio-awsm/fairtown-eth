/**
 * CRE W1 entry point (S1 4.2). The logic lives in src/workflow.ts: the WASM build (Javy) refuses exported functions
 * that take parameters, so this entry exports only `main()`.
 */
import { Runner } from "@chainlink/cre-sdk"
import { ConfigSchema, type Config } from "./src/lib"
import { initWorkflow } from "./src/workflow"

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema: ConfigSchema })
  await runner.run(initWorkflow)
}
