import { TriangleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export function PageLoading() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-8 w-full max-w-xl" />
      <Skeleton className="h-[60svh] w-full" />
    </div>
  )
}

export function PageError({ error, onRetry }: { error: Error | null; onRetry?: () => void }) {
  return (
    <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-3 text-center">
      <TriangleAlertIcon className="size-8 text-warning" />
      <h2 className="text-lg font-semibold">Couldn't reach the backend</h2>
      <p className="text-sm text-muted-foreground">
        {error?.message ?? "Unknown error"}. Make sure the API is running (<code>npm run dev</code> starts both).
      </p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
