import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { OverlayPage } from "./pages/OverlayPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TeamsPage } from "./pages/TeamsPage";
import { TeamDetailPage } from "./pages/TeamDetailPage";
import { ThemeEditorPage } from "./pages/ThemeEditorPage";
import { ThemesPage } from "./pages/ThemesPage";

export function App() {
  return (
    <Routes>
      <Route path="/overlay/live" element={<OverlayPage mode="live" />} />
      <Route path="/overlay/preview/:id" element={<OverlayPage mode="preview" />} />
      <Route
        path="*"
        element={
          <AppShell>
            <Routes>
              <Route path="/" element={<Navigate to="/admin/themes" replace />} />
              <Route path="/admin/settings" element={<SettingsPage />} />
              <Route path="/admin/teams" element={<TeamsPage />} />
              <Route path="/admin/teams/:id" element={<TeamDetailPage />} />
              <Route path="/admin/themes" element={<ThemesPage />} />
              <Route path="/admin/themes/:id" element={<ThemeEditorPage />} />
            </Routes>
          </AppShell>
        }
      />
    </Routes>
  );
}
