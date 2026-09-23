import { describe, expect, it } from "vitest";
import { CHECKS, URGENCY_LABELS, URGENCY_ORDER, type CheckCopy } from "@/lib/checkup";

const entries = Object.entries(CHECKS);

/** The fields a non-technical reader actually reads. */
const proseFields = (c: CheckCopy) => [
  ["title", c.title],
  ["meaning", c.meaning],
  ["whyItMatters", c.whyItMatters],
  ["whatToDo", c.whatToDo],
  ["goodNews", c.goodNews],
] as const;

/**
 * Terms that are never acceptable in the plain-language copy: a reader who has never used a cloud
 * console cannot look these up mid-sentence.
 */
const BANNED = [
  "IAM",
  "ACL",
  "CIDR",
  "VPC",
  "EBS",
  "KMS",
  "ARN",
  "SDK",
  "API",
  "OAuth",
  "S3",
  "EC2",
  "RDS",
  "ingress",
  "principal",
  "policy document",
  "provision",
  "endpoint",
  "credential",
  "configuration",
  "instance",
];

/**
 * Terms that may appear only if the same sentence block explains them. This is what allows
 * "storage folders, called buckets" while rejecting a bare "bucket".
 */
const MUST_BE_EXPLAINED = ["bucket", "encryption", "two-factor", "AWS", "Cost Explorer", "tags"];
const EXPLAINING_PHRASES = ["called", "shortened to", "which means", "means ", "usually", "such as", "known as", "it is a setting"];

describe("check-up copy is readable by a non-technical person", () => {
  it("defines every check fully", () => {
    expect(entries.length).toBeGreaterThan(5);
    for (const [key, check] of entries) {
      expect(check.id, `${key} id must match its key`).toBe(key);
      for (const [field, text] of proseFields(check)) {
        expect(text.length, `${key}.${field} is empty`).toBeGreaterThan(10);
      }
      // Every unfixed check must lead somewhere: a walkthrough, a page, or something Stratus does.
      const actionable = Boolean(check.guideId) || Boolean(check.href) || check.fixKind === "stratus-can-do-it";
      expect(actionable, `${key} tells the reader nothing to do next`).toBe(true);
      if (check.href) expect(check.linkLabel, `${key} has a link with no label`).toBeTruthy();
    }
  });

  it("uses no unexplained technical terms", () => {
    for (const [key, check] of entries) {
      for (const [field, text] of proseFields(check)) {
        for (const term of BANNED) {
          // Word boundaries matter: "website" contains "ebs", and "instance" contains "stan".
          const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
          expect(re.test(text), `${key}.${field} uses the technical term "${term}"`).toBe(false);
        }
      }
    }
  });

  it("explains the few terms it cannot avoid", () => {
    for (const [key, check] of entries) {
      const whole = `${check.title} ${check.meaning} ${check.whyItMatters} ${check.whatToDo}`;
      for (const term of MUST_BE_EXPLAINED) {
        const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
        if (!re.test(whole)) continue;
        const explained = EXPLAINING_PHRASES.some((p) => whole.toLowerCase().includes(p.toLowerCase()));
        expect(explained, `${key} uses "${term}" without explaining it`).toBe(true);
      }
    }
  });

  it("keeps sentences short enough to follow", () => {
    for (const [key, check] of entries) {
      for (const [field, text] of proseFields(check)) {
        for (const sentence of text.split(/(?<=[.!?])\s+/)) {
          const words = sentence.trim().split(/\s+/).filter(Boolean).length;
          expect(words, `${key}.${field} has a ${words}-word sentence: "${sentence.slice(0, 60)}…"`).toBeLessThanOrEqual(38);
        }
      }
    }
  });

  it("says what a change will break rather than only urging it", () => {
    // Closing public storage takes a website down; this must not be a silent surprise.
    expect(CHECKS.publicStorage!.whatToDo.toLowerCase()).toContain("website");
  });

  it("never promises safety, only what was checked", () => {
    for (const [key, check] of entries) {
      for (const [field, text] of proseFields(check)) {
        for (const claim of ["100%", "fully secure", "completely safe", "guaranteed", "no risk"]) {
          expect(text.toLowerCase().includes(claim), `${key}.${field} overclaims with "${claim}"`).toBe(false);
        }
      }
    }
  });
});

describe("urgency vocabulary", () => {
  it("labels urgency in words, not severity codes", () => {
    for (const label of Object.values(URGENCY_LABELS)) {
      expect(label).not.toMatch(/CRITICAL|HIGH|MEDIUM|LOW|SEV/i);
      expect(label.length).toBeGreaterThan(3);
    }
  });

  it("orders urgency from most to least pressing, ending with what is done", () => {
    expect(URGENCY_ORDER[0]).toBe("now");
    expect(URGENCY_ORDER.at(-1)).toBe("done");
    expect(new Set(URGENCY_ORDER).size).toBe(URGENCY_ORDER.length);
  });
});
