import { execSync } from "node:child_process";
import { Client } from "pg";

/** Resets the dedicated test database and applies all migrations once per integration run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://stratus:stratus_local_dev_only@127.0.0.1:5432/stratus_test";
  if (!/stratus_test/.test(url)) throw new Error("Refusing to reset a database that is not the test database");
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await client.end();
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
