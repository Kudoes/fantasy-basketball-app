import type { CategoryKey } from "@/lib/api"
import { CATEGORIES } from "@/lib/format"
import { cn } from "@/lib/utils"

export function PuntToggles({
  punts,
  onChange,
  disabled,
}: {
  punts: CategoryKey[]
  onChange: (punts: CategoryKey[]) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Punt categories">
      <span className="mr-1 text-xs font-medium text-muted-foreground">Punt</span>
      {CATEGORIES.map((cat) => {
        const on = punts.includes(cat.key)
        return (
          <button
            key={cat.key}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            title={on ? `Stop punting ${cat.label}` : `Punt ${cat.label}: ignore it when valuing players`}
            onClick={() => onChange(on ? punts.filter((k) => k !== cat.key) : [...punts, cat.key])}
            className={cn(
              "h-7 rounded-md border px-2 text-xs font-medium transition-colors disabled:opacity-50",
              on
                ? "border-primary/60 bg-primary/10 text-primary line-through"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {cat.label}
          </button>
        )
      })}
    </div>
  )
}
