"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ChatView from "@/components/ChatView";

function Inner() {
  const agent = useSearchParams().get("agent") || "main";
  return <ChatView key={agent} defaultAgent={agent}
    starters={["Planlæg min dag", "Hvad har jeg af deadlines denne uge?", "Hvad husker du om mine projekter?", "Undersøg de bedste lokale AI-modeller lige nu"]} />;
}

export default function ChatPage() {
  return <Suspense><Inner /></Suspense>;
}
