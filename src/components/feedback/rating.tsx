import { StarIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function Stars({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const filled = Math.round(value);
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" title={`${value.toFixed(1)} out of 5`}>
      <span className="inline-flex" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => (
          <StarIcon
            key={n}
            className={`size-3.5 ${n <= filled ? "fill-[#e99d02] text-[#e99d02]" : "text-muted-foreground/40"}`}
          />
        ))}
      </span>
      <span className="text-sm tabular-nums">{value.toFixed(1)}</span>
      <span className="sr-only">out of 5</span>
    </span>
  );
}

const STYLE = {
  POSITIVE: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  NEUTRAL: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  NEGATIVE: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
} as const;

export function SentimentBadge({ value }: { value: keyof typeof STYLE | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <Badge className={STYLE[value]}>{value.charAt(0) + value.slice(1).toLowerCase()}</Badge>;
}
