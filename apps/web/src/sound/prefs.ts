type StorageLike = Pick<Storage, "getItem" | "setItem">
const KEY = "fairtown.muted"

function browserStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Muted unless the presenter turned sound on before: browsers block sound until a click anyway. */
export function loadMuted(storage: StorageLike | null = browserStorage()): boolean {
  try {
    return storage?.getItem(KEY) !== "false"
  } catch {
    return true
  }
}

export function saveMuted(muted: boolean, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(KEY, String(muted))
  } catch (error: unknown) {
    console.warn("could not save the sound setting", error)
  }
}
