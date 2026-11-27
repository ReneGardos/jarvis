"use client";
import { useRef, useState } from "react";
import { Download, FileText, Search, Sparkles, Trash2, Upload } from "lucide-react";
import { API, api, fmtBytes, fmtDate } from "@/lib/api";
import ChatView from "@/components/ChatView";
import { Badge, Button, Card, Empty, ErrorNote, Input, PageHeader, useData } from "@/components/ui";

export default function Documents() {
  const docs = useData(() => api("/api/documents"));
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<any[] | null>(null);
  const [summary, setSummary] = useState<Record<number, string>>({});
  const upload = async (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      const fd = new FormData(); fd.append("file", f);
      try { await api("/api/documents", { method: "POST", body: fd }); } catch (e: any) { setError(`${f.name}: ${e.message}`); }
    }
    setBusy(false); docs.reload();
  };
  const summarize = async (id: number) => {
    setSummary((s) => ({ ...s, [id]: "Laver resumé…" }));
    try { const r = await api(`/api/documents/${id}/summarize`, { method: "POST" }); setSummary((s) => ({ ...s, [id]: r.summary })); }
    catch (e: any) { setSummary((s) => ({ ...s, [id]: e.message })); }
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Dokumenter" subtitle="PDF, Word, Excel, PowerPoint, TXT, CSV, kode og billeder. Alt indekseres lokalt, så Jarvis kan søge og svare ud fra dine filer."
        actions={<><input ref={file} type="file" multiple hidden onChange={(e) => upload(e.target.files)}
          accept=".pdf,.docx,.xlsx,.xlsm,.pptx,.txt,.csv,.md,.json,.py,.ts,.tsx,.js,.jsx,.html,.css,.sql,.yml,.yaml,.png,.jpg,.jpeg,.webp" />
          <Button loading={busy} onClick={() => file.current?.click()}><Upload className="h-4 w-4" />Upload</Button></>} />
      <ErrorNote error={error || docs.error} />
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}
        className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">Træk filer hertil for at uploade</div>
      <Card title="Søg i dokumenter">
        <form className="mb-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); try { setHits(await api(`/api/documents-search?q=${encodeURIComponent(q)}`)); } catch (er: any) { setError(er.message); } }}>
          <Input placeholder="Hvad leder du efter?" value={q} onChange={(e) => setQ(e.target.value)} /><Button variant="subtle"><Search className="h-4 w-4" /></Button>
        </form>
        {hits?.map((h, i) => <div key={i} className="border-b border-line/60 py-2 text-sm last:border-0"><Badge tone="accent">{h.filename}</Badge> <span className="text-xs text-muted">relevans {h.score.toFixed(2)}</span><p className="mt-1 line-clamp-3 text-muted">{h.text}</p></div>)}
        {hits && !hits.length && <p className="text-sm text-muted">Intet fundet.</p>}
      </Card>
      <Card title={`Bibliotek (${docs.data?.length || 0})`}>
        {!docs.data?.length && <Empty>Ingen dokumenter endnu.</Empty>}
        <div className="divide-y divide-line/60">
          {(docs.data || []).map((d: any) => (
            <div key={d.id} className="py-3">
              <div className="flex items-center gap-3">
                <FileText className="h-4 w-4 shrink-0 text-accent" />
                <div className="min-w-0 flex-1"><div className="truncate text-sm">{d.filename}</div>
                  <div className="text-xs text-muted">{fmtBytes(d.size)} · {fmtDate(d.created_at)} · {d.chunk_count} afsnit {d.folder && `· ${d.folder}`}</div></div>
                <Badge tone={d.status === "ready" ? "ok" : d.status === "processing" ? "warn" : "bad"}>{d.status}</Badge>
                <button title="Resumé" className="p-1 text-muted hover:text-white" onClick={() => summarize(d.id)}><Sparkles className="h-4 w-4" /></button>
                <a title="Download" className="p-1 text-muted hover:text-white" href={`${API}/api/documents/${d.id}/download`}><Download className="h-4 w-4" /></a>
                <button title="Slet" className="p-1 text-muted hover:text-bad" onClick={async () => { await api(`/api/documents/${d.id}`, { method: "DELETE" }); docs.reload(); }}><Trash2 className="h-4 w-4" /></button>
              </div>
              {summary[d.id] && <p className="mt-2 whitespace-pre-wrap rounded-xl bg-panel2 p-3 text-sm">{summary[d.id]}</p>}
            </div>
          ))}
        </div>
      </Card>
      <div><h2 className="mb-2 text-sm font-semibold">Document Agent</h2>
        <ChatView defaultAgent="document" showList={false} placeholder="Spørg om dine dokumenter, eller bed om et nyt dokument…"
          starters={["Find alle deadlines i mine kontrakter", "Sammenlign de to seneste tilbud", "Lav et Word-dokument med et mødereferat"]} /></div>
    </div>
  );
}
