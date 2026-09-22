/**
 * Runs once when the server starts. Validates the environment eagerly so a misconfigured
 * deployment fails fast at boot rather than on the first request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { getEnv } = await import("./server/env");
  const { logger } = await import("./server/logging/logger");
  try {
    const env = getEnv();
    logger.info("server starting", { appEnv: env.APP_ENV, awsMode: env.AWS_MODE, encryption: env.ENCRYPTION_PROVIDER });
    const { verifyPlatformIdentity } = await import("./server/aws/platform-identity");
    await verifyPlatformIdentity();
    if (env.AWS_MODE === "fixtures") {
      logger.warn("AWS_MODE=fixtures: AWS data is synthetic test fixture data and is labelled as such in the UI");
    }
  } catch (err) {
    // Message lists variable names only (never values).
    logger.error("invalid configuration — refusing to start", { err });
    throw err;
  }
}
