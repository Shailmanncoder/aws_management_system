import { AppError } from "../errors";

/**
 * Classifies AWS SDK errors into a small, stable taxonomy. Raw AWS error messages are NOT
 * propagated to users (they can include ARNs of platform resources, request ids of internal
 * calls, etc.); callers map the class to a sanitised message.
 */
export type AwsErrorClass =
  | "throttled"
  | "access_denied"
  | "not_enabled"
  | "region_unavailable"
  | "not_found"
  | "invalid_credentials"
  | "expired"
  | "service_unavailable"
  | "validation"
  | "unknown";

interface SdkLikeError {
  name?: string;
  code?: string;
  Code?: string;
  $metadata?: { httpStatusCode?: number };
  $retryable?: { throttling?: boolean };
  message?: string;
}

const THROTTLE = new Set([
  "Throttling",
  "ThrottlingException",
  "ThrottledException",
  "RequestLimitExceeded",
  "TooManyRequestsException",
  "RequestThrottled",
  "RequestThrottledException",
  "SlowDown",
  "ProvisionedThroughputExceededException",
  "LimitExceededException",
  "PriorRequestNotComplete",
  "BandwidthLimitExceeded",
  "EC2ThrottledException",
]);

const DENIED = new Set([
  "AccessDenied",
  "AccessDeniedException",
  "UnauthorizedOperation",
  "AuthorizationError",
  "AuthorizationErrorException",
  "UnauthorizedException",
  "Forbidden",
  "AllAccessDisabled",
]);

const NOT_ENABLED = new Set([
  "InvalidAccessException", // Security Hub not enabled
  "SubscriptionRequiredException",
  "DataUnavailableException", // Cost Explorer: not enabled / no data yet
  "BadRequestException",
  "OptInRequiredException",
]);

const REGION = new Set(["OptInRequired", "AuthFailure", "UnrecognizedClientException", "InvalidClientTokenId", "RegionDisabledException"]);

const NOT_FOUND = new Set([
  "NoSuchEntity",
  "NoSuchBucket",
  "ResourceNotFoundException",
  "NotFoundException",
  "NoSuchLifecycleConfiguration",
  "ServerSideEncryptionConfigurationNotFoundError",
  "NoSuchPublicAccessBlockConfiguration",
  "NoSuchTagSet",
  "NoSuchBucketPolicy",
  "InvalidInstanceID.NotFound",
  "DBInstanceNotFound",
  "ClusterNotFoundException",
  "RepositoryNotFoundException",
]);

export function awsErrorCode(err: unknown): string {
  const e = err as SdkLikeError | undefined;
  return e?.name ?? e?.code ?? e?.Code ?? "Unknown";
}

export function classifyAwsError(err: unknown): AwsErrorClass {
  const e = err as SdkLikeError | undefined;
  const code = awsErrorCode(err);
  if (e?.$retryable?.throttling || THROTTLE.has(code)) return "throttled";
  if (DENIED.has(code)) return "access_denied";
  if (code === "ExpiredToken" || code === "ExpiredTokenException" || code === "RequestExpired") return "expired";
  if (code === "InvalidClientTokenId" || code === "SignatureDoesNotMatch" || code === "IncompleteSignature") {
    return "invalid_credentials";
  }
  if (REGION.has(code)) return "region_unavailable";
  if (NOT_ENABLED.has(code)) return "not_enabled";
  if (NOT_FOUND.has(code) || code.endsWith("NotFound") || code.endsWith("NotFoundException")) return "not_found";
  if (code === "ValidationError" || code === "ValidationException" || code === "InvalidParameterValue") return "validation";
  const status = e?.$metadata?.httpStatusCode;
  if (status === 429) return "throttled";
  if (status === 403) return "access_denied";
  if ((status !== undefined && status >= 500) || code === "TimeoutError" || code === "ECONNRESET" || code === "ENOTFOUND") {
    return "service_unavailable";
  }
  return "unknown";
}

export function isThrottle(err: unknown): boolean {
  return classifyAwsError(err) === "throttled";
}

/** Maps an AWS failure during a specific IAM action to a sanitised AppError. */
export function toAppError(err: unknown, iamAction: string): AppError {
  switch (classifyAwsError(err)) {
    case "throttled":
      return new AppError("AWS_THROTTLED", "AWS API request was throttled. Please retry shortly.", { cause: err });
    case "access_denied":
      return new AppError("AWS_PERMISSION_DENIED", `Missing required AWS permission: ${iamAction}`, { cause: err });
    case "not_enabled":
      return new AppError("PRECONDITION_FAILED", "The AWS service is not enabled for this account.", { cause: err });
    case "expired":
    case "invalid_credentials":
      return new AppError("AWS_ROLE_UNAVAILABLE", "AWS credentials are no longer valid. Re-validate the connection.", { cause: err });
    case "service_unavailable":
      return new AppError("AWS_UNAVAILABLE", "AWS is temporarily unavailable. Please retry later.", { cause: err });
    default:
      return new AppError("AWS_UNAVAILABLE", "The AWS request failed.", { cause: err });
  }
}
