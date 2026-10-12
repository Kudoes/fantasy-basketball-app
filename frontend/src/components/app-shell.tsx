import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { NavLink, Outlet } from "react-router"

import { Button } from "@/components/ui/button"
import { useTheme } from "@/hooks/use-theme"
import { cn } from "@/lib/utils"

const NAV = [
  { to: "/draft", label: "Draft Room" },
  { to: "/rankings", label: "Rankings" },
  { to: "/team", label: "My Team" },
  { to: "/league", label: "League" },
]

function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M2.5 12h19M12 2.5v19M5.3 5.3c3.2 3.2 3.2 10.2 0 13.4M18.7 5.3c-3.2 3.2-3.2 10.2 0 13.4" />
    </svg>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light"
  const Icon = theme === "light" ? SunIcon : theme === "dark" ? MoonIcon : MonitorIcon
  return (
    <Button variant="ghost" size="icon-sm" onClick={() => setTheme(next)} title={`Theme: ${theme ?? "system"}`}>
      <Icon />
      <span className="sr-only">Switch theme</span>
    </Button>
  )
}

export function AppShell() {
  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1680px] items-center gap-4 px-4 sm:gap-6">
          <NavLink to="/draft" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Logo />
            </span>
            <span className="hidden sm:inline">Courtside</span>
          </NavLink>
          <nav className="-mx-1 flex min-w-0 items-center gap-0.5 overflow-x-auto text-sm">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-2.5 py-1.5 font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                    isActive && "bg-muted text-foreground",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1680px] px-4 py-5">
        <Outlet />
      </main>
    </div>
  )
}
