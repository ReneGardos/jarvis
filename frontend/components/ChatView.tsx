"use client";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Loader2, Plus, Send, Square, Trash2, Wrench, X } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { Msg, useChat } from "@/lib/useChat";
import { Badge, Button, cx, Select, Textarea, useData } from "./ui";

const AGENTS = [["main", "Jarvis (automatisk)"], ["personal", "Personal"], ["research", "Research"], ["developer", "Developer"],
  ["business", "Business"], ["marketing", "Marketing"], ["finance", "Finance"], ["planning", "Planning"], ["document", "Document"]];

export function ApprovalInline({ a }: { a: { id: number; tool: string; args: any } }) {
  const [state, setState] = useState<"pending" | "done" | "rejected" | "error">("pending");
  const [msg, setMsg] = useState("");
  const act = async (ok: boolean) => {
    try {
      const r = await api(`/api/approvals/${a.id}/${ok ? "approve" : "reject"}`, { method: "POST" });
      setState(ok ? (r.ok ? "done" : "error") : "rejected");
      setMsg(ok ? (r.ok ? "Udført" : r.error) : "Afvist");
    } catch (e: any) { setState("error"); setMsg(e.message); }
  };
  return (
    <div className="mt-2 rounded-xl border border-warn/30 bg-warn/5 p-3 text-xs">
      <div className="mb-1 font-medium text-warn">Kræver godkendelse #{a.id}: {a.tool}</div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-muted">{JSON.stringify(a.args, null, 2).slice(0, 2000)}</pre>
      {state === "pending" ? (
        <div className="mt-2 flex gap-2">
          <Button onClick={() => act(true)} className="px-2.5 py-1 text-xs"><Check className="h-3 w-3" />Godkend</Button>
          <Button variant="danger" onClick={() => act(false)} className="px-2.5 py-1 text-xs"><X className="h-3 w-3" />Afvis</Button>
        </div>
      ) : <div className={cx("mt-2", state === "done" ? "text-ok" : "text-muted")}>{msg}</div>}
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  if (m.role === "system") return <div className="mx-auto max-w-xl text-center text-xs text-muted">{m.content}</div>;
  const user = m.role === "user";
  const sources: any[] = m.meta?.sources || [];
  return (
    <div className={cx("flex animate-fadein", user && "justify-end")}>
      <div className={cx("max-w-[85%] rounded-2xl px-4 py-3", user ? "bg-accent text-white" : "border border-line bg-panel")}>
        {!user && (m.agent || m.model) && (
          <div className="mb-1 flex flex-wrap gap-1.5 text-[11px] text-muted">
            {m.agent && <Badge tone="accent">{m.agent}</Badge>}{m.model && <span>{m.model}</span>}
          </div>
        )}
        {m.live?.status && <div className="mb-2 flex items-center gap-2 text-xs text-muted"><Loader2 className="h-3 w-3 animate-spin" />{m.live.status}</div>}
        {m.live?.tools.map((t, i) => (
          <div key={i} className="mb-1 flex items-center gap-2 text-xs text-muted">
            <Wrench className="h-3 w-3" />{t.agent} → {t.tool}
            {t.ok === undefined ? <Loader2 className="h-3 w-3 animate-spin" /> : t.ok ? <Check className="h-3 w-3 text-ok" /> : <span className="text-bad">{t.error?.slice(0, 80)}</span>}
          </div>
        ))}
        {user ? <div className="whitespace-pre-wrap text-sm">{m.content}</div> : (
          <div className="prose-jarvis"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || (m.live ? "" : "…")}</ReactMarkdown></div>
        )}
        {m.live?.approvals.map((a) => <ApprovalInline key={a.id} a={a} />)}
        {!!sources.length && (
          <div className="mt-3 border-t border-line pt-2 text-xs text-muted">
            <div className="mb-1 font-medium">Kilder</div>
            {sources.slice(0, 10).map((s, i) => (
              <div key={i} className="truncate">[{i + 1}] {s.url ? <a className="text-accent hover:underline" href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.url}</a> : s.title}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatView({ defaultAgent = "main", showList = true, placeholder = "Skriv til Jarvis…", starters = [] as string[] }) {
  const chat = useChat(defaultAgent);
  const [text, setText] = useState("");
  const [agent, setAgent] = useState(defaultAgent);
  const [model, setModel] = useState("");
  const convs = useData(() => api("/api/conversations"), [chat.conversationId, chat.busy]);
  const models = useData(() => api("/api/models"), []);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [chat.messages]);

  const submit = async (t = text) => {
    if (!t.trim() || chat.busy) return;
    setText("");
    await chat.send(t.trim(), { agent, model: model || null });
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {showList && (
        <aside className="hidden w-64 shrink-0 flex-col rounded-2xl border border-line bg-panel p-3 lg:flex">
          <Button variant="subtle" onClick={chat.reset} className="mb-3"><Plus className="h-4 w-4" />Ny samtale</Button>
          <div className="flex-1 space-y-0.5 overflow-y-auto">
            {(convs.data || []).map((c: any) => (
              <div key={c.id} className={cx("group flex items-center rounded-lg px-2 py-1.5 text-sm", c.id === chat.conversationId ? "bg-panel2" : "hover:bg-panel2")}>
                <button className="min-w-0 flex-1 text-left" onClick={() => chat.open(c.id)}>
                  <div className="truncate">{c.title}</div>
                  <div className="text-[11px] text-muted">{fmtDate(c.updated_at)}</div>
                </button>
                <button className="hidden p-1 text-muted hover:text-bad group-hover:block" title="Slet"
                  onClick={async () => { await api(`/api/conversations/${c.id}`, { method: "DELETE" }); if (c.id === chat.conversationId) chat.reset(); convs.reload(); }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col rounded-2xl border border-line bg-panel/50">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Select value={agent} onChange={(e) => setAgent(e.target.value)}>
            {AGENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">Model: automatisk</option>
            {(models.data?.models || []).filter((m: any) => m.enabled).map((m: any) => (
              <option key={m.id} value={`${m.provider}:${m.model}`} disabled={!m.available}>{m.label || m.model}{!m.available ? " (offline)" : ""}</option>
            ))}
          </Select>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {!chat.messages.length && (
            <div className="grid h-full place-items-center">
              <div className="text-center">
                <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-accent/20 ring-2 ring-accent/40 animate-pulsering" />
                <p className="mb-4 text-muted">Hvad kan jeg hjælpe med?</p>
                <div className="flex max-w-xl flex-wrap justify-center gap-2">
                  {starters.map((s) => <button key={s} onClick={() => submit(s)} className="rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:bg-panel2 hover:text-white">{s}</button>)}
                </div>
              </div>
            </div>
          )}
          {chat.messages.map((m, i) => <Bubble key={m.id ?? `l${i}`} m={m} />)}
          <div ref={end} />
        </div>
        <form className="flex items-end gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Textarea rows={1} value={text} placeholder={placeholder} className="max-h-48 min-h-[42px] resize-none"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          {chat.busy ? <Button type="button" variant="ghost" onClick={chat.stop}><Square className="h-4 w-4" /></Button>
            : <Button type="submit" disabled={!text.trim()}><Send className="h-4 w-4" /></Button>}
        </form>
      </div>
    </div>
  );
}
