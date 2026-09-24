import "server-only";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { getDb } from "../db";
import { getEnv } from "../env";
import { assertCan, authorizeOrg, type OrgAccess } from "../authz/guard";
import { notFound } from "../errors";
import { recordInput } from "@/lib/operations";

export async function testNotification(a: OrgAccess, id: string) {
  assertCan(a, "alerts:manage");
  const subscription = await getDb().workspaceRecord.findFirst({ where: { organizationId: a.organizationId, id, kind: "NOTIFICATION" } });
  if (!subscription) throw notFound("Notification subscription");
  return getDb().notificationDelivery.create({ data: { organizationId: a.organizationId, subscriptionId: id, eventId: `test:${randomUUID()}` } });
}
export async function queueNotifications() {
  const db = getDb();
  const subscriptions = await db.workspaceRecord.findMany({ where: { kind: "NOTIFICATION" }, orderBy: { id: "asc" } });
  for (const subscription of subscriptions) {
    const parsed = recordInput.safeParse({ kind: subscription.kind, name: subscription.name, payload: subscription.payload });
    if (!parsed.success || parsed.data.kind !== "NOTIFICATION" || !parsed.data.payload.enabled) continue;
    const p = parsed.data.payload;
    try { await authorizeOrg(subscription.userId, subscription.organizationId, "alerts:manage"); await authorizeOrg(p.memberId, subscription.organizationId, "alerts:read"); } catch { continue; }
    const alerts = await db.alert.findMany({ where: { organizationId: subscription.organizationId, createdAt: { gte: subscription.createdAt }, ...(p.ruleId ? { ruleId: p.ruleId } : {}) }, orderBy: { createdAt: "desc" }, take: 500 });
    await db.notificationDelivery.createMany({ data: alerts.map(alert => ({ organizationId: subscription.organizationId, subscriptionId: subscription.id, eventId: alert.id })), skipDuplicates: true });
  }
  const reminders = await db.workspaceRecord.findMany({ where: { kind: "REMINDER" } });
  for (const reminder of reminders) {
    const parsed = recordInput.safeParse({ kind: reminder.kind, name: reminder.name, payload: reminder.payload });
    if (!parsed.success || parsed.data.kind !== "REMINDER") continue;
    const p = parsed.data.payload;
    if (new Date(p.dueAt).getTime() - p.daysBefore * 86400000 > Date.now()) continue;
    await db.alert.createMany({ data: [{ organizationId: reminder.organizationId, type: "CONFIG_CHANGE", severity: "MEDIUM", title: `Reminder: ${reminder.name}`, message: `Due ${p.dueAt.slice(0, 10)}. Review the reminder in Operations.`, context: { reminderId: reminder.id }, dedupeKey: `reminder:${reminder.id}:${p.dueAt}` }], skipDuplicates: true });
  }
}
export async function deliverNotifications() {
  const db = getDb(), env = getEnv();
  // Interrupted sends may already have reached SMTP; never replay them automatically.
  await db.notificationDelivery.updateMany({ where: { status: "SENDING", updatedAt: { lt: new Date(Date.now() - 5 * 60000) } }, data: { status: "CHECK_REQUIRED", message: "Delivery was interrupted; check mail logs before retrying." } });
  const rows = await db.notificationDelivery.findMany({ where: { status: "PENDING", nextAttemptAt: { lte: new Date() }, attempts: { lt: 3 } }, take: 25 });
  for (const row of rows) {
    const claim = await db.notificationDelivery.updateMany({ where: { id: row.id, organizationId: row.organizationId, status: "PENDING" }, data: { status: "SENDING", attempts: { increment: 1 } } });
    if (!claim.count) continue;
    try {
      const subscription = await db.workspaceRecord.findFirst({ where: { organizationId: row.organizationId, id: row.subscriptionId, kind: "NOTIFICATION" } });
      if (!subscription) throw new Error("Subscription removed");
      const parsed = recordInput.parse({ kind: "NOTIFICATION", name: subscription.name, payload: subscription.payload });
      if (parsed.kind !== "NOTIFICATION" || !parsed.payload.enabled) throw new Error("Subscription disabled");
      await authorizeOrg(subscription.userId, row.organizationId, "alerts:manage");
      await authorizeOrg(parsed.payload.memberId, row.organizationId, "alerts:read");
      const recipient = await db.user.findUniqueOrThrow({ where: { id: parsed.payload.memberId } });
      if (!recipient.emailVerified) throw new Error("Recipient email is not verified");
      if (env.MAIL_TRANSPORT !== "smtp") throw new Error("SMTP is not configured");
      const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, requireTLS: true, tls: { minVersion: "TLSv1.2", rejectUnauthorized: true }, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined, connectionTimeout: 10000, socketTimeout: 15000, greetingTimeout: 10000, disableFileAccess: true, disableUrlAccess: true });
      try {
        await transport.sendMail({ from: env.MAIL_FROM, to: { address: recipient.email, name: "" }, subject: row.eventId.startsWith("test:") ? "Stratus notification test" : "Stratus: a workspace alert needs review", messageId: `<${row.id}@stratus.local>`, text: `Open Stratus and select the workspace to review your alerts:\n${new URL("/alerts", env.APP_URL).href}\n\nThis email contains no resource or finding details.` });
      } finally { transport.close(); }
      await db.notificationDelivery.updateMany({ where: { id: row.id, organizationId: row.organizationId }, data: { status: "SENT", message: "Accepted by SMTP" } });
    } catch {
      await db.notificationDelivery.updateMany({ where: { id: row.id, organizationId: row.organizationId }, data: { status: row.attempts >= 2 ? "FAILED" : "PENDING", nextAttemptAt: new Date(Date.now() + (row.attempts + 1) * 5 * 60000), message: "Delivery failed. Check SMTP configuration, verified recipient, subscription and permissions. Retries can cause duplicate emails." } });
    }
  }
}
