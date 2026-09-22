// E2E orchestrator: reset the e2e database, build, then run web + worker together.
// Used only by playwright.config.ts (never in production).
import { execSync, spawn } from "node:child_process";
import pg from "pg";

const url = process.env.DATABASE_URL ?? "";
if (!/\/stratus_e2e$/.test(url)) throw new Error("e2e-serve refuses to run against a non-e2e database");

const admin = new pg.Client({ connectionString: url.replace(/\/stratus_e2e$/, "/stratus") });
await admin.connect();
if ((await admin.query("SELECT 1 FROM pg_database WHERE datname='stratus_e2e'")).rowCount === 0) await admin.query("CREATE DATABASE stratus_e2e");
await admin.end();
const db = new pg.Client({ connectionString: url });
await db.connect();
await db.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
await db.end();

const run = (cmd) => execSync(cmd, { stdio: "inherit", env: process.env });
run("npx prisma migrate deploy");
run("npx next build");
run("node scripts/build-worker.mjs");

const port = process.env.E2E_PORT ?? "3100";
const web = spawn("npx", ["next", "start", "-p", port], { stdio: "inherit", env: process.env });
const worker = spawn("node", ["dist/worker.mjs"], { stdio: "inherit", env: { ...process.env, STRATUS_SERVICE: "worker", WORKER_POLL_INTERVAL_MS: "400" } });
const stop = () => {
  web.kill("SIGTERM");
  worker.kill("SIGTERM");
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
web.on("exit", (code) => process.exit(code ?? 0));
