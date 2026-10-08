"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  BadgeCheck,
  BookOpen,
  ChevronsUpDown,
  Gauge,
  ListChecks,
  Menu,
  Network,
  ScrollText,
  Settings as SettingsIcon,
  TestTube2,
  X,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { getUser, DemoUser } from "@/lib/user";

const groups = [
  {
    label: "Operations",
    links: [
      ["/overview", "Overview", Gauge],
      ["/ledger", "Water Ledger", BookOpen],
      ["/topology", "Topology", Network],
      ["/incidents", "Incidents", ListChecks],
    ],
  },
  {
    label: "Data & testing",
    links: [
      ["/replay", "Replay Lab", TestTube2],
      ["/meters", "Meter Data", Activity],
      ["/audit", "Audit Trail", ScrollText],
    ],
  },
  {
    label: "System",
    links: [
      ["/validation", "Validation", BadgeCheck],
      ["/settings", "Settings", SettingsIcon],
    ],
  },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<DemoUser | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => setUser(getUser()), []);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="app-shell">
      <div className="mobile-topbar">
        <button
          className="btn btn-ghost btn-sm"
          aria-label="Open navigation"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Menu size={17} />
        </button>
        <Logo />
        <span className="avatar" aria-hidden="true">{user?.initials || "—"}</span>
      </div>

      {open && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setOpen(false)} />}

      <aside className={`app-sidebar ${open ? "open" : ""}`} aria-label="Primary navigation">
        <div className="sidebar-brand flex-between">
          <Link href="/overview" aria-label="LeakLedger home">
            <Logo />
          </Link>
          <button
            className="btn btn-ghost btn-sm"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            style={{ display: open ? undefined : "none" }}
          >
            <X size={15} />
          </button>
        </div>

        <nav style={{ display: "grid", gap: 2 }}>
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.links.map(([href, label, Icon]) => {
                const active = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`nav-item ${active ? "active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon size={15} aria-hidden="true" />
                    {label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="tiny muted-2" style={{ padding: "0 8px 6px" }}>
            Demo environment · no authentication
          </div>
          <button className="user-button" onClick={() => router.push("/signin")} title="Switch demo identity">
            <span className="avatar" aria-hidden="true">{user?.initials || "—"}</span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <strong style={{ display: "block", fontSize: 12.5, fontWeight: 600 }} className="truncate">
                {user?.name || "Demo user"}
              </strong>
              <span className="muted tiny">{user?.role || "Switch user"}</span>
            </span>
            <ChevronsUpDown size={13} className="muted-2" aria-hidden="true" />
          </button>
        </div>
      </aside>

      <main className="app-main">
        <div className="app-content">{children}</div>
      </main>
    </div>
  );
}
