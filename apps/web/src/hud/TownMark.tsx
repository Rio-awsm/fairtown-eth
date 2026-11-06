/** The Fairtown mark: a little pixel market house. Decorative; the name sits beside it. */
export function TownMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#2a1f33" d="M6 0h2v1h2v1h2v1h1v3h-1v8H2V6H1V3h1V2h2V1h2z" />
      <path fill="#c6483b" d="M6 1h2v1h2v1h2v3H2V3h2V2h2z" />
      <path fill="#e56a5c" d="M6 1h2v1H6zM4 2h2v1H4z" />
      <path fill="#f8eccb" d="M3 6h8v7H3z" />
      <path fill="#7a4b2a" d="M6 9h2v4H6z" />
      <path fill="#9fd3ee" d="M4 7h1v2H4zM9 7h1v2H9z" />
      <path fill="#f2b33d" d="M2 6h10v1H2z" />
    </svg>
  )
}
