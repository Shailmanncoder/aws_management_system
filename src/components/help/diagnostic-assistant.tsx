"use client";

import { useState } from "react";
import { ShieldCheck, Stethoscope } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import type { DiagnosticIssue, DiagnosticMemoryMessage } from "@/lib/diagnostic-assistant";

type AssistantState = { issues: DiagnosticIssue[]; messages: DiagnosticMemoryMessage[]; privacy: "local-redacted" };

export function DiagnosticAssistant({ orgId, initial }: { orgId: string; initial: AssistantState }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5" aria-labelledby="diagnostic-assistant-title">
      <div className="flex items-start gap-3">
        <Stethoscope className="mt-0.5 size-5 text-primary" aria-hidden />
        <div>
          <h2 id="diagnostic-assistant-title" className="font-semibold">Private diagnostic assistant</h2>
          <p className="mt-1 text-sm text-muted-foreground">Explains current workspace issues and remembers your troubleshooting context across devices.</p>
        </div>
      </div>

      <Alert>
        <ShieldCheck aria-hidden />
        <AlertTitle>Your credentials stay private</AlertTitle>
        <AlertDescription>
          Diagnosis runs from allowlisted Stratus health fields. AWS keys, secrets, tokens, cookies, external IDs, encrypted credentials, and raw AWS responses are
          never included. No information is sent to an external AI service.
        </AlertDescription>
      </Alert>

      <div className="grid gap-2 sm:grid-cols-2">
        {state.issues.slice(0, 6).map((issue) => (
          <div key={`${issue.code}:${issue.accountId ?? "workspace"}`} className="rounded-lg border p-3 text-sm">
            <p className="font-medium">{issue.title}</p>
            <p className="mt-1 text-muted-foreground">{issue.detail}</p>
            <p className="mt-2 text-xs"><strong>Next:</strong> {issue.nextStep}</p>
          </div>
        ))}
        {state.issues.length === 0 && <p className="text-sm text-status-good-text">No active AWS connection or synchronization issue was detected.</p>}
      </div>

      {state.messages.length > 0 && (
        <div className="max-h-72 space-y-3 overflow-auto rounded-lg border bg-muted/20 p-3" aria-label="Diagnostic memory">
          {state.messages.map((message, index) => (
            <div key={`${message.createdAt}:${index}`} className="text-sm">
              <p className="font-medium">You: {message.question}</p>
              <p className="mt-1 whitespace-pre-line text-muted-foreground">Stratus: {message.answer}</p>
            </div>
          ))}
        </div>
      )}

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const question = String(new FormData(form).get("question") ?? "").trim();
          if (!question) return;
          setBusy(true);
          setError("");
          try {
            const result = await api<{ message: DiagnosticMemoryMessage; issues: DiagnosticIssue[]; privacy: "local-redacted" }>(
              `/api/v1/orgs/${orgId}/diagnostic-assistant`,
              { body: { question } },
            );
            setState((current) => ({ ...current, issues: result.issues, messages: [...current.messages, result.message].slice(-20) }));
            form.reset();
          } catch (cause) {
            setError(errorMessage(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input name="question" maxLength={500} required placeholder="Why is synchronization failing?" aria-label="Ask about a Stratus issue" />
        <Button type="submit" disabled={busy}>{busy ? "Checking…" : "Diagnose"}</Button>
      </form>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
