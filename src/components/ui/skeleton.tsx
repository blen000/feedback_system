import { cn } from "cn"

/** NIB-branded placeholder: warm muted block, faint honeycomb texture and a gold shimmer sweep. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("nib-skeleton rounded-md", className)}
      {...props}
    />
  )
}

/** Hexagon-shaped placeholder (avatars, icons, logo). Size it with className, e.g. "w-10". */
function HexSkeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("nib-skeleton nib-hex w-10", className)}
      {...props}
    />
  )
}

// Seven hexagons: one centre, six around it, pulsing in a ring.
const CELLS = [
  { x: 0, y: 0 },
  { x: 0, y: -1 },
  { x: 0.87, y: -0.5 },
  { x: 0.87, y: 0.5 },
  { x: 0, y: 1 },
  { x: -0.87, y: 0.5 },
  { x: -0.87, y: -0.5 },
]

/** Honeycomb cluster loader for full-screen / hero loading states. */
function HoneycombLoader({
  className,
  label = "Loading",
}: {
  className?: string
  label?: string
}) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn("relative size-24", className)}
    >
      {CELLS.map((c, i) => (
        <span
          key={i}
          aria-hidden
          className="nib-hex nib-hex-pulse absolute w-[30%]"
          style={{
            left: `${50 + c.x * 31 - 15}%`,
            top: `${50 + c.y * 31 - 17.3}%`,
            background: i === 0 ? "var(--brand-gold)" : "var(--brand-brown)",
            ["--nib-delay" as string]: `${i === 0 ? 0 : i * 0.12}s`,
          }}
        />
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  )
}

export { Skeleton, HexSkeleton, HoneycombLoader }
