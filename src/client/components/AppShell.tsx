import { Link, Outlet, useLocation } from "react-router-dom";
import { ToastViewport } from "./ToastViewport";

export function AppShell() {
  const location = useLocation();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">PBResults</p>
          <h1>PBResults Scoreboard</h1>
        </div>
        <nav className="sidebar-nav">
          <Link className={location.pathname === "/admin/operations" ? "active" : ""} to="/admin/operations">
            Operations
          </Link>
          <Link className={location.pathname.startsWith("/admin/themes") ? "active" : ""} to="/admin/themes">
            Themes
          </Link>
          <Link className={location.pathname.startsWith("/admin/teams") ? "active" : ""} to="/admin/teams">
            Teams
          </Link>
          <Link className={location.pathname === "/admin/settings" ? "active" : ""} to="/admin/settings">
            Settings
          </Link>
          <a href="/overlay/live" target="_blank" rel="noreferrer">
            Open Live Overlay
          </a>
        </nav>
      </aside>
      <main className="content">
        <Outlet key={location.pathname} />
      </main>
      <ToastViewport />
    </div>
  );
}
