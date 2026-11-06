import { env } from "../config"
import { shortAddress } from "./model"

/** Every tx and address on screen links to the block explorer (S3 1.4 key rule). */
export const explorerTx = (tx: string) => `${env.explorerUrl}/tx/${tx}`
export const explorerAddress = (address: string) => `${env.explorerUrl}/address/${address}`

export function TxLink({ tx, className = "font-mono text-harbour underline" }: { tx: string; className?: string }) {
  return (
    <a href={explorerTx(tx)} target="_blank" rel="noreferrer" className={className} title={tx}>
      {shortAddress(tx)}
    </a>
  )
}

export function AddressLink({ address }: { address: string }) {
  return (
    <a
      href={explorerAddress(address)}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-harbour underline"
      title={address}
    >
      {shortAddress(address)}
    </a>
  )
}
