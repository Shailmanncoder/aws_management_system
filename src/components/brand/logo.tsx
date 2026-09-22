import { Cloud } from "lucide-react";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground" aria-hidden>
        <Cloud className="size-4" />
      </span>
      {!compact && <span>Stratus</span>}
    </span>
  );
}
