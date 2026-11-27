"use client";
import { useState } from "react";
import { Download, KeyRound, Plus, Trash2 } from "lucide-react";
import { API, api } from "@/lib/api";
import { Badge, Button, Card, ErrorNote, Input, PageHeader, Select, useData } from "@/components/ui";

const TIER: Record<string, string> = { local_small: "Lokal – hurtig", local_large: "Lokal – stor", local_code: "Lokal – kode", cloud: "Cloud" };

export default function Models() {
  const m = useData(() => api("/api/models"));
  const usage = useData(() => api("/api/models/usage"));
  const secrets = useData(() => api("/api/secrets"));
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState({ provider: "ollama", model: "", label: "", tier: "local_small", context_window: 16384, base_url: "", secret_name: "", cost_in_dkk_per_mtok: 0, cost_out_dkk_per_mtok: 0 });
  const [pull, setPull] = useState(""); const [pullLog, setPullLog] = useState("");
  const [sec, setSec] = useState({ name: "anthropic_api_key", value: "" });
  const prefs = m.data?.preferences || {};
  const run = async (fn: () => Promise<any>) => { try { await fn(); m.reload(); secrets.reload(); } catch (e: any) { setError(e.message); } };
  const doPull = async () => {
    setPullLog("Starter…");
    const res = await fetch(`${API}/api/models/ollama/pull?model=${encodeURIComponent(pull)}`, { method: "POST", credentials: "include" });
    const reader = res.body!.getReader(); const dec = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      const lines = dec.decode(value).trim().split("\n");
      try { const d = JSON.parse(lines[lines.length - 1]); setPullLog(d.total ? `${d.status} ${Math.round((d.completed || 0) / d.total * 100)}%` : d.status || d.error); } catch {}
    }
    m.reload();
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Model Management" subtitle="Lokale modeller prioriteres. Cloudmodeller bruges ved komplekse opgaver, så længe månedsbudgettet ikke er nået. Nye modeller tilføjes uden kodeændringer." />
      <ErrorNote error={error || m.error} />
      <Card title="Routing">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!prefs.prefer_cloud} onChange={(e) => run(() => api("/api/models/preferences", { method: "PUT", json: { ...prefs, prefer_cloud: e.target.checked } }))} />Foretræk cloud</label>
          <label className="flex items-center gap-2">Cloudbudget pr. måned (kr)
            <Input type="number" className="w-28" defaultValue={prefs.cloud_budget_dkk ?? 400} onBlur={(e) => run(() => api("/api/models/preferences", { method: "PUT", json: { ...prefs, cloud_budget_dkk: Number(e.target.value) } }))} /></label>
        </div>
      </Card>
      <Card title="Modeller">
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="py-2">Model</th><th>Udbyder</th><th>Klasse</th><th>Status</th><th>Pris ind/ud (kr/M)</th><th /></tr></thead>
          <tbody>{(m.data?.models || []).map((x: any) => (
            <tr key={x.id} className="border-t border-line/60">
              <td className="py-2"><div>{x.label || x.model}</div><div className="font-mono text-xs text-muted">{x.model}</div></td>
              <td>{x.provider}</td>
              <td><Select className="py-1 text-xs" value={x.tier} onChange={(e) => run(() => api(`/api/models/${x.id}`, { method: "PATCH", json: { tier: e.target.value } }))}>
                {Object.entries(TIER).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></td>
              <td className="space-x-1"><Badge tone={x.available ? "ok" : "bad"}>{x.available ? "klar" : "offline"}</Badge>
                <button onClick={() => run(() => api(`/api/models/${x.id}`, { method: "PATCH", json: { enabled: !x.enabled } }))}><Badge tone={x.enabled ? "accent" : "default"}>{x.enabled ? "aktiv" : "slået fra"}</Badge></button></td>
              <td className="text-xs text-muted">{x.cost_in_dkk_per_mtok} / {x.cost_out_dkk_per_mtok}</td>
              <td><button className="text-muted hover:text-bad" onClick={() => run(() => api(`/api/models/${x.id}`, { method: "DELETE" }))}><Trash2 className="h-4 w-4" /></button></td>
            </tr>))}</tbody></table></div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Tilføj model">
          <div className="grid gap-2 md:grid-cols-2">
            <Select value={n.provider} onChange={(e) => setN({ ...n, provider: e.target.value, tier: e.target.value === "ollama" ? "local_small" : "cloud" })}>
              {(m.data?.providers || []).map((p: string) => <option key={p}>{p}</option>)}</Select>
            <Input placeholder="Model-id, fx llama3.1:8b" value={n.model} onChange={(e) => setN({ ...n, model: e.target.value })} />
            <Input placeholder="Visningsnavn" value={n.label} onChange={(e) => setN({ ...n, label: e.target.value })} />
            <Select value={n.tier} onChange={(e) => setN({ ...n, tier: e.target.value })}>{Object.entries(TIER).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
            {n.provider !== "ollama" && <>
              <Input placeholder="Nøglenavn, fx openai_api_key" value={n.secret_name} onChange={(e) => setN({ ...n, secret_name: e.target.value })} />
              <Input placeholder="Base-URL (kun OpenAI-kompatibel)" value={n.base_url} onChange={(e) => setN({ ...n, base_url: e.target.value })} />
              <Input type="number" placeholder="Pris ind kr/M tokens" onChange={(e) => setN({ ...n, cost_in_dkk_per_mtok: Number(e.target.value) })} />
              <Input type="number" placeholder="Pris ud kr/M tokens" onChange={(e) => setN({ ...n, cost_out_dkk_per_mtok: Number(e.target.value) })} /></>}
          </div>
          <Button className="mt-3" disabled={!n.model} onClick={() => run(() => api("/api/models", { method: "POST", json: n }))}><Plus className="h-4 w-4" />Tilføj</Button>
          <div className="mt-6 border-t border-line pt-4">
            <div className="mb-2 text-sm font-medium">Download lokal model (Ollama)</div>
            <div className="flex gap-2"><Input placeholder="fx qwen2.5:7b-instruct" value={pull} onChange={(e) => setPull(e.target.value)} />
              <Button variant="subtle" disabled={!pull} onClick={doPull}><Download className="h-4 w-4" />Hent</Button></div>
            {pullLog && <p className="mt-2 text-xs text-muted">{pullLog}</p>}
          </div>
        </Card>
        <Card title="API-nøgler (krypteret)">
          {(secrets.data || []).map((s: any) => (
            <div key={s.name} className="flex items-center gap-2 border-b border-line/60 py-2 text-sm"><KeyRound className="h-4 w-4 text-accent" /><span className="flex-1">{s.name}</span>
              <span className="font-mono text-xs text-muted">{s.masked}</span>
              <button className="text-muted hover:text-bad" onClick={() => run(() => api(`/api/secrets/${s.name}`, { method: "DELETE" }))}><Trash2 className="h-4 w-4" /></button></div>
          ))}
          <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <Input value={sec.name} onChange={(e) => setSec({ ...sec, name: e.target.value })} />
            <Input type="password" placeholder="Nøgle" value={sec.value} onChange={(e) => setSec({ ...sec, value: e.target.value })} />
            <Button disabled={!sec.value} onClick={() => run(async () => { await api("/api/secrets", { method: "PUT", json: sec }); setSec({ ...sec, value: "" }); })}>Gem</Button>
          </div>
          <p className="mt-2 text-xs text-muted">Nøgler krypteres med din master key og vises aldrig igen i klartekst.</p>
        </Card>
      </div>
      <Card title="Forbrug (30 dage)">
        <table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="py-2">Model</th><th>Kald</th><th>Tokens ind</th><th>Tokens ud</th><th>Pris</th></tr></thead>
          <tbody>{(usage.data || []).map((u: any) => <tr key={u.provider + u.model} className="border-t border-line/60"><td className="py-2">{u.provider}:{u.model}</td><td>{u.calls}</td>
            <td>{u.tokens_in.toLocaleString("da-DK")}</td><td>{u.tokens_out.toLocaleString("da-DK")}</td><td>{u.cost_dkk} kr</td></tr>)}</tbody></table>
      </Card>
    </div>
  );
}
