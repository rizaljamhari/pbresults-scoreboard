import { Link, useLocation } from "react-router-dom";
import type { PropsWithChildren } from "react";
import { ToastViewport } from "./ToastViewport";

export function AppShell({ children }: PropsWithChildren) {
  const location = useLocation();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">PBResults</p>
          <h1>Scoreboard Theming</h1>
        </div>
        <nav className="sidebar-nav">
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
      <main className="content">{children}</main>
      <ToastViewport />
    </div>
  );
}
