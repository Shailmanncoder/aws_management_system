export type DiagnosticIssue = {
  code: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  nextStep: string;
  accountId?: string;
};

export type DiagnosticMemoryMessage = {
  question: string;
  answer: string;
  createdAt: string;
};

export function buildDiagnosticReply(question: string, issues: DiagnosticIssue[]): string {
  const q = question.trim().slice(0, 500).toLowerCase();
  if (issues.length === 0) {
    return "Stratus does not see an active AWS connection or synchronization problem in this workspace. If something still looks wrong, name the page or account and Stratus will compare it with the latest safe health data.";
  }

  const relevant = issues.filter((issue) => {
    const haystack = `${issue.title} ${issue.detail} ${issue.code}`.toLowerCase();
    return q.split(/\s+/).filter((word) => word.length > 3).some((word) => haystack.includes(word));
  });
  const chosen = (relevant.length ? relevant : issues).slice(0, 3);
  return chosen
    .map((issue, index) => `${index + 1}. ${issue.title}: ${issue.detail} Next: ${issue.nextStep}`)
    .join("\n");
}
