"use client";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { api, fmtDate } from "@/lib/api";
import { Badge, Button, Card, Empty, ErrorNote, PageHeader, Select, useData } from "@/components/ui";

export default function Approvals() {
  const [status, setStatus] = useState("pending");
  const a = useData(() => api(`/api/approvals?status=${status}`), [status]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const act = async (id: number, ok: boolean) => {
    setBusy(id);
    try { const r = await api(`/api/approvals/${id}/${ok ? "approve" : "reject"}`, { method: "POST" }); if (ok && !r.ok) setError(r.error); }
    catch (e: any) { setError(e.message); }
    setBusy(null); a.reload();
  };
  return (
    <div>
      <PageHeader title="Godkendelser" subtitle="Handlinger som AI'en har foreslået og som kræver din accept: filændringer, kalenderaftaler, eksterne kald og alt med økonomiske eller juridiske konsekvenser."
        actions={<Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Afventer</option><option value="executed">Udført</option><option value="rejected">Afvist</option><option value="failed">Fejlet</option><option value="all">Alle</option></Select>} />
      <ErrorNote error={error || a.error} />
      {!a.loading && !a.data?.length && <Empty>Ingen {status === "pending" ? "ventende " : ""}godkendelser.</Empty>}
      <div className="space-y-3">
        {(a.data || []).map((x: any) => (
          <Card key={x.id} title={<>#{x.id} · {x.summary}</>} actions={<Badge tone={x.risk >= 3 ? "bad" : "warn"}>{x.risk_name}</Badge>}>
            <div className="mb-2 text-xs text-muted">{x.agent} → {x.tool} · {fmtDate(x.created_at)} · {x.reason}</div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-panel2 p-3 text-xs">{JSON.stringify(x.args, null, 2)}</pre>
            {x.status === "pending" ? (
              <div className="mt-3 flex gap-2">
                <Button loading={busy === x.id} onClick={() => act(x.id, true)}><Check className="h-4 w-4" />Godkend og udfør</Button>
                <Button variant="danger" onClick={() => act(x.id, false)}><X className="h-4 w-4" />Afvis</Button>
              </div>
            ) : <div className="mt-3 text-xs"><Badge tone={x.status === "executed" ? "ok" : x.status === "rejected" ? "default" : "bad"}>{x.status}</Badge>
              {x.result && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-muted">{JSON.stringify(x.result, null, 2).slice(0, 3000)}</pre>}</div>}
          </Card>
        ))}
      </div>
    </div>
  );
}
