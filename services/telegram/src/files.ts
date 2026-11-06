import type { PhotoSize } from "grammy/types"

// Downloads a photo the user sent. The file URL holds the bot token, so it never goes into an error or a log.
export const MAX_PHOTO_BYTES = 3_000_000 // three photos as base64 stay well under the agents service's 12 MB body limit

export class FileError extends Error {
  constructor(readonly code: "too_big" | "download_failed") {
    super(code === "too_big" ? "That photo is too large" : "Could not fetch the photo from Telegram")
  }
}

export type Files = { photo(fileId: string): Promise<Buffer> }
type GetFile = (fileId: string) => Promise<{ file_path?: string; file_size?: number }>

export function telegramFiles(getFile: GetFile, token: string, f: typeof fetch = fetch, maxBytes = MAX_PHOTO_BYTES, timeoutMs = 15_000): Files {
  return {
    async photo(fileId) {
      let path: string | undefined
      try {
        const file = await getFile(fileId)
        if (file.file_size !== undefined && file.file_size > maxBytes) throw new FileError("too_big")
        path = file.file_path
      } catch (e) {
        if (e instanceof FileError) throw e
        throw new FileError("download_failed")
      }
      if (!path) throw new FileError("download_failed")
      let res: Response
      try {
        res = await f(`https://api.telegram.org/file/bot${token}/${path}`, { signal: AbortSignal.timeout(timeoutMs) })
      } catch {
        throw new FileError("download_failed")
      }
      if (!res.ok) throw new FileError("download_failed")
      const bytes = Buffer.from(await res.arrayBuffer())
      if (bytes.length > maxBytes) throw new FileError("too_big")
      return bytes
    },
  }
}

// Telegram sends several sizes of one photo; take the largest that fits (sizes without a byte count count as fitting).
export function pickSize(sizes: readonly PhotoSize[], maxBytes = MAX_PHOTO_BYTES): PhotoSize | undefined {
  return [...sizes].filter((s) => s.file_size === undefined || s.file_size <= maxBytes).sort((a, b) => b.width * b.height - a.width * a.height)[0]
}
