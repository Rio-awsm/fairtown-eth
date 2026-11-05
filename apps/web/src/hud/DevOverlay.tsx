import { useTown } from "../state/townStore"

/** `/town?debug=1` outside production: the last 20 reducer commands, newest first. */
export function DevOverlay() {
  const log = useTown((s) => s.commandLog)
  const applied = useTown((s) => s.eventsApplied)
  const status = useTown((s) => s.status)
  return (
    <aside className="absolute top-2 right-2 max-h-[80vh] w-96 overflow-auto rounded bg-black/80 p-2 font-mono text-xs text-slate-200">
      <p className="mb-1 text-slate-400">
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
