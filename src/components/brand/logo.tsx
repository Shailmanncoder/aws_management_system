import { Cloud } from "lucide-react";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-lg font-semibold tracking-tight">
      <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-teal-500 text-white shadow-sm" aria-hidden>
        <Cloud className="size-5" />
      </span>
      {!compact && <span>Stratus</span>}
    </span>
  );
}
