/** Client-safe network helpers shared by the UI and the security rules. */
import type { SecurityGroupRule } from "./resource-types";

export const WORLD_CIDRS = new Set(["0.0.0.0/0", "::/0"]);

export const SENSITIVE_PORTS: Record<number, string> = {
  22: "SSH",
  3389: "RDP",
  3306: "MySQL",
  5432: "PostgreSQL",
  1433: "SQL Server",
  1521: "Oracle",
  27017: "MongoDB",
  6379: "Redis",
  9200: "Elasticsearch",
  5601: "Kibana",
  11211: "Memcached",
  2375: "Docker API",
  23: "Telnet",
  445: "SMB",
};

export function ruleCoversPort(rule: SecurityGroupRule, port: number): boolean {
  if (rule.protocol === "-1") return true;
  if (rule.protocol !== "tcp" && rule.protocol !== "6") return false;
  if (rule.fromPort === null || rule.toPort === null) return true;
  return rule.fromPort <= port && port <= rule.toPort;
}

export function isWorldOpen(rule: SecurityGroupRule): boolean {
  return rule.sources.some((s) => (s.type === "cidr" || s.type === "ipv6") && WORLD_CIDRS.has(s.value));
}

export function describePorts(rule: SecurityGroupRule): string {
  if (rule.protocol === "-1") return "All traffic";
  const proto = rule.protocol.toUpperCase();
  if (rule.fromPort === null) return proto;
  return rule.fromPort === rule.toPort ? `${proto} ${rule.fromPort}` : `${proto} ${rule.fromPort}-${rule.toPort}`;
}
