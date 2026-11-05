import { useEffect, useRef } from "react"
import "uplot/dist/uPlot.min.css"
import { toDecimalString } from "../money/format"

/** Chart series: blocks and clearing prices. Numbers are fine here: the chart is display only. */
export function chartData(priceLog: { block: number; perUnit: string }[]): [number[], number[]] {
  return [priceLog.map((p) => p.block), priceLog.map((p) => Number(toDecimalString(BigInt(p.perUnit))))]
}

export function PriceChart({
  priceLog,
  currency,
}: {
  priceLog: { block: number; perUnit: string }[]
  currency: string
}) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = host.current
    if (!el || priceLog.length === 0) return
    let plot: { destroy(): void } | undefined
    let cancelled = false
    // Loaded on demand: uPlot touches matchMedia at import and is only needed when a lot panel opens.
    void import("uplot")
      .then(({ default: uPlot }) => {
        if (cancelled) return
        plot = new uPlot(
          {
            width: 300,
            height: 120,
            legend: { show: false },
            scales: { x: { time: false } },
            axes: [{ stroke: "#94a3b8" }, { stroke: "#94a3b8", label: currency }],
            series: [{}, { stroke: "#34d399", width: 2 }],
          },
          chartData(priceLog),
          el,
        )
      })
      .catch((error: unknown) => console.error("price chart failed to load", error))
    return () => {
      cancelled = true
      plot?.destroy()
    }
  }, [priceLog, currency])
  if (priceLog.length === 0) return <p className="text-xs text-slate-400">No price ticks yet.</p>
  return <div ref={host} aria-label="Clearing price chart" />
}
