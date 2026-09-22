import { z } from "zod";

/**
 * Shared validators for untrusted identifiers. Values from the browser (ids, ARNs, regions,
 * pagination cursors, filters) are never trusted: they are validated here and then re-checked
 * against tenant-scoped data.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export const uuidSchema = z.string().regex(UUID_RE, "Invalid identifier");

export const awsAccountIdSchema = z.string().regex(/^\d{12}$/, "AWS account ID must be exactly 12 digits");

/** AWS region codes, e.g. us-east-1, ap-southeast-2, us-gov-west-1, eu-central-2. */
export const regionSchema = z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d{1,2}$/, "Invalid AWS region");

export const orgNameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(64, "Name must be at most 64 characters")
  // Printable characters only; no control chars / angle brackets.
  .regex(/^[^\u0000-\u001F\u007F<>]+$/, "Name contains unsupported characters");

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, "Slug must be 3-48 lowercase letters, digits or hyphens");

export const emailSchema = z.email().max(254).transform((e) => e.toLowerCase());

/** Opaque, bounded pagination cursor (a UUID of the last row). */
export const cursorSchema = uuidSchema.optional();

export const pageSizeSchema = z.coerce.number().int().min(1).max(200).default(50);

export const searchTermSchema = z
  .string()
  .trim()
  .max(128)
  .regex(/^[^\u0000-\u001F\u007F]*$/, "Search contains unsupported characters");

export const tagFilterSchema = z
  .string()
  .max(257)
  .regex(/^[^=\u0000-\u001F]{1,128}(=[^\u0000-\u001F]{0,128})?$/, "Tag filter must be key or key=value");
