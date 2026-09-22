import { getContext } from "./context";
import { redact } from "./redact";

/**
 * Structured JSON logger. All fields pass through `redact` — there is no API to log unredacted
 * data. One JSON object per line on stdout/stderr (CloudWatch Logs / any collector friendly).
 */

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL as Level | undefined) ?? "info";
  return LEVELS[lvl] ?? LEVELS.info;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

/** Sink indirection so tests can capture output. */
export type LogSink = (level: Level, line: string) => void;

let sink: LogSink = (level, line) => {
  if (level === "error" || level === "warn") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
};

export function setLogSinkForTests(next: LogSink): () => void {
  const prev = sink;
  sink = next;
  return () => {
    sink = prev;
  };
}

function write(level: Level, msg: string, bindings: LogFields, fields?: LogFields): void {
  if (LEVELS[level] < threshold()) return;
  const ctx = getContext();
  const entry = redact({
    ts: new Date().toISOString(),
    level,
    msg,
    service: process.env.STRATUS_SERVICE ?? "web",
    ...(ctx
      ? {
          requestId: ctx.requestId,
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          awsAccountRef: ctx.awsAccountRef,
          jobId: ctx.jobId,
          operation: ctx.operation,
        }
      : {}),
    ...bindings,
    ...fields,
  });
  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    line = JSON.stringify({ ts: new Date().toISOString(), level, msg: "log serialization failed" });
  }
  sink(level, line);
}

function make(bindings: LogFields): Logger {
  return {
    debug: (m, f) => write("debug", m, bindings, f),
    info: (m, f) => write("info", m, bindings, f),
    warn: (m, f) => write("warn", m, bindings, f),
    error: (m, f) => write("error", m, bindings, f),
    child: (b) => make({ ...bindings, ...b }),
  };
}

export const logger: Logger = make({});
