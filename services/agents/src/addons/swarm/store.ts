// Swarm copy of lot photos (S2 8.5), behind ADDON_SWARM. The local disk (PhotoStore) stays the primary copy: if the Bee node
// is unreachable, slow or out of stamps, listing goes on with local photos only and the lot simply has no Swarm reference.

export type SwarmRef = `${string}` // 64 hex chars, unencrypted
export const isPlainRef = (r: string) => /^[0-9a-f]{64}$/.test(r)

export type SwarmOptions = {
  beeUrl: string
  batchId?: string
  gateway?: string // public read gateway for links, e.g. https://bzz.limo
  timeoutMs?: number
  fetch?: typeof fetch
}

export class SwarmStore {
  private readonly f: typeof fetch
  private readonly base: string
  readonly gateway: string
  uploaded = 0
  failed = 0
  lastError = ""

  constructor(private readonly o: SwarmOptions) {
    this.f = o.fetch ?? fetch
    this.base = o.beeUrl.replace(/\/+$/, "")
    this.gateway = (o.gateway ?? "https://bzz.limo").replace(/\/+$/, "")
  }

  url(ref: string) {
    return `${this.gateway}/bzz/${ref}/`
  }

  // Ready = node answers and the batch exists and is usable.
  async health(): Promise<{ ok: boolean; detail: string }> {
    if (!this.o.batchId) return { ok: false, detail: "no SWARM_BATCH_ID: photos stay on local disk" }
    try {
      const r = await this.f(`${this.base}/stamps/${this.o.batchId}`, { signal: AbortSignal.timeout(3000) })
      if (!r.ok) return { ok: false, detail: `batch not found on node (HTTP ${r.status}): photos stay on local disk` }
      const s = (await r.json()) as { usable?: boolean; batchTTL?: number; utilization?: number; depth?: number }
      if (!s.usable) return { ok: false, detail: "batch not usable yet: photos stay on local disk" }
      return { ok: true, detail: `batch usable, about ${Math.round((s.batchTTL ?? 0) / 86_400)} days left, ${this.uploaded} uploaded, ${this.failed} failed` }
    } catch {
      return { ok: false, detail: "Bee node unreachable: photos stay on local disk" }
    }
  }

  // Returns the plain reference, or undefined on any failure (the caller keeps the local copy).
  async upload(bytes: Uint8Array, mediaType: string, name: string): Promise<SwarmRef | undefined> {
    if (!this.o.batchId) return undefined
    try {
      const r = await this.f(`${this.base}/bzz?name=${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Swarm-Postage-Batch-Id": this.o.batchId, "Content-Type": mediaType },
        body: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mediaType }),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 20_000),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 120)}`)
      const ref = ((await r.json()) as { reference?: string }).reference ?? ""
      // An encrypted reference (128 hex) carries its decryption key and must never reach Arkiv.
      if (!isPlainRef(ref)) throw new Error(`unexpected reference length ${ref.length}`)
      this.uploaded++
      return ref
    } catch (e) {
      this.failed++
      this.lastError = (e instanceof Error ? e.message : String(e)).slice(0, 160)
      return undefined
    }
  }

  async read(ref: string): Promise<{ bytes: Uint8Array; mediaType: string } | undefined> {
    if (!isPlainRef(ref)) return undefined
    try {
      const r = await this.f(`${this.base}/bzz/${ref}/`, { signal: AbortSignal.timeout(this.o.timeoutMs ?? 20_000) })
      if (!r.ok) return undefined
      return { bytes: new Uint8Array(await r.arrayBuffer()), mediaType: r.headers.get("content-type") ?? "application/octet-stream" }
    } catch {
      return undefined
    }
  }
}
