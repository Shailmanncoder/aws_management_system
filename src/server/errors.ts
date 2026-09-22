/**
 * Application error model. `publicMessage` is the ONLY text that may reach a client. Internal
 * causes are kept on `cause` for (redacted) logging.
 */

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "CSRF_REJECTED"
  | "PAYLOAD_TOO_LARGE"
  | "PRECONDITION_FAILED"
  | "FEATURE_DISABLED"
  | "AWS_ASSUME_ROLE_FAILED"
  | "AWS_ROLE_UNAVAILABLE"
  | "AWS_ACCOUNT_MISMATCH"
  | "AWS_PERMISSION_DENIED"
  | "AWS_THROTTLED"
  | "AWS_UNAVAILABLE"
  | "BILLING_UNAVAILABLE"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  CSRF_REJECTED: 403,
  PAYLOAD_TOO_LARGE: 413,
  PRECONDITION_FAILED: 412,
  FEATURE_DISABLED: 403,
  AWS_ASSUME_ROLE_FAILED: 422,
  AWS_ROLE_UNAVAILABLE: 422,
  AWS_ACCOUNT_MISMATCH: 422,
  AWS_PERMISSION_DENIED: 422,
  AWS_THROTTLED: 503,
  AWS_UNAVAILABLE: 502,
  BILLING_UNAVAILABLE: 422,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export interface FieldIssue {
  path: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  readonly issues?: FieldIssue[];
  readonly retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    publicMessage: string,
    opts: { cause?: unknown; issues?: FieldIssue[]; retryAfterSeconds?: number } = {},
  ) {
    super(publicMessage, { cause: opts.cause });
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.publicMessage = publicMessage;
    this.issues = opts.issues;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }
}

export const unauthenticated = () => new AppError("UNAUTHENTICATED", "Authentication required.");
/**
 * Cross-tenant and non-existent resources are indistinguishable to the caller (both 404), so
 * resource/organization IDs cannot be enumerated.
 */
export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found.`);
export const forbidden = (msg = "You do not have permission to perform this action.") =>
  new AppError("FORBIDDEN", msg);
export const conflict = (msg: string) => new AppError("CONFLICT", msg);
export const validationFailed = (issues: FieldIssue[], msg = "The request is invalid.") =>
  new AppError("VALIDATION_FAILED", msg, { issues });

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
