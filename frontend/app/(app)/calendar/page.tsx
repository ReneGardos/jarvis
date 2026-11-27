"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import ChatView from "@/components/ChatView";
import { Badge, Button, Card, cx, ErrorNote, Input, PageHeader, useData } from "@/components/ui";

const startOfWeek = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

export default function CalendarPage() {
  const [week, setWeek] = useState(startOfWeek(new Date()));
  const ev = useData(() => api(`/api/calendar/events?start=${encodeURIComponent(week.toISOString())}&days=7`), [week]);
  const status = useData(() => api("/api/calendar/status"));
  const [f, setF] = useState({ title: "", start: "", end: "", location: "" });
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(week); d.setDate(d.getDate() + i); return d; });
  const create = async () => {
    try {
      await api("/api/calendar/events", { method: "POST", json: { title: f.title, location: f.location,
        start: new Date(f.start).toISOString(), end: f.end ? new Date(f.end).toISOString() : null } });
      setF({ title: "", start: "", end: "", location: "" }); ev.reload();
    } catch (e: any) { setError(e.message); }
  };
  const sync = async () => { setSyncing(true); try { await api("/api/calendar/sync", { method: "POST" }); ev.reload(); } catch (e: any) { setError(e.message); } setSyncing(false); };
  const shift = (n: number) => { const d = new Date(week); d.setDate(d.getDate() + n * 7); setWeek(d); };
  return (
    <div className="space-y-6">
      <PageHeader title="Kalender" subtitle={status.data?.caldav_configured ? `Synkroniseret med ${status.data.url}` : "Lokal kalender – konfigurér CalDAV i .env for Apple Kalender"}
        actions={<>
          <Button variant="ghost" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="ghost" onClick={() => setWeek(startOfWeek(new Date()))}>I dag</Button>
          <Button variant="ghost" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
          {status.data?.caldav_configured && <Button variant="subtle" loading={syncing} onClick={sync}><RefreshCw className="h-4 w-4" />Synk</Button>}
        </>} />
      <ErrorNote error={error || ev.error} />
      <div className="grid gap-2 md:grid-cols-7">
        {days.map((d) => {
          const items = (ev.data || []).filter((e: any) => new Date(e.start).toDateString() === d.toDateString());
          const today = d.toDateString() === new Date().toDateString();
          return (
            <div key={d.toISOString()} className={cx("min-h-[160px] rounded-2xl border bg-panel p-3", today ? "border-accent/60" : "border-line")}>
              <div className="mb-2 text-xs font-medium text-muted">{fmtDate(d.toISOString(), { weekday: "short", day: "numeric", month: "short" })}</div>
              <div className="space-y-1.5">
                {items.map((e: any) => (
                  <div key={e.id} className="group rounded-lg bg-accent-soft px-2 py-1.5 text-xs">
                    <div className="flex items-center gap-1">
                      <span className="font-medium">{e.all_day ? "Hele dagen" : fmtDate(e.start, { timeStyle: "short" })}</span>
                      <button className="ml-auto hidden text-muted hover:text-bad group-hover:block" onClick={async () => { await api(`/api/calendar/events/${e.id}`, { method: "DELETE" }); ev.reload(); }}><Trash2 className="h-3 w-3" /></button>
                    </div>
                    <div className="truncate">{e.title}</div>
                    {e.location && <div className="truncate text-muted">{e.location}</div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card title="Ny aftale">
          <div className="space-y-2">
            <Input placeholder="Titel" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            <label className="block text-xs text-muted">Start<Input type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
            <label className="block text-xs text-muted">Slut<Input type="datetime-local" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label>
            <Input placeholder="Sted" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
            <Button onClick={create} disabled={!f.title || !f.start}><Plus className="h-4 w-4" />Opret</Button>
            {status.data?.caldav_configured && <p className="text-xs text-muted"><Badge tone="ok">CalDAV</Badge> Aftalen oprettes også i din Apple Kalender.</p>}
          </div>
        </Card>
        <div><h2 className="mb-2 text-sm font-semibold">Planning Agent</h2>
          <ChatView defaultAgent="planning" showList={false} placeholder="Fx: Planlæg min dag i morgen med 2 timers fokusarbejde"
            starters={["Planlæg min dag", "Lav en ugeplan for næste uge", "Find tid til et 1-times møde i denne uge", "Hvad er mine vigtigste deadlines?"]} />
        </div>
      </div>
    </div>
  );
}
