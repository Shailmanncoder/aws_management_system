import "server-only";
import { GetProductsCommand, PricingClient, type Filter } from "@aws-sdk/client-pricing";
import { createAwsClient } from "./client-factory";
import { classifyAwsError } from "./errors";
import type { AwsSession } from "./session";

/**
 * AWS Price List API (public on-demand list prices). Used ONLY to estimate optimisation savings.
 * Prices exclude discounts (Savings Plans, RIs, EDP), free tier and taxes — callers label all
 * derived amounts as estimates. Unknown prices return null; nothing is guessed.
 */

const TTL_MS = 24 * 60 * 60_000;
const cache = new Map<string, { value: number | null; expiresAt: number }>();

export interface PriceBook {
  ebsGbMonth(region: string, volumeType: string): number | null;
  snapshotGbMonth(region: string): number | null;
  instanceHourly(region: string, instanceType: string): number | null;
  publicIpv4Hourly(region: string): number | null;
  /** Whether the Price List API was reachable (false → no savings figures at all). */
  available: boolean;
}

/** Extracts the first USD on-demand price from a Price List product JSON document. */
export function parseUsdPrice(doc: string): number | null {
  try {
    const p = JSON.parse(doc) as { terms?: { OnDemand?: Record<string, { priceDimensions?: Record<string, { pricePerUnit?: { USD?: string } }> }> } };
    for (const term of Object.values(p.terms?.OnDemand ?? {})) {
      for (const dim of Object.values(term.priceDimensions ?? {})) {
        const v = Number(dim.pricePerUnit?.USD);
        if (Number.isFinite(v) && v > 0) return v;
      }
    }
  } catch {
    /* malformed document → unknown */
  }
  return null;
}

const tm = (Field: string, Value: string): Filter => ({ Type: "TERM_MATCH", Field, Value });

type Query = { key: string; serviceCode: string; filters: Filter[] };

/**
 * Prefetches the prices needed for a set of lookups and returns a synchronous PriceBook.
 * Bounded: at most `maxQueries` Price List calls per analysis run.
 */
export async function loadPriceBook(
  session: AwsSession,
  needs: { ebs: [string, string][]; snapshots: string[]; instances: [string, string][]; ipv4: string[] },
  maxQueries = 60,
): Promise<PriceBook> {
  const queries: Query[] = [
    ...needs.ebs.map(([region, type]) => ({ key: `ebs|${region}|${type}`, serviceCode: "AmazonEC2", filters: [tm("productFamily", "Storage"), tm("regionCode", region), tm("volumeApiName", type)] })),
    ...needs.snapshots.map((region) => ({ key: `snap|${region}`, serviceCode: "AmazonEC2", filters: [tm("productFamily", "Storage Snapshot"), tm("regionCode", region), tm("usagetype", `${usagePrefix(region)}EBS:SnapshotUsage`)] })),
    ...needs.instances.map(([region, type]) => ({
      key: `ec2|${region}|${type}`,
      serviceCode: "AmazonEC2",
      filters: [tm("regionCode", region), tm("instanceType", type), tm("operatingSystem", "Linux"), tm("tenancy", "Shared"), tm("preInstalledSw", "NA"), tm("capacitystatus", "Used"), tm("licenseModel", "No License required")],
    })),
    ...needs.ipv4.map((region) => ({ key: `ipv4|${region}|idle`, serviceCode: "AmazonVPC", filters: [tm("regionCode", region), tm("group", "VPCPublicIPv4Address"), tm("groupDescription", "Hourly charge for Idle Public IPv4 Addresses")] })),
  ];
  const unique = [...new Map(queries.map((q) => [q.key, q])).values()].slice(0, maxQueries);
  let available = true;
  const pricing = createAwsClient(PricingClient, session, "us-east-1", "pricing");
  try {
    for (const q of unique) {
      const hit = cache.get(q.key);
      if (hit && hit.expiresAt > Date.now()) continue;
      try {
        const res = await pricing.send(new GetProductsCommand({ ServiceCode: q.serviceCode, Filters: q.filters, MaxResults: 5 }));
        let price: number | null = null;
        for (const doc of res.PriceList ?? []) {
          price = parseUsdPrice(String(doc));
          if (price !== null) break;
        }
        cache.set(q.key, { value: price, expiresAt: Date.now() + TTL_MS });
      } catch (err) {
        const cls = classifyAwsError(err);
        if (cls === "access_denied") {
          available = false;
          break;
        }
        cache.set(q.key, { value: null, expiresAt: Date.now() + 60 * 60_000 });
      }
    }
  } finally {
    pricing.destroy();
  }
  const get = (k: string) => (available ? (cache.get(k)?.value ?? null) : null);
  return {
    available,
    ebsGbMonth: (r, t) => get(`ebs|${r}|${t}`),
    snapshotGbMonth: (r) => get(`snap|${r}`),
    instanceHourly: (r, t) => get(`ec2|${r}|${t}`),
    publicIpv4Hourly: (r) => get(`ipv4|${r}|idle`),
  };
}

/** Price List usage-type prefix per region (e.g. "USE1-"; us-east-1 has none for some SKUs). */
const USAGE_PREFIX: Record<string, string> = {
  "us-east-1": "", "us-east-2": "USE2-", "us-west-1": "USW1-", "us-west-2": "USW2-", "ca-central-1": "CAN1-",
  "eu-west-1": "EU-", "eu-west-2": "EUW2-", "eu-west-3": "EUW3-", "eu-central-1": "EUC1-", "eu-north-1": "EUN1-", "eu-south-1": "EUS1-",
  "ap-south-1": "APS3-", "ap-southeast-1": "APS1-", "ap-southeast-2": "APS2-", "ap-northeast-1": "APN1-", "ap-northeast-2": "APN2-", "ap-northeast-3": "APN3-",
  "sa-east-1": "SAE1-", "me-south-1": "MES1-", "af-south-1": "AFS1-",
};
function usagePrefix(region: string) {
  return USAGE_PREFIX[region] ?? "";
}

export function clearPriceCacheForTests() {
  cache.clear();
}
