"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, ErrorNote, Input } from "@/components/ui";

export default function Login() {
  const r = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api("/api/auth/login", { method: "POST", json: { email, password } });
      r.replace("/");
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };
  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_top,#1a2440_0%,#0b0d12_60%)] p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-line bg-panel/80 p-8 backdrop-blur animate-fadein">
        <div className="mx-auto mb-6 h-14 w-14 rounded-full bg-accent/20 ring-2 ring-accent/50 animate-pulsering" />
        <h1 className="mb-1 text-center text-xl font-semibold">Jarvis</h1>
        <p className="mb-6 text-center text-sm text-muted">Log ind på din personlige assistent</p>
        <ErrorNote error={error} />
        <div className="space-y-3">
          <Input type="email" autoComplete="username" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input type="password" autoComplete="current-password" placeholder="Adgangskode" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Button className="w-full" loading={loading} type="submit">Log ind</Button>
        </div>
      </form>
    </main>
  );
}
