"use client";
import { useCallback, useRef, useState } from "react";
import { api, ChatEvent, streamChat } from "./api";

export type Msg = {
  id?: number;
  role: "user" | "assistant" | "system";
  content: string;
  agent?: string;
  model?: string;
  meta?: any;
  live?: { status?: string; tools: { tool: string; agent: string; ok?: boolean; error?: string }[]; approvals: { id: number; tool: string; args: any }[] };
};

export function useChat(defaultAgent: string = "main") {
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const open = useCallback(async (id: number) => {
    const c = await api(`/api/conversations/${id}`);
    setConversationId(id);
    setMessages(c.messages);
  }, []);

  const reset = () => { setConversationId(null); setMessages([]); };

  const send = useCallback(async (text: string, opts: { agent?: string | null; model?: string | null; onToken?: (t: string) => void } = {}) => {
    let id = conversationId;
    if (!id) {
      const c = await api("/api/conversations", { method: "POST", json: { agent: opts.agent || defaultAgent } });
      id = c.id as number;
      setConversationId(id);
    }
    setBusy(true);
    const live: Msg = { role: "assistant", content: "", live: { tools: [], approvals: [] } };
    setMessages((m) => [...m, { role: "user", content: text }, live]);
    const update = (fn: (m: Msg) => Msg) =>
      setMessages((all) => { const c = [...all]; c[c.length - 1] = fn({ ...c[c.length - 1], live: { ...c[c.length - 1].live! } }); return c; });
    abort.current = new AbortController();
    let full = "";
    try {
      await streamChat(id, { message: text, agent: opts.agent !== undefined ? opts.agent : defaultAgent, model: opts.model }, (e: ChatEvent) => {
        if (e.type === "token") { full += e.data.text; opts.onToken?.(e.data.text); update((m) => ({ ...m, content: full })); }
        else if (e.type === "status") update((m) => ({ ...m, live: { ...m.live!, status: e.data.message } }));
        else if (e.type === "plan") update((m) => ({ ...m, live: { ...m.live!, status: e.data.mode === "direct" ? "Tænker…" : "Fordeler opgaven…" } }));
        else if (e.type === "tool_call") update((m) => ({ ...m, live: { ...m.live!, tools: [...m.live!.tools, { tool: e.data.tool, agent: e.data.agent }] } }));
        else if (e.type === "tool_result") update((m) => {
          const tools = [...m.live!.tools]; const i = tools.map((t) => t.tool).lastIndexOf(e.data.tool);
          if (i >= 0) tools[i] = { ...tools[i], ok: e.data.ok, error: e.data.error };
          return { ...m, live: { ...m.live!, tools } };
        });
        else if (e.type === "approval") update((m) => ({ ...m, live: { ...m.live!, approvals: [...m.live!.approvals, e.data] } }));
        else if (e.type === "sources") update((m) => ({ ...m, meta: { ...(m.meta || {}), sources: e.data.sources } }));
        else if (e.type === "error") update((m) => ({ ...m, content: m.content + `\n\n⚠️ ${e.data.message}` }));
        else if (e.type === "done") update((m) => ({ ...m, live: { ...m.live!, status: undefined } }));
      }, abort.current.signal);
    } catch (err: any) {
      if (err.name !== "AbortError") update((m) => ({ ...m, content: m.content + `\n\n⚠️ ${err.message}` }));
    } finally {
      setBusy(false);
    }
    return full;
  }, [conversationId, defaultAgent]);

  const stop = () => abort.current?.abort();
  return { conversationId, messages, busy, send, open, reset, stop };
}
