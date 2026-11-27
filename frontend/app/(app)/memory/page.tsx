"use client";
import { useState } from "react";
import { Pin, Plus, Save, Search, Trash2 } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { Badge, Button, Card, cx, Empty, ErrorNote, Input, PageHeader, Select, Textarea, useData } from "@/components/ui";

const KINDS = ["preference", "fact", "project", "decision", "plan", "person", "task"];
const DA: Record<string, string> = { preference: "Præference", fact: "Fakta", project: "Projekt", decision: "Beslutning", plan: "Plan", person: "Person", task: "Opgave" };

export default function Memory() {
  const [q, setQ] = useState(""); const [kind, setKind] = useState(""); const [tier, setTier] = useState("");
  const [search, setSearch] = useState("");
  const m = useData(() => api(`/api/memory?${new URLSearchParams({ ...(search && { q: search }), ...(kind && { kind }), ...(tier && { tier }) })}`), [search, kind, tier]);
  const [n, setN] = useState({ kind: "preference", content: "", importance: 0.7 });
  const [edit, setEdit] = useState<{ id: number; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<any>) => { try { await fn(); m.reload(); } catch (e: any) { setError(e.message); } };
  return (
    <div>
      <PageHeader title="Hukommelse" subtitle="Alt Jarvis husker om dig. Korttidshukommelse udløber efter 14 dage, medmindre den bruges eller er vigtig. Du kan se, rette og slette alt." />
      <ErrorNote error={error || m.error} />
      <Card className="mb-6" title="Tilføj minde">
        <div className="grid gap-2 md:grid-cols-[auto_1fr_auto_auto]">
          <Select value={n.kind} onChange={(e) => setN({ ...n, kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{DA[k]}</option>)}</Select>
          <Input placeholder="Fx: Jeg foretrækker korte svar om morgenen" value={n.content} onChange={(e) => setN({ ...n, content: e.target.value })} />
          <label className="flex items-center gap-2 text-xs text-muted">Vigtighed<input type="range" min={0} max={1} step={0.1} value={n.importance} onChange={(e) => setN({ ...n, importance: Number(e.target.value) })} /></label>
          <Button disabled={n.content.length < 3} onClick={() => run(async () => { await api("/api/memory", { method: "POST", json: n }); setN({ ...n, content: "" }); })}><Plus className="h-4 w-4" />Gem</Button>
        </div>
      </Card>
      <div className="mb-4 flex flex-wrap gap-2">
        <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(q); }}>
          <Input placeholder="Semantisk søgning i hukommelsen…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button variant="subtle" type="submit"><Search className="h-4 w-4" /></Button>
        </form>
        <Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Alle typer</option>{KINDS.map((k) => <option key={k} value={k}>{DA[k]}</option>)}</Select>
        <Select value={tier} onChange={(e) => setTier(e.target.value)}><option value="">Kort + lang</option><option value="short">Korttid</option><option value="long">Langtid</option></Select>
      </div>
      <div className="space-y-2">
        {!m.loading && !m.data?.length && <Empty>Ingen minder endnu. Jarvis lærer automatisk, mens I taler sammen.</Empty>}
        {(m.data || []).map((x: any) => (
          <div key={x.id} className="flex items-start gap-3 rounded-2xl border border-line bg-panel p-4">
            <div className="flex w-28 shrink-0 flex-col gap-1">
              <Badge tone="accent">{DA[x.kind] || x.kind}</Badge>
              <Badge tone={x.tier === "long" ? "ok" : "default"}>{x.tier === "long" ? "Langtid" : "Korttid"}</Badge>
            </div>
            <div className="min-w-0 flex-1">
              {edit?.id === x.id ? (
                <div className="flex gap-2"><Textarea value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} />
                  <Button onClick={() => run(async () => { await api(`/api/memory/${x.id}`, { method: "PATCH", json: { content: edit.content } }); setEdit(null); })}><Save className="h-4 w-4" /></Button></div>
              ) : <button className="text-left text-sm" onClick={() => setEdit({ id: x.id, content: x.content })}>{x.content}</button>}
              <div className="mt-1 text-xs text-muted">Vigtighed {x.importance.toFixed(1)} · brugt {x.access_count}× · {fmtDate(x.updated_at)}{x.expires_at && ` · udløber ${fmtDate(x.expires_at, { dateStyle: "short" })}`}</div>
            </div>
            <button title="Fastgør (altid med i konteksten)" className={cx("p-1", x.pinned ? "text-accent" : "text-muted hover:text-white")} onClick={() => run(() => api(`/api/memory/${x.id}`, { method: "PATCH", json: { pinned: !x.pinned } }))}><Pin className="h-4 w-4" /></button>
            {x.tier === "short" && <button className="text-xs text-muted hover:text-white" onClick={() => run(() => api(`/api/memory/${x.id}`, { method: "PATCH", json: { tier: "long" } }))}>Gør permanent</button>}
            <button className="p-1 text-muted hover:text-bad" onClick={() => run(() => api(`/api/memory/${x.id}`, { method: "DELETE" }))}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
