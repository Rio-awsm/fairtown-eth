import { env } from "../config"
import { shortAddress } from "./model"

/** Every tx and address on screen links to the block explorer (S3 1.4 key rule). */
export const explorerTx = (tx: string) => (env.explorerUrl ? `${env.explorerUrl}/tx/${tx}` : undefined)
export const explorerAddress = (address: string) => (env.explorerUrl ? `${env.explorerUrl}/address/${address}` : undefined)

/** On an anvil fork (VITE_EXPLORER_URL=local) hashes are local: shown as text, never as a dead explorer link. */
export const LOCAL_FORK_TITLE = "Local fork transaction: not on a public explorer"

export function TxLink({ tx, className = "font-mono text-harbour underline" }: { tx: string; className?: string }) {
  const href = explorerTx(tx)
  if (!href) {
    return (
      <span className="font-mono" title={`${tx}. ${LOCAL_FORK_TITLE}`}>
        {shortAddress(tx)} (local)
      </span>
    )
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className} title={tx}>
      {shortAddress(tx)}
    </a>
  )
}

export function AddressLink({ address }: { address: string }) {
  const href = explorerAddress(address)
  if (!href) {
    return (
      <span className="font-mono" title={address}>
        {shortAddress(address)}
      </span>
    )
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-mono text-harbour underline" title={address}>
      {shortAddress(address)}
    </a>
  )
}
