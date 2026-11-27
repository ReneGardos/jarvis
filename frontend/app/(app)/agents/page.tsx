"use client";
import Link from "next/link";
import { api } from "@/lib/api";
import { Badge, Button, Card, ErrorNote, PageHeader, useData } from "@/components/ui";

export default function Agents() {
  const a = useData(() => api("/api/agents"));
  const toggle = async (key: string, enabled: boolean) => { await api(`/api/agents/${key}/toggle?enabled=${enabled}`, { method: "POST" }); a.reload(); };
  return (
    <div>
      <PageHeader title="AI-agenter" subtitle="Hovedassistenten fordeler opgaver til specialiserede agenter og samler deres resultater. Deaktiverede agenter kan ikke bruges." />
      <ErrorNote error={a.error} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(a.data || []).map((x: any) => (
          <Card key={x.key} title={x.name} actions={<Badge tone={x.enabled ? "ok" : "bad"}>{x.enabled ? "Aktiv" : "Deaktiveret"}</Badge>}>
            <p className="mb-3 text-sm text-muted">{x.description}</p>
            <div className="mb-3 flex flex-wrap gap-1">{x.tools.map((t: string) => <Badge key={t}>{t}</Badge>)}</div>
            <div className="mb-4 text-xs text-muted">Modelklasse: {x.tier || "automatisk"} · {x.calls} kald</div>
            <div className="flex gap-2">
              <Link href={`/chat?agent=${x.key}`}><Button variant="subtle" disabled={!x.enabled}>Chat</Button></Link>
              <Button variant={x.enabled ? "danger" : "primary"} onClick={() => toggle(x.key, !x.enabled)}>{x.enabled ? "Deaktivér" : "Aktivér"}</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
