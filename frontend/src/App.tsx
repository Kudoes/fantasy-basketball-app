import { createBrowserRouter, Navigate, RouterProvider } from "react-router"

import { AppShell } from "@/components/app-shell"
import { DraftPage } from "@/pages/draft"
import { LeaguePage } from "@/pages/league"
import { RankingsPage } from "@/pages/rankings"
import { TeamPage } from "@/pages/team"

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/draft" replace /> },
      { path: "draft", element: <DraftPage /> },
      { path: "rankings", element: <RankingsPage /> },
      { path: "team", element: <TeamPage /> },
      { path: "league", element: <LeaguePage /> },
      { path: "*", element: <Navigate to="/draft" replace /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
