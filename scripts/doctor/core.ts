export type Status = "ok" | "warn" | "fail"
export type Owner = "shared" | "S1" | "S2" | "S3" | "TG"
export type Env = Record<string, string | undefined>
export type Ctx = { env: Env; envFileFound: boolean; versions: { node: string; pnpm: string | null } }
export type Result = { status: Status; detail: string }
export type Check = { id: string; owner: Owner; title: string; run: (ctx: Ctx) => Result | Promise<Result> }
export type Row = Pick<Check, "id" | "owner" | "title"> & Result

export async function runChecks(checks: Check[], ctx: Ctx): Promise<Row[]> {
  const rows: Row[] = []
  for (const c of checks) {
    let r: Result
    try {
      r = await c.run(ctx)
    } catch (e) {
      r = { status: "fail", detail: e instanceof Error ? e.message : String(e) }
    }
    rows.push({ id: c.id, owner: c.owner, title: c.title, ...r })
  }
  return rows
}

export const exitCode = (rows: Pick<Row, "status">[]) => (rows.some((r) => r.status === "fail") ? 1 : 0)

export const formatRows = (rows: Row[]) =>
  rows.map((r) => `${`[${r.status}]`.padEnd(7)} ${r.owner.padEnd(6)} ${r.id.padEnd(16)} ${r.detail}`).join("\n")

export function atLeast(version: string, min: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0)
  const a = parse(version)
  const b = parse(min)
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return true
}
