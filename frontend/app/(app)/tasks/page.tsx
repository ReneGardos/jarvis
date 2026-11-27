"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { Badge, Button, Card, cx, ErrorNote, Input, PageHeader, Select, useData } from "@/components/ui";

const COLS = [["todo", "To do"], ["doing", "I gang"], ["done", "Færdig"]] as const;

export default function Tasks() {
  const tasks = useData(() => api("/api/tasks"));
  const projects = useData(() => api("/api/projects"));
  const [f, setF] = useState({ title: "", priority: 2, due_at: "", remind_at: "", project_id: "" });
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    if (!f.title.trim()) return;
    try {
      await api("/api/tasks", { method: "POST", json: { title: f.title, priority: Number(f.priority),
        due_at: f.due_at ? new Date(f.due_at).toISOString() : null, remind_at: f.remind_at ? new Date(f.remind_at).toISOString() : null,
        project_id: f.project_id ? Number(f.project_id) : null } });
      setF({ ...f, title: "", due_at: "", remind_at: "" }); tasks.reload();
    } catch (e: any) { setError(e.message); }
  };
  const patch = async (id: number, body: any) => { await api(`/api/tasks/${id}`, { method: "PATCH", json: body }); tasks.reload(); };
  return (
    <div>
      <PageHeader title="Opgaver" subtitle="Prioritér, sæt deadlines og påmindelser. Jarvis kan også oprette og planlægge opgaver for dig." />
      <ErrorNote error={error || tasks.error} />
      <Card className="mb-6">
        <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto_auto_auto]">
          <Input placeholder="Ny opgave…" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} onKeyDown={(e) => e.key === "Enter" && create()} />
          <Select value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) })}>{[1, 2, 3, 4].map((p) => <option key={p} value={p}>P{p}</option>)}</Select>
          <label className="text-xs text-muted">Deadline<Input type="datetime-local" value={f.due_at} onChange={(e) => setF({ ...f, due_at: e.target.value })} /></label>
          <label className="text-xs text-muted">Påmindelse<Input type="datetime-local" value={f.remind_at} onChange={(e) => setF({ ...f, remind_at: e.target.value })} /></label>
          <Select value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
            <option value="">Intet projekt</option>{(projects.data || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Button onClick={create}><Plus className="h-4 w-4" />Tilføj</Button>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        {COLS.map(([status, label]) => {
          const items = (tasks.data || []).filter((t: any) => t.status === status);
          return (
            <Card key={status} title={<>{label} <span className="text-muted">({items.length})</span></>}>
              <div className="space-y-2">
                {items.map((t: any) => {
                  const overdue = t.due_at && status !== "done" && new Date(t.due_at) < new Date();
                  return (
                    <div key={t.id} className="group rounded-xl border border-line bg-panel2 p-3">
                      <div className="flex items-start gap-2">
                        <input type="checkbox" checked={status === "done"} onChange={(e) => patch(t.id, { status: e.target.checked ? "done" : "todo" })} className="mt-1 accent-[#5b8cff]" />
                        <div className={cx("flex-1 text-sm", status === "done" && "text-muted line-through")}>{t.title}</div>
                        <button className="hidden text-muted hover:text-bad group-hover:block" onClick={async () => { await api(`/api/tasks/${t.id}`, { method: "DELETE" }); tasks.reload(); }}><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <Badge tone={t.priority === 1 ? "bad" : t.priority === 2 ? "warn" : "default"}>P{t.priority}</Badge>
                        {t.due_at && <span className={overdue ? "text-bad" : "text-muted"}>{fmtDate(t.due_at)}</span>}
                        <Select className="ml-auto py-1 text-xs" value={status} onChange={(e) => patch(t.id, { status: e.target.value })}>
                          {COLS.map(([s, l]) => <option key={s} value={s}>{l}</option>)}
                        </Select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
