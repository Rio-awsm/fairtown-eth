import { useQuery } from "@tanstack/react-query"
import { api } from "../net/api"
import { ApiClientError } from "../net/apiClient"

function ApiHealth() {
  const health = useQuery({ queryKey: ["health"], queryFn: () => api.health() })
  if (health.isPending) return <span className="text-slate-400">Checking API…</span>
  if (health.isError) {
    const code = health.error instanceof ApiClientError ? health.error.code : "error"
    return <span className="text-red-400">API down ({code})</span>
  }
  return (
    <span className={health.data.ok ? "text-emerald-400" : "text-amber-400"}>
      {health.data.ok ? "API ok" : "API degraded"}
    </span>
  )
}

export function ControlPage() {
  return (
    <section className="p-4">
      <h1 className="text-2xl font-bold">Control</h1>
      <p className="mt-2 text-slate-400">Presenter controls. Built in step S3 5.1.</p>
      <p className="mt-4">
        <ApiHealth />
      </p>
    </section>
  )
}
