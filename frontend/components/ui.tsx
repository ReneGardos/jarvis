"use client";
import { Loader2 } from "lucide-react";
import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, useEffect, useState } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx("rounded-2xl border border-line bg-panel p-5 animate-fadein", className)}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-white/90">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({ variant = "primary", loading, className, children, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "subtle"; loading?: boolean }) {
  const v = {
    primary: "bg-accent text-white hover:bg-accent/90",
    ghost: "border border-line text-white/80 hover:bg-panel2",
    subtle: "bg-panel2 text-white/80 hover:bg-line",
    danger: "bg-bad/15 text-bad hover:bg-bad/25",
  }[variant];
  return (
    <button {...p} disabled={p.disabled || loading}
      className={cx("inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:opacity-50", v, className)}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className={cx("w-full rounded-xl border border-line bg-panel2 px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent", className)} />
);
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...p} className={cx("w-full rounded-xl border border-line bg-panel2 px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent", className)} />
);
export const Select = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cx("rounded-xl border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-accent", className)}>{children}</select>
);

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "ok" | "warn" | "bad" | "accent" }) {
  const t = { default: "bg-panel2 text-muted", ok: "bg-ok/15 text-ok", warn: "bg-warn/15 text-warn", bad: "bg-bad/15 text-bad", accent: "bg-accent-soft text-accent" }[tone];
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", t)}>{children}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="flex gap-2">{actions}</div>
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="py-10 text-center text-sm text-muted">{children}</div>;

export function ErrorNote({ error }: { error?: string | null }) {
  if (!error) return null;
  return <div className="mb-4 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>;
}

/** Simpel datahook: henter, giver reload og fejl. */
export function useData<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try { setData(await fn()); setError(null); } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, deps);
  return { data, error, loading, reload: load, setData };
}
