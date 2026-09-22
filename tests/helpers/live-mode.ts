import { afterAll, beforeAll } from "vitest";
import { resetEnvCacheForTests } from "@/server/env";

/** Switches the env to AWS_MODE=live for SDK-mock based adapter tests (no network: send() is mocked). */
export function useLiveAwsMode() {
  beforeAll(() => {
    process.env.AWS_MODE = "live";
    resetEnvCacheForTests();
  });
  afterAll(() => {
    process.env.AWS_MODE = "fixtures";
    resetEnvCacheForTests();
  });
}
