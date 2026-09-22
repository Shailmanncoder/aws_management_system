import Link from "next/link";

export function CurrencyPicker({ currencies, selected, pathname, params }: {
  currencies: string[]; selected: string | null; pathname: string;
  params: Record<string, string | string[] | undefined>;
}) {
  if (currencies.length < 2) return null;
  return <nav aria-label="Usage currency" className="flex flex-wrap items-center gap-2 text-sm">
    <span>Usage currency — totals are kept separate:</span>
    {currencies.map((currency) => {
      const query = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => typeof v === "string" ? [[k, v]] : []));
      query.set("currency", currency);
      return <Link key={currency} href={`${pathname}?${query}`} aria-current={currency === selected ? "page" : undefined} className={`rounded border px-3 py-1 ${currency === selected ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{currency}</Link>;
    })}
  </nav>;
}
