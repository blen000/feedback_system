import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Outgoing email (optional). Without SMTP_HOST the app falls back to admin-set passwords.
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().min(3).optional(),
  /** Accept a self-signed / private-CA certificate from the mail server. Weakens TLS: use only on a trusted network. */
  SMTP_ALLOW_SELF_SIGNED: z.enum(["true", "false"]).default("false"),
  /** "console" logs emails instead of sending (local trials); default is smtp when configured. */
  MAIL_DRIVER: z.enum(["smtp", "console"]).optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated environment. Server-only values must never be read from client code. */
export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}
