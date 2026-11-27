"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Globe, Trash2 } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { Button, Card, ErrorNote, Input, PageHeader, Select, useData } from "@/components/ui";

export default function Research() {
  const items = useData(() => api("/api/research"));
  const [q, setQ] = useState(""); const [depth, setDepth] = useState("normal");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const run = async () => {
    setBusy(true); setError(null);
    try { const r = await api("/api/research", { method: "POST", json: { query: q, depth } }); setOpen(r.id); setQ(""); items.reload(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Internet Research" subtitle="Research-agenten søger via din lokale SearXNG (Google, Bing, DuckDuckGo m.fl.), læser kilderne og skriver en rapport med kildehenvisninger. Rapporter gemmes." />
      <ErrorNote error={error || items.error} />
      <Card>
        <div className="flex flex-col gap-2 md:flex-row">
          <Input placeholder="Fx: Sammenlign priser på 27'' 4K-skærme i Danmark" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && q && run()} />
          <Select value={depth} onChange={(e) => setDepth(e.target.value)}><option value="normal">Normal</option><option value="deep">Grundig</option></Select>
          <Button loading={busy} disabled={!q} onClick={run}><Globe className="h-4 w-4" />Undersøg</Button>
        </div>
        {busy && <p className="mt-3 text-sm text-muted">Søger og læser kilder… det kan tage et par minutter med lokale modeller.</p>}
      </Card>
      {(items.data || []).map((r: any) => (
        <Card key={r.id} title={<button className="text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>{r.query}</button>}
          actions={<><span className="text-xs text-muted">{fmtDate(r.created_at)}</span>
            <button className="text-muted hover:text-bad" onClick={async () => { await api(`/api/research/${r.id}`, { method: "DELETE" }); items.reload(); }}><Trash2 className="h-4 w-4" /></button></>}>
          {open === r.id ? (<>
            <div className="prose-jarvis"><ReactMarkdown remarkPlugins={[remarkGfm]}>{r.report}</ReactMarkdown></div>
            {!!r.sources?.length && <div className="mt-4 border-t border-line pt-3 text-xs">{r.sources.map((s: any, i: number) => s.url &&
              <div key={i} className="truncate"><a className="text-accent hover:underline" href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.url}</a></div>)}</div>}
          </>) : <p className="line-clamp-2 text-sm text-muted">{r.report}</p>}
        </Card>
      ))}
    </div>
  );
}
