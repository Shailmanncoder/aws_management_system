/** Client-safe formatting helpers. */

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelative(iso: string | Date, now: number = Date.now()): string {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  const diff = (t - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 45) return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), "month");
  return rtf.format(Math.round(diff / (86400 * 365)), "year");
}

export function formatCurrency(amount: number, currency: string | null, opts: { compact?: boolean } = {}): string {
  if (!currency || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency", currency, currencyDisplay: "code",
    notation: opts.compact ? "compact" : "standard",
    ...(opts.compact ? { maximumFractionDigits: 1, minimumFractionDigits: 0 } : {}),
  }).format(amount);
}

export function formatNumber(n: number, opts: { compact?: boolean; maxFractionDigits?: number } = {}): string {
  return new Intl.NumberFormat("en-US", { notation: opts.compact ? "compact" : "standard", maximumFractionDigits: opts.maxFractionDigits ?? 1 }).format(n);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatPercent(n: number, digits = 1): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatDateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
