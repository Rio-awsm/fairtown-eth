import { useTown } from "../state/townStore"
import { saveMuted } from "../sound/prefs"
import { unlockAudio } from "../sound/sfx"
import { ModeBadge, TestMoneyBadge } from "./ModeBadge"

/** Block, relay status, sound, LIVE or REPLAY and TEST MONEY. Signals show in the town and the ticker. */
export function TopBar() {
  const block = useTown((s) => s.town.block)
  const status = useTown((s) => s.status)
  const muted = useTown((s) => s.ui.muted)
  const setUi = useTown((s) => s.setUi)
  return (
    <div className="rpg-window flex items-center gap-3 px-3 py-2 text-sm">
      <ModeBadge />
      <TestMoneyBadge />
      <span title="Latest block seen on the relay" className="font-display font-semibold">
        Block {block}
      </span>
      <span className="text-ink-soft" title="Relay connection">
        {status}
      </span>
      <button
        aria-pressed={!muted}
        className="rpg-btn rpg-btn-quiet rpg-btn-sm min-h-7 text-xs"
        onClick={() => {
          if (muted) unlockAudio()
          saveMuted(!muted)
          setUi({ muted: !muted })
        }}
      >
        {muted ? "Sound off" : "Sound on"}
      </button>
    </div>
  )
}
