"use client";
import { useState } from "react";
import { DatabaseBackup } from "lucide-react";
import { api, fmtBytes, fmtDate } from "@/lib/api";
import { Badge, Button, Card, ErrorNote, Input, PageHeader, Select, useData } from "@/components/ui";

const LEVELS: Record<number, string> = { 0: "Kun læsning", 1: "Læsning + oprette egne data (anbefalet)", 2: "Også ændre filer/aftaler uden at spørge" };

export default function Settings() {
  const policy = useData(() => api("/api/security/policy"));
  const audit = useData(() => api("/api/security/audit?limit=100"));
  const sessions = useData(() => api("/api/auth/sessions"));
  const backups = useData(() => api("/api/backups"));
  const voice = useData(() => api("/api/voice/status"));
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const [msg, setMsg] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<any>, ok?: string) => { setError(null); try { await fn(); ok && setMsg(ok); } catch (e: any) { setError(e.message); } };
  const p = policy.data;
  const savePolicy = (patch: any) => run(async () => { await api("/api/security/policy", { method: "PUT", json: { auto_allow_max: p.auto_allow_max, disabled_tools: p.disabled_tools, ...patch } }); policy.reload(); });
  return (
    <div className="space-y-6">
      <PageHeader title="Systemindstillinger" subtitle="Sikkerhed, rettigheder, backup og aktivitetslog. Disse indstillinger kan kun ændres af dig – aldrig af AI'en." />
      <ErrorNote error={error} />{msg && <div className="rounded-xl bg-ok/10 px-3 py-2 text-sm text-ok">{msg}</div>}
      {p && <Card title="AI-rettigheder">
        <label className="mb-4 flex flex-wrap items-center gap-3 text-sm">Må gøre uden godkendelse:
          <Select value={p.auto_allow_max} onChange={(e) => savePolicy({ auto_allow_max: Number(e.target.value) })}>
            {Object.entries(LEVELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></label>
        <p className="mb-3 text-xs text-muted">Eksterne handlinger, økonomi/jura og sikkerhed kræver altid godkendelse eller er forbudt. Når en samtale indeholder indhold fra internettet eller dokumenter, kræver alle skrivende handlinger godkendelse (beskyttelse mod prompt injection).</p>
        <div className="grid gap-1 md:grid-cols-2">{p.tools.map((t: any) => (
          <label key={t.name} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-panel2">
            <input type="checkbox" checked={!p.disabled_tools.includes(t.name)} onChange={(e) => savePolicy({ disabled_tools: e.target.checked ? p.disabled_tools.filter((x: string) => x !== t.name) : [...p.disabled_tools, t.name] })} />
            <span className="font-mono text-xs">{t.name}</span><Badge tone={t.risk >= 3 ? "bad" : t.risk >= 2 ? "warn" : "default"}>{t.risk_name}</Badge></label>))}</div>
      </Card>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Skift adgangskode">
          <div className="space-y-2">
            <Input type="password" placeholder="Nuværende" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
            <Input type="password" placeholder="Ny (mindst 12 tegn)" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
            <Button disabled={pw.new_password.length < 12} onClick={() => run(async () => { await api("/api/auth/password", { method: "POST", json: pw }); window.location.href = "/login"; })}>Skift</Button>
          </div>
        </Card>
        <Card title="Aktive sessioner" actions={<Button variant="danger" onClick={() => run(async () => { await api("/api/auth/sessions/revoke-all", { method: "POST" }); window.location.href = "/login"; })}>Log alle ud</Button>}>
          {(sessions.data || []).map((s: any) => <div key={s.id} className="border-b border-line/60 py-1.5 text-xs"><span className="text-white">{s.ip}</span> · {fmtDate(s.created_at)}<div className="truncate text-muted">{s.user_agent}</div></div>)}
        </Card>
        <Card title="Backup" actions={<Button loading={busy} onClick={async () => { setBusy(true); await run(() => api("/api/backups", { method: "POST" }), "Backup oprettet"); setBusy(false); backups.reload(); }}><DatabaseBackup className="h-4 w-4" />Tag backup nu</Button>}>
          <p className="mb-2 text-xs text-muted">Automatisk hver nat kl. 03:17. De seneste 14 gemmes krypteret. Gendan med scripts/restore.sh.</p>
          <Button variant="ghost" className="mb-3" onClick={() => run(async () => { const r = await api("/api/maintenance/reindex", { method: "POST" }); setMsg(`Genindekseret: ${r.memories} minder, ${r.documents} dokumenter`); })}>Genindeksér søgning</Button>
          {(backups.data || []).map((b: any) => <div key={b.file} className="flex justify-between border-b border-line/60 py-1.5 text-xs"><span className="font-mono">{b.file}</span><span className="text-muted">{fmtBytes(b.bytes)}</span></div>)}
        </Card>
        <Card title="Stemme">
          {voice.data && <div className="space-y-1 text-sm"><div>Whisper-model: <Badge>{voice.data.whisper_model}</Badge></div>
            <div>Piper-stemmer: {voice.data.piper_voices.length ? voice.data.piper_voices.map((v: string) => <Badge key={v} tone="ok">{v}</Badge>) : <Badge tone="warn">ingen – kør scripts/download_voices.sh</Badge>}</div></div>}
        </Card>
      </div>
      <Card title="Aktivitetslog">
        <div className="max-h-[480px] overflow-auto"><table className="w-full text-xs">
          <thead className="sticky top-0 bg-panel text-left text-muted"><tr><th className="py-1">Tid</th><th>Aktør</th><th>Handling</th><th>Mål</th><th>Beslutning</th></tr></thead>
          <tbody>{(audit.data || []).map((a: any) => <tr key={a.id} className="border-t border-line/60"><td className="whitespace-nowrap py-1 pr-2">{fmtDate(a.ts)}</td><td className="pr-2">{a.actor}</td>
            <td className="pr-2 font-mono">{a.action}</td><td className="max-w-xs truncate pr-2 text-muted">{a.target}</td>
            <td>{a.decision && <Badge tone={a.decision === "allow" ? "ok" : a.decision === "deny" ? "bad" : "warn"}>{a.decision}</Badge>}</td></tr>)}</tbody></table></div>
      </Card>
    </div>
  );
}
