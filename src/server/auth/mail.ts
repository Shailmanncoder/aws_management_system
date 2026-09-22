import "server-only";
import nodemailer from "nodemailer";
import { getEnv } from "../env";

const outbox: { to: string; subject: string; url: string }[] = [];

export async function sendAuthEmail(to: string, subject: string, url: string): Promise<void> {
  const env = getEnv();
  // Links originate from Better Auth, and must stay on the configured application origin.
  if (new URL(url).origin !== new URL(env.APP_URL).origin) throw new Error("Invalid authentication email origin");
  if (env.MAIL_TRANSPORT === "test" && env.APP_ENV === "test") {
    outbox.push({ to, subject, url });
    if (outbox.length > 100) outbox.shift();
    return;
  }
  if (env.MAIL_TRANSPORT !== "smtp") throw new Error("Email delivery is not configured");
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465,
    requireTLS: true, tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10000, socketTimeout: 15000, greetingTimeout: 10000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  });
  try {
    await transport.sendMail({ from: env.MAIL_FROM, to: { address: to, name: "" }, subject,
      text: `${subject}\n\nOpen this link to continue:\n${url}\n\nIf you did not request this, ignore this email.` });
  } catch { throw new Error("Authentication email delivery failed"); }
  finally { transport.close(); }
}

/** Available only to local automated tests; no HTTP endpoint exposes this outbox. */
export function takeTestEmails() {
  if (getEnv().APP_ENV !== "test" || getEnv().MAIL_TRANSPORT !== "test") throw new Error("Test outbox is disabled");
  return outbox.splice(0);
}
