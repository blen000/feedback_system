/**
 * Outgoing email. Drivers:
 *   smtp     – real delivery through SMTP_HOST (STARTTLS on 587, TLS on 465)
 *   console  – prints the message to the server log (local trials, MAIL_DRIVER=console)
 *   capture  – in-memory outbox, used automatically under tests so no real mail is ever sent
 *   off      – nothing configured; callers fall back to non-email flows
 */
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/env";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

type Driver = "smtp" | "console" | "capture" | "off";

/** Messages "sent" under the capture driver (tests read this). */
export const outbox: Mail[] = [];

export function mailDriver(): Driver {
  const e = env();
  if (e.NODE_ENV === "test") return "capture";
  // the console driver prints one-time links into the log: it must never run in production
  if (e.MAIL_DRIVER === "console" && e.NODE_ENV !== "production") return "console";
  return e.SMTP_HOST && e.SMTP_FROM ? "smtp" : "off";
}

export function emailEnabled(): boolean {
  return mailDriver() !== "off";
}

const globalForMail = globalThis as unknown as { mailer?: Transporter };

function transporter(): Transporter {
  if (globalForMail.mailer) return globalForMail.mailer;
  const e = env();
  const secure = e.SMTP_PORT === 465;
  globalForMail.mailer = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure, // implicit TLS on 465
    requireTLS: !secure, // otherwise insist on STARTTLS so credentials never travel in clear text
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
    tls: { rejectUnauthorized: e.SMTP_ALLOW_SELF_SIGNED !== "true" },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return globalForMail.mailer;
}

/** Checks connection, TLS and login with the mail server WITHOUT sending anything. */
export async function verifyMailServer(): Promise<void> {
  await transporter().verify();
}

/** Sends one message. Throws if delivery to the mail server fails; callers decide how to recover. */
export async function sendMail(mail: Mail): Promise<void> {
  switch (mailDriver()) {
    case "capture":
      outbox.push(mail);
      return;
    case "console":
      console.log(`\n[mail:console] To: ${mail.to}\nSubject: ${mail.subject}\n${mail.text}\n`);
      return;
    case "smtp": {
      const e = env();
      try {
        await transporter().sendMail({
          from: e.SMTP_FROM,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        });
      } catch (err) {
        // log the failure class only: never credentials or message bodies (they contain one-time links)
        const code = (err as { code?: string }).code ?? "UNKNOWN";
        console.error(`[mail] delivery failed (${code})`);
        throw err;
      }
      return;
    }
    case "off":
      throw new Error("Email is not configured.");
  }
}
