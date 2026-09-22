import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "./env";

/**
 * Single Prisma client per process. In development the instance is cached on globalThis so HMR
 * does not exhaust connections.
 */
const globalForPrisma = globalThis as unknown as { __stratusPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: getEnv().DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Bound every statement so a pathological query cannot pin a connection indefinitely.
    statement_timeout: 30_000,
  });
  return new PrismaClient({ adapter, log: [{ level: "error", emit: "event" }] });
}

export function getDb(): PrismaClient {
  if (!globalForPrisma.__stratusPrisma) {
    globalForPrisma.__stratusPrisma = createClient();
  }
  return globalForPrisma.__stratusPrisma;
}

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
