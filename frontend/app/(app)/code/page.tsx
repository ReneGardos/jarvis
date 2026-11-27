"use client";
import { useState } from "react";
import { File, Folder } from "lucide-react";
import { api } from "@/lib/api";
import ChatView from "@/components/ChatView";
import { Card, ErrorNote, Input, PageHeader, useData } from "@/components/ui";

export default function Code() {
  const [path, setPath] = useState(".");
  const tree = useData(() => api(`/api/workspace/tree?path=${encodeURIComponent(path)}&depth=2`), [path]);
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openFile = async (p: string) => { try { setFile(await api(`/api/workspace/file?path=${encodeURIComponent(p)}`)); } catch (e: any) { setError(e.message); } };
  const join = (e: string) => (path === "." ? e : `${path.replace(/\/$/, "")}/${e}`);
  return (
    <div className="space-y-6">
      <PageHeader title="Programmering" subtitle="Developer-agenten læser og analyserer kode i dine projektmapper. Filændringer og kørsel af tests kræver altid din godkendelse, og der tages automatisk backup." />
      <ErrorNote error={error || tree.error} />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card title="Projektmapper">
          <Input value={path} onChange={(e) => setPath(e.target.value)} className="mb-3 font-mono text-xs" />
          <div className="max-h-[60vh] overflow-y-auto font-mono text-xs">
            {path !== "." && <button className="block py-0.5 text-muted hover:text-white" onClick={() => setPath(path.split("/").slice(0, -1).join("/") || ".")}>..</button>}
            {(tree.data?.entries || []).map((e: string) => (
              <button key={e} className="flex w-full items-center gap-1.5 truncate py-0.5 text-left hover:text-accent"
                onClick={() => e.endsWith("/") ? setPath(join(e.slice(0, -1))) : openFile(join(e))}>
                {e.endsWith("/") ? <Folder className="h-3 w-3 shrink-0 text-accent" /> : <File className="h-3 w-3 shrink-0 text-muted" />}{e}
              </button>
            ))}
          </div>
        </Card>
        <Card title={file?.path || "Vælg en fil"}>
          <pre className="max-h-[60vh] overflow-auto rounded-xl bg-[#0f1218] p-4 text-xs leading-relaxed">{file?.content || "—"}</pre>
        </Card>
      </div>
      <div><h2 className="mb-2 text-sm font-semibold">Developer Agent</h2>
        <ChatView defaultAgent="developer" showList={false} placeholder="Fx: Analysér mit-website/ og find fejlen i login-formularen"
          starters={["Giv mig et overblik over projektstrukturen", "Kør testene og forklar fejlene", "Foreslå forbedringer af performance"]} /></div>
    </div>
  );
}
