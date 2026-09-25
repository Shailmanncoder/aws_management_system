"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Send, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import type { DiagnosticIssue, DiagnosticMemoryMessage } from "@/lib/diagnostic-assistant";

export type AssistantState = { issues: DiagnosticIssue[]; messages: DiagnosticMemoryMessage[]; privacy: "local-redacted" };

const DEFAULT_PROMPTS = ["What should I fix first?", "Why is synchronization failing?", "Which permissions are missing?"];

export function DiagnosticAssistant({ orgId, initial, compact = false }: { orgId: string; initial: AssistantState; compact?: boolean }) {
  const [state, setState] = useState(initial);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [state.messages.length, busy]);

  async function sendQuestion(value: string) {
    const nextQuestion = value.trim();
    if (!nextQuestion || busy) return;
    setBusy(true); setError(""); setQuestion("");
    try {
      const result = await api<{ message: DiagnosticMemoryMessage; issues: DiagnosticIssue[]; privacy: "local-redacted" }>(
        `/api/v1/orgs/${orgId}/diagnostic-assistant`, { body: { question: nextQuestion } },
      );
      setState((current) => ({ ...current, issues: result.issues, messages: [...current.messages, result.message].slice(-20) }));
    } catch (cause) {
      setQuestion(nextQuestion); setError(errorMessage(cause));
    } finally { setBusy(false); }
  }

  return (
    <section className={compact ? "flex min-h-0 flex-1 flex-col" : "overflow-hidden rounded-xl border bg-card"} aria-labelledby={compact ? undefined : "diagnostic-assistant-title"}>
      {!compact && <div className="border-b p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-primary/10 p-2 text-primary"><Bot className="size-5" aria-hidden /></div>
          <div><h2 id="diagnostic-assistant-title" className="font-semibold">Ask Stratus</h2><p className="mt-1 text-sm text-muted-foreground">A private chatbot that understands the current health of this workspace.</p></div>
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-status-good/10 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-status-good-text" aria-hidden />
          <p><strong className="text-foreground">Credentials stay private.</strong> Stratus uses only safe, allowlisted health details. Keys, secrets, tokens, cookies, encrypted credentials, and raw AWS responses are never sent to AI.</p>
        </div>
      </div>}

      <div className={compact ? "min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3" : "max-h-[32rem] space-y-4 overflow-y-auto p-5"} aria-live="polite">
        <ChatBubble role="assistant">{state.issues.length ? `I can see ${state.issues.length} active ${state.issues.length === 1 ? "issue" : "issues"}. Ask me what is wrong, what to fix first, or which AWS permission is needed.` : "Your AWS connection looks healthy right now. You can still ask me about synchronization, permissions, or setup."}</ChatBubble>
        {state.messages.map((message, index) => <div key={`${message.createdAt}:${index}`} className="space-y-3"><ChatBubble role="user">{message.question}</ChatBubble><ChatBubble role="assistant">{message.answer}</ChatBubble></div>)}
        {busy && <ChatBubble role="assistant"><span className="inline-flex items-center gap-2"><Sparkles className="size-4 animate-pulse" />Checking workspace health…</span></ChatBubble>}
        <div ref={endRef} />
      </div>

      <div className="border-t bg-background/80 p-4">
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">{DEFAULT_PROMPTS.map((prompt) => <button key={prompt} type="button" onClick={() => void sendQuestion(prompt)} disabled={busy} className="shrink-0 rounded-full border bg-background px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50">{prompt}</button>)}</div>
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void sendQuestion(question); }}>
          <Input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} required placeholder="Ask Stratus about this workspace…" aria-label="Message Stratus" autoComplete="off" />
          <Button type="submit" size="icon" disabled={busy || !question.trim()} aria-label="Send message"><Send className="size-4" /></Button>
        </form>
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        <p className="mt-2 text-center text-[11px] text-muted-foreground">Private memory follows your account across devices · Last 20 conversations</p>
      </div>
    </section>
  );
}

function ChatBubble({ role, children }: { role: "user" | "assistant"; children: React.ReactNode }) {
  const assistant = role === "assistant";
  return <div className={`flex items-end gap-2 ${assistant ? "justify-start" : "justify-end"}`}>
    {assistant && <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Bot className="size-4" aria-hidden /></span>}
    <div className={`max-w-[86%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm ${assistant ? "rounded-bl-sm bg-muted text-foreground" : "rounded-br-sm bg-primary text-primary-foreground"}`}>{children}</div>
    {!assistant && <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted"><UserRound className="size-4" aria-hidden /></span>}
  </div>;
}
