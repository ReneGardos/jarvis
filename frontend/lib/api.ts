// API-klient. Login gemmes som httpOnly-cookie sat af backend – token er aldrig tilgængeligt for JavaScript.
export const API = process.env.NEXT_PUBLIC_API_URL ?? "";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/login")) {
    window.location.href = "/login";
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const d = await res.json();
      msg = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail);
    } catch {}
    throw new ApiError(res.status, msg);
  }
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("application/json") ? res.json() : (res as unknown)) as T;
}

export type ChatEvent = { type: string; data: any };

/** Sender en chatbesked og streamer Server-Sent Events tilbage. */
export async function streamChat(
  conversationId: number,
  body: { message: string; agent?: string | null; model?: string | null },
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
) {
  const res = await fetch(`${API}/api/conversations/${conversationId}/messages`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new ApiError(res.status, "Kunne ikke sende besked");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let type = "message";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event: ")) type = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      try {
        onEvent({ type, data: data ? JSON.parse(data) : {} });
      } catch {}
    }
  }
}

export const fmtDate = (d?: string | null, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) =>
  d ? new Intl.DateTimeFormat("da-DK", opts).format(new Date(d)) : "";

export const fmtBytes = (n: number) =>
  n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${(n / 1e3).toFixed(0)} kB` : `${n} B`;
