import { useTown } from "../state/townStore"

/** `/town?debug=1` outside production: the last 20 reducer commands, newest first. */
export function DevOverlay() {
  const log = useTown((s) => s.commandLog)
  const applied = useTown((s) => s.eventsApplied)
  const status = useTown((s) => s.status)
  return (
    <aside className="rpg-window absolute top-3 right-3 max-h-[80vh] w-96 overflow-auto p-3 font-mono text-xs">
      <p className="mb-1 text-ink-soft">
        {status} · {applied} events · {log.length} commands
      </p>
      <ol>
        {log
          .slice(-20)
          .reverse()
          .map((c, i) => (
            <li key={`${log.length}-${i}`}>{JSON.stringify(c)}</li>
          ))}
      </ol>
    </aside>
  )
}
