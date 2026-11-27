"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { Badge, Button, Card, ErrorNote, Input, PageHeader, Select, Textarea, useData } from "@/components/ui";

export default function Projects() {
  const p = useData(() => api("/api/projects"));
  const [f, setF] = useState({ name: "", description: "", folder: "", deadline: "", status: "active" });
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    try {
      await api("/api/projects", { method: "POST", json: { ...f, deadline: f.deadline ? new Date(f.deadline).toISOString() : null } });
      setF({ name: "", description: "", folder: "", deadline: "", status: "active" }); p.reload();
    } catch (e: any) { setError(e.message); }
  };
  const setStatus = async (x: any, status: string) => { await api(`/api/projects/${x.id}`, { method: "PATCH", json: { ...x, status } }); p.reload(); };
  return (
    <div>
      <PageHeader title="Projekter" subtitle="Projekter samler opgaver, dokumenter, samtaler og en projektmappe som Developer-agenten kan arbejde i." />
      <ErrorNote error={error || p.error} />
      <Card title="Nyt projekt" className="mb-6">
        <div className="grid gap-2 md:grid-cols-2">
          <Input placeholder="Navn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input placeholder="Projektmappe (fx mit-website, relativt til /workspace)" value={f.folder} onChange={(e) => setF({ ...f, folder: e.target.value })} />
          <Textarea placeholder="Beskrivelse og mål" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <div className="flex items-end gap-2">
            <label className="flex-1 text-xs text-muted">Deadline<Input type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></label>
            <Button onClick={create} disabled={!f.name}><Plus className="h-4 w-4" />Opret</Button>
          </div>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(p.data || []).map((x: any) => (
          <Card key={x.id} title={x.name} actions={<button className="text-muted hover:text-bad" onClick={async () => { await api(`/api/projects/${x.id}`, { method: "DELETE" }); p.reload(); }}><Trash2 className="h-4 w-4" /></button>}>
            <p className="mb-3 line-clamp-3 text-sm text-muted">{x.description || "Ingen beskrivelse"}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="accent">{x.open_tasks} åbne opgaver</Badge>
              {x.deadline && <Badge tone="warn">Frist {fmtDate(x.deadline, { dateStyle: "medium" })}</Badge>}
              {x.folder && <Badge>/{x.folder}</Badge>}
              <Select className="ml-auto py-1 text-xs" value={x.status} onChange={(e) => setStatus(x, e.target.value)}>
                <option value="active">Aktiv</option><option value="paused">Pause</option><option value="done">Afsluttet</option>
              </Select>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
