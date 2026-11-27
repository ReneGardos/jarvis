"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell, Bot, Brain, CalendarDays, CheckSquare, Code2, Cpu, FileText, FolderKanban, Globe, LayoutDashboard,
  LogOut, Menu, Mic, MessageSquare, Settings, ShieldCheck, Workflow, X,
} from "lucide-react";
import { api } from "@/lib/api";
import { cx } from "@/components/ui";

const NAV = [
  ["/", "Overblik", LayoutDashboard], ["/chat", "Chat", MessageSquare], ["/voice", "Voice Assistant", Mic],
  ["/calendar", "Kalender", CalendarDays], ["/tasks", "Opgaver", CheckSquare], ["/projects", "Projekter", FolderKanban],
  ["/agents", "AI-agenter", Bot], ["/memory", "Hukommelse", Brain], ["/documents", "Dokumenter", FileText],
  ["/research", "Research", Globe], ["/code", "Programmering", Code2], ["/automations", "Automatiseringer", Workflow],
  ["/approvals", "Godkendelser", ShieldCheck], ["/models", "Modeller", Cpu], ["/settings", "Indstillinger", Settings],
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<{ email: string } | null>(null);
  const [counts, setCounts] = useState<{ pending_approvals: number; unread_notifications: number } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api("/api/auth/me").then(setMe).catch(() => router.replace("/login"));
  }, [router]);
  useEffect(() => {
    if (!me) return;
    const tick = () => api("/api/overview").then(setCounts).catch(() => {});
    tick();
    const t = setInterval(tick, 20000);
    return () => clearInterval(t);
  }, [me, path]);
  useEffect(() => setOpen(false), [path]);

  if (!me) return <div className="grid min-h-screen place-items-center text-muted">Indlæser…</div>;

  const logout = async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => {}); router.replace("/login"); };

  return (
    <div className="flex min-h-screen">
      <aside className={cx("fixed inset-y-0 left-0 z-40 w-64 shrink-0 border-r border-line bg-panel/95 backdrop-blur transition-transform md:static md:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-16 items-center gap-3 px-5">
          <div className="h-8 w-8 rounded-full bg-accent/25 ring-2 ring-accent/60" />
          <span className="text-lg font-semibold tracking-tight">Jarvis</span>
          <button className="ml-auto md:hidden" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
        </div>
        <nav className="space-y-0.5 px-3 pb-24">
          {NAV.map(([href, label, Icon]) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            const badge = href === "/approvals" ? counts?.pending_approvals : 0;
            return (
              <Link key={href} href={href}
                className={cx("flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                  active ? "bg-accent-soft text-white" : "text-muted hover:bg-panel2 hover:text-white")}>
                <Icon className={cx("h-4 w-4", active && "text-accent")} />
                {label}
                {!!badge && <span className="ml-auto rounded-full bg-warn px-1.5 text-xs font-semibold text-black">{badge}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="absolute bottom-0 w-full border-t border-line p-3">
          <div className="flex items-center gap-2 px-2 text-xs text-muted">
            <span className="truncate">{me.email}</span>
            <button title="Log ud" onClick={logout} className="ml-auto rounded-lg p-1.5 hover:bg-panel2 hover:text-white"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur md:hidden">
          <button onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
          <span className="font-semibold">Jarvis</span>
          <Link href="/" className="relative ml-auto"><Bell className="h-5 w-5" />
            {!!counts?.unread_notifications && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" />}
          </Link>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
