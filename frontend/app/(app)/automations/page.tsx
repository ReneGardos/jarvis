"use client";
import { useState } from "react";
import { Play, Plus, Trash2 } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { Badge, Button, Card, ErrorNote, Input, PageHeader, Select, Textarea, useData } from "@/components/ui";

const PRESETS = [["0 7 * * 1-5", "Hverdage kl. 7"], ["0 8 * * *", "Dagligt kl. 8"], ["0 17 * * 5", "Fredag kl. 17"], ["0 * * * *", "Hver time"], ["*/15 * * * *", "Hvert 15. minut"]];

export default function Automations() {
  const a = useData(() => api("/api/automations"));
  const [f, setF] = useState<any>({ name: "", kind: "daily_report", cron: "0 7 * * 1-5", config: {} });
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<number | null>(null);
  const cfg = (k: string, v: any) => setF({ ...f, config: { ...f.config, [k]: v } });
  const create = async () => {
    try { await api("/api/automations", { method: "POST", json: f }); setF({ ...f, name: "", config: {} }); a.reload(); } catch (e: any) { setError(e.message); }
  };
  const toggle = async (x: any) => { await api(`/api/automations/${x.id}`, { method: "PUT", json: { name: x.name, kind: x.kind, cron: x.cron, config: x.config, enabled: !x.enabled } }); a.reload(); };
  const run = async (id: number) => { setRunning(id); try { await api(`/api/automations/${id}/run`, { method: "POST" }); } catch (e: any) { setError(e.message); } setRunning(null); a.reload(); };
  return (
    <div className="space-y-6">
      <PageHeader title="Automatiseringer" subtitle="Planlagte opgaver der kører 24/7 (tidszone Europe/Copenhagen). Resultater sendes til dashboard og mobil (ntfy). Handlinger med konsekvenser lander i Godkendelser." />
      <ErrorNote error={error || a.error} />
      <Card title="Ny automatisering">
        <div className="grid gap-2 md:grid-cols-2">
          <Input placeholder="Navn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, config: {} })}>
            {Object.entries(a.data?.kinds || {}).map(([k, d]) => <option key={k} value={k}>{d as string}</option>)}
          </Select>
          <div className="flex gap-2">
            <Input className="font-mono" placeholder="cron" value={f.cron} onChange={(e) => setF({ ...f, cron: e.target.value })} />
            <Select onChange={(e) => e.target.value && setF({ ...f, cron: e.target.value })} value=""><option value="">Forvalg…</option>{PRESETS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select>
          </div>
          {f.kind === "agent_prompt" && <>
            <Select value={f.config.agent || "main"} onChange={(e) => cfg("agent", e.target.value)}>
              {["main", "research", "planning", "business", "marketing", "finance", "personal", "document"].map((x) => <option key={x}>{x}</option>)}</Select>
            <Textarea className="md:col-span-2" placeholder="Prompt, fx: Find de 5 vigtigste nyheder om AI i dag og opsummér dem" value={f.config.prompt || ""} onChange={(e) => cfg("prompt", e.target.value)} /></>}
          {f.kind === "url_check" && <>
            <Input placeholder="URL" value={f.config.url || ""} onChange={(e) => cfg("url", e.target.value)} />
            <Input placeholder="Tekst der skal tjekkes for, fx 'På lager'" value={f.config.contains || ""} onChange={(e) => cfg("contains", e.target.value)} />
            <Select value={f.config.notify_when || "found"} onChange={(e) => cfg("notify_when", e.target.value)}><option value="found">Giv besked når teksten findes</option><option value="missing">Giv besked når teksten mangler</option></Select></>}
          {f.kind === "notify" && <Input placeholder="Besked" value={f.config.message || ""} onChange={(e) => cfg("message", e.target.value)} />}
          <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={(f.config.channels || ["dashboard", "push"]).includes("email")}
            onChange={(e) => cfg("channels", e.target.checked ? ["dashboard", "push", "email"] : ["dashboard", "push"])} />Send også på e-mail</label>
        </div>
        <Button className="mt-3" disabled={!f.name} onClick={create}><Plus className="h-4 w-4" />Opret</Button>
      </Card>
      <div className="space-y-3">
        {(a.data?.items || []).map((x: any) => (
          <Card key={x.id} title={x.name} actions={<>
            <Badge tone={x.enabled ? "ok" : "default"}>{x.enabled ? "Aktiv" : "Pauset"}</Badge>
            <Button variant="subtle" onClick={() => toggle(x)}>{x.enabled ? "Pause" : "Aktivér"}</Button>
            <Button variant="subtle" loading={running === x.id} onClick={() => run(x.id)}><Play className="h-4 w-4" />Kør nu</Button>
            <button className="p-1 text-muted hover:text-bad" onClick={async () => { await api(`/api/automations/${x.id}`, { method: "DELETE" }); a.reload(); }}><Trash2 className="h-4 w-4" /></button></>}>
            <div className="text-xs text-muted"><span className="font-mono">{x.cron}</span> · {x.kind} · næste kørsel {fmtDate(x.next_run_at) || "–"} · sidst {fmtDate(x.last_run_at) || "aldrig"}
              {x.last_status && <> · <Badge tone={x.last_status === "ok" ? "ok" : "bad"}>{x.last_status}</Badge></>}</div>
            {x.last_output && <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-panel2 p-3 text-xs">{x.last_output}</pre>}
          </Card>
        ))}
      </div>
    </div>
  );
}
