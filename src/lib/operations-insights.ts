export interface OpsResource {
  id: string; resourceId: string; resourceType: string; name: string | null; state: string | null; region: string; awsAccountRefId: string;
  attributes: Record<string, unknown>; tags: { key: string; value: string }[]; lastSeenAt: string;
  awsAccount: { displayName: string; syncStatus: string; lastSyncedAt: string | null };
}
export interface OpsCost { awsAccountRefId: string; dimension: string; dimensionKey: string; periodStart: string; unit: string; amount: number; estimated: boolean }
export function relatedResources(resource: OpsResource, resources: OpsResource[]) {
  // Only exact, normalized AWS identifiers establish a link, within the same account and region.
  const identifiers = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(identifiers) : value && typeof value === "object" ? Object.values(value).flatMap(identifiers) : [];
  const refs = new Set(identifiers(resource.attributes));
  return resources.filter(other => other.id !== resource.id && other.awsAccountRefId === resource.awsAccountRefId && other.region === resource.region && (refs.has(other.resourceId) || identifiers(other.attributes).includes(resource.resourceId)));
}
export function backupReadiness(resource: OpsResource, resources: OpsResource[], now = Date.now()) {
  if (resource.resourceType === "ec2:volume") {
    const snapshots = resources.filter(r => r.resourceType === "ec2:snapshot" && r.awsAccountRefId === resource.awsAccountRefId && r.region === resource.region && r.attributes.volumeId === resource.resourceId && r.state === "completed").map(r => ({ r, time: Date.parse(String(r.attributes.startTime)) })).filter(v => Number.isFinite(v.time)).sort((a, b) => b.time - a.time);
    if (!snapshots.length) return { status: "Unknown", detail: "No completed snapshot in the observed inventory. Check snapshot scan coverage before concluding backups are missing." };
    const last = snapshots[0]!;
    return { status: now - last.time > 7 * 86400000 ? "Review" : "Observed", detail: `Latest completed snapshot: ${new Date(last.time).toISOString().slice(0, 10)}. Restore testing is not verified.` };
  }
  if (resource.resourceType === "rds:db-instance") {
    const days = resource.attributes.backupRetentionDays;
    if (typeof days !== "number") return { status: "Unknown", detail: "Backup retention was not observed." };
    const latest = resource.attributes.latestRestorableTime;
    return { status: days > 0 ? "Configured" : "Review", detail: `${days} days of automatic backup retention.${typeof latest === "string" ? ` Latest restorable time: ${latest}.` : " Last successful backup is unavailable."} Restore testing is not verified.` };
  }
  return { status: "Unknown", detail: "Backup evidence is not collected for this resource type." };
}
export function costSpikes(rows: OpsCost[], now = new Date(), percent = 30, minimum = 10) {
  const today = now.toISOString().slice(0, 10);
  const groups = new Map<string, OpsCost[]>();
  for (const r of rows) {
    if (r.dimension !== "TOTAL" || r.periodStart.slice(0, 10) >= today) continue;
    const key = `${r.awsAccountRefId}:${r.unit}`;
    const group = groups.get(key) ?? []; group.push(r); groups.set(key, group);
  }
  return [...groups.values()].flatMap(group => {
    group.sort((a, b) => b.periodStart.localeCompare(a.periodStart));
    const latest = group[0]; if (!latest) return [];
    const day = new Date(latest.periodStart).getTime();
    const baseline = group.filter(r => { const age = day - new Date(r.periodStart).getTime(); return age >= 86400000 && age <= 7 * 86400000; });
    if (new Set(baseline.map(r => r.periodStart.slice(0, 10))).size !== 7) return [];
    const average = baseline.reduce((sum, r) => sum + r.amount, 0) / 7;
    if (average <= 0 || latest.amount < minimum || latest.amount <= average * (1 + percent / 100)) return [];
    const services = rows.filter(r => r.awsAccountRefId === latest.awsAccountRefId && r.unit === latest.unit && r.dimension === "SERVICE" && r.periodStart.slice(0, 10) === latest.periodStart.slice(0, 10)).map(r => {
      const earlier = rows.filter(v => v.awsAccountRefId === r.awsAccountRefId && v.dimension === "SERVICE" && v.dimensionKey === r.dimensionKey && v.unit === r.unit && baseline.some(b => b.periodStart.slice(0, 10) === v.periodStart.slice(0, 10)));
      const complete = new Set(earlier.map(v => v.periodStart.slice(0, 10))).size === 7;
      const prior = complete ? earlier.reduce((sum, v) => sum + v.amount, 0) / 7 : null;
      return { service: r.dimensionKey, amount: r.amount, increase: prior === null ? null : r.amount - prior };
    }).sort((a, b) => (b.increase ?? 0) - (a.increase ?? 0)).slice(0, 5);
    return [{ accountId: latest.awsAccountRefId, currency: latest.unit, day: latest.periodStart.slice(0, 10), amount: latest.amount, average, percent: (latest.amount / average - 1) * 100, services, estimated: latest.estimated || baseline.some(r => r.estimated) }];
  });
}
