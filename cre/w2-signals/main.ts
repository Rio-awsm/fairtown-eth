/**
 * CRE W2 entry point (S1 4.3). Logic in src/workflow.ts: the WASM build (Javy) refuses exported functions with
 * parameters, so this entry exports only `main()`.
 */
import { Runner } from "@chainlink/cre-sdk"
import { ConfigSchema, type Config } from "./src/lib"
import { initWorkflow } from "./src/workflow"

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema: ConfigSchema })
  await runner.run(initWorkflow)
}
