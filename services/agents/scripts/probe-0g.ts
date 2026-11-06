import { loadEnv } from "@fairtown/shared/env"
import { deflateSync } from "node:zlib"
import { parseArgs } from "node:util"
import { parseAiConfig, targetFor } from "../src/ai/config"
import { createGateway } from "../src/ai/gateway"
import { verificationOf } from "../src/ai/verification"
import { gradeLot } from "../src/listing/grade"

// pnpm -F agents probe:0g [--model id]. Lists TEE-attested image models on the 0G Router (free), then makes at most two
// paid calls with a small generated photo: one raw (prints x_0g_trace) and one through our gateway and grader.
const argv = process.argv.slice(2)
const { values } = parseArgs({ args: argv[0] === "--" ? argv.slice(1) : argv, options: { model: { type: "string" } } })
const { env } = loadEnv(new URL("../../../.env", import.meta.url).pathname)
const config = parseAiConfig({ ...env, MOCK_AI: "0" })
const t = targetFor(config, "vision")
if (!/0g\.ai|integratenetwork/.test(t.baseURL)) throw new Error(`VISION_BASE_URL is not a 0G Router endpoint (${new URL(t.baseURL).host})`)
console.log(`Router: ${new URL(t.baseURL).host}, key ${t.apiKey ? `set (${t.apiKey.length} chars)` : "MISSING"}, extra body ${JSON.stringify(t.extraBody)}`)

type Model = { id: string; tee_attested?: boolean; verifiability?: string; architecture?: { input_modalities?: string[] }; pricing_usd?: { prompt?: string; completion?: string }; supported_parameters?: string[] }
const models = ((await (await fetch(`${t.baseURL}/models`)).json()) as { data: Model[] }).data
const candidates = models.filter((m) => m.tee_attested === true && (m.architecture?.input_modalities ?? []).includes("image"))
console.log(`\nTEE-attested image models: ${candidates.map((m) => `${m.id} (${m.verifiability}, $${m.pricing_usd?.prompt}/$${m.pricing_usd?.completion} per token)`).join(", ") || "none"}`)
const model = values.model ?? candidates[0]?.id ?? t.model
console.log(`Probing ${model}${values.model ? " (from --model)" : ""}`)

// A 48x48 PNG: orange fish-like band on blue, with a dark block standing in for a lot-code card.
function png(w = 48, h = 48) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3
      const band = y > 16 && y < 32 && x > 6 && x < 42
      const card = x > 34 && y > 36
      const [r, g, b] = card ? [20, 20, 20] : band ? [230, 120, 40] : [40, 90, 160]
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
    }
  }
  const crc = (buf: Buffer) => {
    let c = ~0
    for (const byte of buf) {
      c ^= byte
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
    return ~c >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}
const dataUrl = `data:image/png;base64,${png().toString("base64")}`

// 1. Raw call: exactly what the Router returns.
const started = Date.now()
const res = await fetch(`${t.baseURL}/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${t.apiKey}` },
  body: JSON.stringify({
    model,
    verify_tee: true,
    max_tokens: 120,
    messages: [{ role: "user", content: [{ type: "text", text: 'Describe the colours in this photo as JSON {"colours": [..]}.' }, { type: "image_url", image_url: { url: dataUrl } }] }],
  }),
})
const body = (await res.json()) as { x_0g_trace?: Record<string, unknown>; choices?: Array<{ message?: { content?: string } }>; error?: { type?: string; code?: string; message?: string } }
console.log(`\n1. Raw call: HTTP ${res.status} in ${Date.now() - started} ms`)
if (!res.ok) console.log(`   error: ${body.error?.type} ${body.error?.code}`)
console.log(`   ZG-Res-Key: ${res.headers.get("zg-res-key") ?? "(none)"}`)
console.log(`   x_0g_trace: ${JSON.stringify(body.x_0g_trace ?? null)}`)
console.log(`   answer: ${(body.choices?.[0]?.message?.content ?? "").slice(0, 120)}`)

// 2. Through our gateway and grader (structured output, fallback on failure).
if (res.ok) {
  const ai = createGateway({ config: parseAiConfig({ ...env, MOCK_AI: "0", VISION_MODEL: model }) })
  const g = await gradeLot("fish", "cod", [{ hash: "0x00", file: "", mediaType: "image/png", lotCode: "4821", capturedAt: new Date().toISOString(), dataUrl }], ai)
  const v = verificationOf(g.trace)
  console.log(`\n2. Gateway grade: source ${g.source}, grade ${g.report.grade}, confidence ${g.report.confidence}, defects ${JSON.stringify(g.report.defects)}`)
  console.log(`   trace: requestId ${g.trace?.requestId ?? "-"}, provider ${g.trace?.provider ?? "-"}, model ${g.trace?.model ?? "-"}, teeVerified ${g.trace?.teeVerified}, cost ${g.trace?.cost ? `${g.trace.cost.amount} ${g.trace.cost.currency}` : "-"}, trust ${g.trace?.trustMode ?? "-"}${g.trace?.fallback ? `, FALLBACK (${g.trace.fallback.reason})` : ""}`)
  console.log(`   badge: ${v.state}: "${v.label}"`)
  console.log(`   gateway stats: ${JSON.stringify(ai.stats().vision)}`)
}
