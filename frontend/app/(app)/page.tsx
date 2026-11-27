"use client";
import Link from "next/link";
import { AlertTriangle, Brain, CalendarDays, CheckSquare, Coins, ShieldCheck } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { Badge, Button, Card, ErrorNote, PageHeader, useData } from "@/components/ui";

export default function Overview() {
  const o = useData(() => api("/api/overview"));
  const health = useData(() => api("/api/health"));
  const events = useData(() => api("/api/calendar/events?days=1"));
  const tasks = useData(() => api("/api/tasks?status=todo"));
  const notes = useData(() => api("/api/notifications"));
  const stats = [
    ["Åbne opgaver", o.data?.open_tasks, CheckSquare, "/tasks"], ["Overskredne", o.data?.overdue_tasks, AlertTriangle, "/tasks"],
    ["Aftaler næste døgn", o.data?.events_next_24h, CalendarDays, "/calendar"], ["Afventer godkendelse", o.data?.pending_approvals, ShieldCheck, "/approvals"],
    ["Minder", o.data?.memories, Brain, "/memory"], ["Cloud denne måned", o.data ? `${o.data.cloud_spent_month_dkk} kr` : "", Coins, "/models"],
  ] as const;
  const hello = new Date().getHours() < 10 ? "Godmorgen" : new Date().getHours() < 18 ? "Goddag" : "Godaften";
  return (
    <div className="space-y-6">
      <PageHeader title={hello} subtitle={new Intl.DateTimeFormat("da-DK", { dateStyle: "full" }).format(new Date())}
        actions={<Link href="/chat"><Button>Spørg Jarvis</Button></Link>} />
      <ErrorNote error={o.error} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {stats.map(([label, v, Icon, href]) => (
          <Link key={label} href={href} className="rounded-2xl border border-line bg-panel p-4 transition hover:border-accent/40">
            <Icon className="mb-3 h-4 w-4 text-accent" /><div className="text-2xl font-semibold">{v ?? "–"}</div><div className="text-xs text-muted">{label}</div>
          </Link>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="I dag">
          {(events.data || []).length ? events.data.map((e: any) => (
            <div key={e.id} className="flex gap-3 border-b border-line/60 py-2 text-sm last:border-0">
              <span className="w-12 shrink-0 text-muted">{e.all_day ? "Hele" : fmtDate(e.start, { timeStyle: "short" })}</span><span>{e.title}</span>
            </div>
          )) : <p className="text-sm text-muted">Ingen aftaler i dag.</p>}
        </Card>
        <Card title="Næste opgaver">
          {(tasks.data || []).slice(0, 8).map((t: any) => (
            <div key={t.id} className="flex items-center gap-2 border-b border-line/60 py-2 text-sm last:border-0">
              <Badge tone={t.priority === 1 ? "bad" : t.priority === 2 ? "warn" : "default"}>P{t.priority}</Badge>
              <span className="flex-1 truncate">{t.title}</span>{t.due_at && <span className="text-xs text-muted">{fmtDate(t.due_at, { dateStyle: "short" })}</span>}
            </div>
          ))}
          {!tasks.data?.length && <p className="text-sm text-muted">Ingen åbne opgaver.</p>}
        </Card>
        <Card title="Notifikationer" actions={<button className="text-xs text-muted hover:text-white" onClick={async () => { await api("/api/notifications/read-all", { method: "POST" }); notes.reload(); }}>Markér læst</button>}>
          {(notes.data || []).slice(0, 8).map((n: any) => (
            <Link key={n.id} href={n.link || "#"} className="block border-b border-line/60 py-2 text-sm last:border-0">
              <div className="flex items-center gap-2">{!n.read && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}<span className="font-medium">{n.title}</span></div>
              <div className="line-clamp-2 text-xs text-muted">{n.body}</div>
            </Link>
          ))}
          {!notes.data?.length && <p className="text-sm text-muted">Ingen notifikationer.</p>}
        </Card>
      </div>
      <Card title="Systemstatus">
        <div className="flex flex-wrap gap-3 text-sm">
          {health.data && ["database", "ollama", "qdrant"].map((k) => <Badge key={k} tone={health.data[k] ? "ok" : "bad"}>{k}: {health.data[k] ? "kører" : "nede"}</Badge>)}
          {health.data && <span className="text-xs text-muted">version {health.data.version}</span>}
        </div>
      </Card>
    </div>
  );
}
