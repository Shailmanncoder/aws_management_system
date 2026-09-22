import { orgRoute } from "@/server/http/route";
import { logger } from "@/server/logging/logger";
import { liveSnapshot } from "@/server/services/live-service";

export const dynamic = "force-dynamic";

const POLL_MS = 3_000;
const MAX_STREAM_MS = 5 * 60_000; // clients reconnect; membership is re-verified on every connect

/**
 * Server-Sent Events: pushes a tenant-scoped snapshot whenever it changes (sync progress, new
 * inventory/cost data, alerts). Authorization runs through orgRoute on connect; the stream is
 * bounded in time so revoked access takes effect within minutes at most.
 */
export const GET = orgRoute({ operation: "live.stream", permission: "org:read", rateLimit: "api" }, async ({ access, req }) => {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const started = Date.now();
  let last = "";
  let lastBeat = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", close);
      controller.enqueue(encoder.encode("retry: 5000\n\n"));
      const tick = async () => {
        if (closed) return;
        try {
          const snap = JSON.stringify(await liveSnapshot(access));
          if (snap !== last) {
            last = snap;
            controller.enqueue(encoder.encode(`event: snapshot\ndata: ${snap}\n\n`));
          } else if (Date.now() - lastBeat > 15_000) {
            lastBeat = Date.now();
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          }
        } catch (err) {
          logger.warn("live stream tick failed", { err });
        }
        if (Date.now() - started > MAX_STREAM_MS) return close();
        timer = setTimeout(tick, POLL_MS);
      };
      void tick();
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
});
