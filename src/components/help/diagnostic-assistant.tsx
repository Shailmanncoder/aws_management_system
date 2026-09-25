"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, ImagePlus, Send, ShieldCheck, Sparkles, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import type { DiagnosticIssue, DiagnosticMemoryMessage } from "@/lib/diagnostic-assistant";

export type AssistantState = { issues: DiagnosticIssue[]; messages: DiagnosticMemoryMessage[]; privacy: "local-redacted" };

const DEFAULT_PROMPTS = ["What should I fix first?", "Why is synchronization failing?", "Which permissions are missing?"];
type ImagePayload = { mimeType: "image/png" | "image/jpeg" | "image/webp"; data: string; name: string };

export function DiagnosticAssistant({ orgId, initial, compact = false }: { orgId: string; initial: AssistantState; compact?: boolean }) {
  const [state, setState] = useState(initial);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [image, setImage] = useState<ImagePayload | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [state.messages.length, busy]);

  async function sendQuestion(value: string) {
    const nextQuestion = value.trim();
    if (!nextQuestion || busy) return;
    setBusy(true); setError(""); setQuestion("");
    try {
      const result = await api<{ message: DiagnosticMemoryMessage; issues: DiagnosticIssue[]; privacy: "local-redacted" }>(
        `/api/v1/orgs/${orgId}/diagnostic-assistant`, { body: { question: nextQuestion, image: image ? { mimeType: image.mimeType, data: image.data } : undefined } },
      );
      setState((current) => ({ ...current, issues: result.issues, messages: [...current.messages, result.message].slice(-20) }));
      setImage(null);
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
          <p><strong className="text-foreground">AWS credentials stay private.</strong> Stratus sends Gemini only redacted health details and your question. An attached screenshot is sent for that question only and is not saved—remove any visible secrets first.</p>
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
        {image && <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs"><span className="truncate">Screenshot: {image.name}</span><button type="button" onClick={() => setImage(null)} aria-label="Remove screenshot"><X className="size-4" /></button></div>}
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void sendQuestion(question); }}>
          <label className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border bg-background hover:bg-muted" aria-label="Attach screenshot">
            <ImagePlus className="size-4" />
            <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => {
              const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
              setError("");
              try { setImage(await prepareScreenshot(file)); } catch (cause) { setError(errorMessage(cause)); }
            }} />
          </label>
          <Input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} required placeholder="Ask Stratus about this workspace…" aria-label="Message Stratus" autoComplete="off" />
          <Button type="submit" size="icon" disabled={busy || !question.trim()} aria-label="Send message"><Send className="size-4" /></Button>
        </form>
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        <p className="mt-2 text-center text-[11px] text-muted-foreground">Gemini 3.5 Flash-Lite · Screenshots are not saved · Private text memory follows your account</p>
      </div>
    </section>
  );
}

async function prepareScreenshot(file: File): Promise<ImagePayload> {
  if (!(["image/png", "image/jpeg", "image/webp"] as string[]).includes(file.type)) throw new Error("Use a PNG, JPEG, or WebP screenshot.");
  if (file.size > 8 * 1024 * 1024) throw new Error("The screenshot must be smaller than 8 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
  if (!blob) throw new Error("Stratus could not prepare that screenshot.");
  const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Stratus could not read that screenshot.")); reader.readAsDataURL(blob); });
  const data = dataUrl.split(",")[1] ?? "";
  if (data.length > 1_800_000) throw new Error("The screenshot is still too large. Crop it and try again.");
  return { mimeType: "image/jpeg", data, name: file.name };
}

function ChatBubble({ role, children }: { role: "user" | "assistant"; children: React.ReactNode }) {
  const assistant = role === "assistant";
  return <div className={`flex items-end gap-2 ${assistant ? "justify-start" : "justify-end"}`}>
    {assistant && <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Bot className="size-4" aria-hidden /></span>}
    <div className={`max-w-[86%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm ${assistant ? "rounded-bl-sm bg-muted text-foreground" : "rounded-br-sm bg-primary text-primary-foreground"}`}>{children}</div>
    {!assistant && <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted"><UserRound className="size-4" aria-hidden /></span>}
  </div>;
}
