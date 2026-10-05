import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AssetsPage } from "./pages/AssetsPage";
import { MaintenancePage } from "./pages/MaintenancePage";
import { OverlayPage } from "./pages/OverlayPage";
import { OperationsPage } from "./pages/OperationsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TeamsPage } from "./pages/TeamsPage";
import { ThemeEditorPage } from "./pages/ThemeEditorPage";
import { ThemesPage } from "./pages/ThemesPage";

export function App() {
  return (
    <Routes>
      <Route path="/overlay/live" element={<OverlayPage mode="live" />} />
      <Route path="/overlay/preview/:id" element={<OverlayPage mode="preview" />} />
      <Route path="/" element={<AppShell />}>
        <Route index element={<Navigate to="admin/operations" replace />} />
        <Route path="admin/operations" element={<OperationsPage />} />
        <Route path="admin/settings" element={<SettingsRoute />} />
        <Route path="admin/maintenance" element={<MaintenancePage />} />
        <Route path="admin/teams" element={<TeamsPage />} />
        <Route path="admin/teams/:id" element={<TeamsPage />} />
        <Route path="admin/assets" element={<AssetsPage />} />
        <Route path="admin/assets/:id" element={<AssetsPage />} />
        <Route path="admin/themes" element={<ThemesPage />} />
        <Route path="admin/themes/:id" element={<ThemeEditorPage />} />
      </Route>
    </Routes>
  );
}

/** Updates, backups and remote access moved to Maintenance; old links to those sections still land on them. */
const MOVED_SECTIONS = new Set(["#set-updates", "#set-backup", "#set-remote"]);

function SettingsRoute() {
  const location = useLocation();
  if (MOVED_SECTIONS.has(location.hash)) return <Navigate to={`/admin/maintenance${location.hash}`} replace />;
  return <SettingsPage />;
}
