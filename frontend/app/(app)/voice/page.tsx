"use client";
import { useCallback, useState } from "react";
import { Mic, MicOff, Square } from "lucide-react";
import { useChat } from "@/lib/useChat";
import { useVoice } from "@/lib/useVoice";
import { Button, Card, cx, ErrorNote, PageHeader, Select } from "@/components/ui";

const LABEL = { off: "Slukket", idle: "Lytter efter “Jarvis”…", listening: "Hører dig…", transcribing: "Forstår…", thinking: "Tænker…", speaking: "Taler – tal for at afbryde" };

export default function VoicePage() {
  const [lang, setLang] = useState<"da" | "en">("da");
  const chat = useChat("main");
  const onCommand = useCallback((text: string) => chat.send(text), [chat]);
  const v = useVoice({ lang, wakeWord: "jarvis", onCommand });
  const last = [...chat.messages].reverse().find((m) => m.role === "assistant");
  return (
    <div>
      <PageHeader title="Voice Assistant" subtitle="Sig “Jarvis” efterfulgt af din besked. Efter et svar kan du fortsætte samtalen uden wake word i 30 sekunder."
        actions={<Select value={lang} onChange={(e) => setLang(e.target.value as "da" | "en")}><option value="da">Dansk</option><option value="en">English</option></Select>} />
      <ErrorNote error={v.error} />
      <Card className="flex flex-col items-center py-14">
        <div className="relative mb-8 grid h-44 w-44 place-items-center">
          <div className="absolute inset-0 rounded-full bg-accent/20 transition-transform duration-75" style={{ transform: `scale(${1 + v.level * 0.6})` }} />
          <div className={cx("absolute inset-4 rounded-full ring-2", v.state === "speaking" ? "ring-ok animate-pulsering" : v.state === "off" ? "ring-line" : "ring-accent")} />
          {v.state === "off" ? <MicOff className="h-12 w-12 text-muted" /> : <Mic className="h-12 w-12 text-accent" />}
        </div>
        <div className="mb-6 text-lg">{LABEL[v.state]}</div>
        <div className="flex gap-3">
          {v.state === "off" ? <Button onClick={v.start}><Mic className="h-4 w-4" />Start stemme</Button>
            : <Button variant="ghost" onClick={v.stop}><MicOff className="h-4 w-4" />Stop</Button>}
          {v.state === "speaking" && <Button variant="subtle" onClick={v.interrupt}><Square className="h-4 w-4" />Afbryd</Button>}
        </div>
        {v.lastHeard && <p className="mt-8 max-w-xl text-center text-sm text-muted">Du sagde: “{v.lastHeard}”</p>}
        {last?.content && <p className="mt-3 max-w-2xl whitespace-pre-wrap text-center text-sm">{last.content}</p>}
      </Card>
    </div>
  );
}
