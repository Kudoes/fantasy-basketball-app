import { useEffect, useRef } from "react"
import { SearchIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { POSITIONS } from "@/lib/format"

export type PositionFilter = "ALL" | (typeof POSITIONS)[number]

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

export function matchesFilters(
  player: { name: string; positions: string[] },
  search: string,
  position: PositionFilter,
): boolean {
  if (position !== "ALL" && !player.positions.includes(position)) return false
  return !search || fold(player.name).includes(fold(search.trim()))
}

export function PlayerFilters({
  search,
  onSearch,
  position,
  onPosition,
}: {
  search: string
  onSearch: (value: string) => void
  position: PositionFilter
  onPosition: (value: PositionFilter) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  // "/" jumps to search, like most draft tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(target.tagName)) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onSearch("")}
          placeholder="Search players  /"
          className="h-8 w-52 pl-8"
        />
      </div>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={position}
        onValueChange={(v) => onPosition((v || "ALL") as PositionFilter)}
      >
        <ToggleGroupItem value="ALL">All</ToggleGroupItem>
        {POSITIONS.map((p) => (
          <ToggleGroupItem key={p} value={p}>
            {p}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
