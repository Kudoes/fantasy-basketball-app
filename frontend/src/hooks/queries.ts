import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { api, type DraftState, type SettingsUpdate } from "@/lib/api"

const DRAFT_POLL_MS = 2500

const showError = (error: Error) => toast.error(error.message)

export function usePlayers() {
  return useQuery({ queryKey: ["players"], queryFn: api.players, staleTime: 60_000, placeholderData: keepPreviousData })
}

export function useDraftState({ poll = true } = {}) {
  return useQuery({
    queryKey: ["draft"],
    queryFn: api.draftState,
    refetchInterval: poll ? DRAFT_POLL_MS : false,
    placeholderData: keepPreviousData,
  })
}

export function useLeague() {
  return useQuery({ queryKey: ["league"], queryFn: api.league })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SettingsUpdate) => api.updateSettings(body),
    onSuccess: () => qc.invalidateQueries(),
    onError: showError,
  })
}

export function useAddPick() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (playerId: number) => api.addPick(playerId),
    // Drop the player from the board immediately; the next poll fills in the rest.
    onMutate: async (playerId) => {
      await qc.cancelQueries({ queryKey: ["draft"] })
      const previous = qc.getQueryData<DraftState>(["draft"])
      if (previous) {
        qc.setQueryData<DraftState>(["draft"], {
          ...previous,
          available: previous.available.filter((p) => p.player_id !== playerId),
        })
      }
      return { previous }
    },
    onError: (error, _id, context) => {
      if (context?.previous) qc.setQueryData(["draft"], context.previous)
      showError(error)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["draft"] }),
  })
}

export function useRemovePick() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (overall: number) => api.removePick(overall),
    onError: showError,
    onSettled: () => qc.invalidateQueries({ queryKey: ["draft"] }),
  })
}

export function useResetDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.resetDraft,
    onSuccess: () => toast.success("Draft reset"),
    onError: showError,
    onSettled: () => qc.invalidateQueries({ queryKey: ["draft"] }),
  })
}

export function useSyncYahoo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.syncYahoo,
    onSuccess: (r) => {
      toast.success(`Imported ${r.league}: ${r.teams} teams, ${r.players_matched} players matched`)
      if (r.draft_error) toast.warning(`Draft results: ${r.draft_error}`)
    },
    onError: showError,
    onSettled: () => qc.invalidateQueries(),
  })
}

export function useSyncData() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (which: "projections" | "last_season") =>
      which === "projections" ? api.syncProjections() : api.syncLastSeason(),
    onSuccess: () => toast.success("Data refreshed"),
    onError: showError,
    onSettled: () => qc.invalidateQueries(),
  })
}

export function useRenameTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slot, name }: { slot: number; name: string }) => api.renameTeam(slot, name),
    onError: showError,
    onSettled: () => qc.invalidateQueries(),
  })
}
