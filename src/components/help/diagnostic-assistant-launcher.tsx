"use client";

import { useState } from "react";
import { Bot, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { api, errorMessage } from "@/lib/api-client";
import { DiagnosticAssistant, type AssistantState } from "@/components/help/diagnostic-assistant";

export function DiagnosticAssistantLauncher({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AssistantState | null>(null);
  const [error, setError] = useState("");
  async function loadAssistant() {
    if (state) return;
    setError("");
    try { setState(await api<AssistantState>(`/api/v1/orgs/${orgId}/diagnostic-assistant`)); }
    catch (cause) { setError(errorMessage(cause)); }
  }
  return <Sheet open={open} onOpenChange={(next) => { setOpen(next); if (next) void loadAssistant(); }}>
    <SheetTrigger asChild><Button className="fixed bottom-5 right-5 z-40 h-12 rounded-full px-4 shadow-lg" aria-label="Open Ask Stratus chatbot"><Bot className="size-5" /><span>Ask Stratus</span></Button></SheetTrigger>
    <SheetContent className="w-full gap-0 sm:max-w-md" aria-describedby="ask-stratus-description">
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="flex items-center gap-2"><Bot className="size-5 text-primary" />Ask Stratus</SheetTitle>
        <SheetDescription id="ask-stratus-description">Workspace-aware help, without sharing credentials.</SheetDescription>
        <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-status-good/10 px-2 py-1 text-[11px] text-status-good-text"><ShieldCheck className="size-3" />Private and redacted</span>
      </SheetHeader>
      {state ? <DiagnosticAssistant orgId={orgId} initial={state} compact /> : <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">{error ? <div><p className="text-destructive">{error}</p><Button variant="outline" className="mt-3" onClick={() => void loadAssistant()}>Try again</Button></div> : <p>Reading safe workspace health details…</p>}</div>}
    </SheetContent>
  </Sheet>;
}
