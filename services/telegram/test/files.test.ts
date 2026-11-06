import { describe, expect, it } from "vitest"
import { FileError, pickSize, telegramFiles } from "../src/files"
import { FAKE_TOKEN } from "./harness"

const caught = async (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => e as FileError)

describe("photo downloads", () => {
  it("fetches the file from the Bot API file endpoint", async () => {
    let url = ""
    const files = telegramFiles(async () => ({ file_path: "photos/file_1.jpg", file_size: 10 }), FAKE_TOKEN, async (u) => {
      url = String(u)
      return new Response(Buffer.from("jpeg"))
    })
    expect((await files.photo("abc")).toString()).toBe("jpeg")
    expect(url).toBe(`https://api.telegram.org/file/bot${FAKE_TOKEN}/photos/file_1.jpg`)
  })

  it("refuses big files before and after download", async () => {
    const before = telegramFiles(async () => ({ file_path: "p", file_size: 5_000_000 }), FAKE_TOKEN, async () => new Response("x"))
    expect(await caught(before.photo("a"))).toMatchObject({ code: "too_big" })
    const after = telegramFiles(async () => ({ file_path: "p" }), FAKE_TOKEN, async () => new Response(Buffer.alloc(11)), 10)
    expect(await caught(after.photo("a"))).toMatchObject({ code: "too_big" })
  })

  it("fails without the token in the error, whatever goes wrong", async () => {
    const cases = [
      telegramFiles(async () => Promise.reject(new Error(`getFile ${FAKE_TOKEN}`)), FAKE_TOKEN),
      telegramFiles(async () => ({}), FAKE_TOKEN),
      telegramFiles(async () => ({ file_path: "p" }), FAKE_TOKEN, async (u) => Promise.reject(new TypeError(`fetch failed ${String(u)}`))),
      telegramFiles(async () => ({ file_path: "p" }), FAKE_TOKEN, async () => new Response("no", { status: 404 })),
    ]
    for (const f of cases) {
      const e = await caught(f.photo("a"))
      expect(e).toBeInstanceOf(FileError)
      expect(e!.code).toBe("download_failed")
      expect(e!.message).not.toContain(FAKE_TOKEN)
    }
  })

  it("picks the largest size under the limit", () => {
    const sizes = [
      { file_id: "s", file_unique_id: "s", width: 90, height: 90, file_size: 1_000 },
      { file_id: "xl", file_unique_id: "xl", width: 4000, height: 3000, file_size: 9_000_000 },
      { file_id: "l", file_unique_id: "l", width: 1280, height: 960, file_size: 200_000 },
    ]
    expect(pickSize(sizes)!.file_id).toBe("l")
    expect(pickSize([sizes[1]!])).toBeUndefined()
  })
})
