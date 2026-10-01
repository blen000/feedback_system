import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { generateTemporaryPassword } from "@/lib/auth/crypto";
import { writeAudit } from "@/lib/audit";
import * as mailer from "@/lib/mail/mailer";
import { passwordSchema } from "@/lib/validation/auth";
import { authenticateToken, login, MAX_ACTIVE_SESSIONS } from "@/server/services/auth";
import { actorWith, cleanup, makeUser, randomIp, TEST_PASSWORD } from "./helpers";

afterAll(cleanup);
beforeEach(() => {
  mailer.outbox.length = 0;
});

describe("password policy", () => {
  const ok = (p: string) => passwordSchema.safeParse(p).success;

  it("requires upper, lower, number and special character", () => {
    expect(ok("Tr1cky-Horse-Battery")).toBe(true);
    expect(ok("alllowercase1!")).toBe(false);
    expect(ok("ALLUPPERCASE1!")).toBe(false);
    expect(ok("NoNumbers-Here!")).toBe(false);
    expect(ok("NoSpecials1234Ab")).toBe(false);
    expect(ok("Sh0rt!a")).toBe(false);
  });

  it("rejects common passwords even when they satisfy the character rules", () => {
    for (const p of [
      "Password123!",
      "P@ssw0rd2024",
      "Qwerty@12345",
      "Welcome1234!",
      "Admin@12345",
      "Letmein#2024",
    ])
      expect(ok(p), p).toBe(false);
    expect(ok("aaaaaaaaA1!a")).toBe(false);
  });

  it("generated temporary passwords always satisfy the policy", () => {
    for (let i = 0; i < 200; i++) expect(ok(generateTemporaryPassword()), "generated").toBe(true);
  });
});

describe("session cap", () => {
  it("ends the oldest session when a user signs in beyond the limit", async () => {
    const { email } = await makeUser({ permissions: ["dashboard.view"] });
    const tokens: string[] = [];
    for (let i = 0; i < MAX_ACTIVE_SESSIONS + 1; i++) {
      tokens.push((await login({ email, password: TEST_PASSWORD }, { ip: randomIp() })).token);
      await new Promise((r) => setTimeout(r, 5)); // distinct createdAt
    }
    expect(await authenticateToken(tokens[0])).toBeNull();
    for (const t of tokens.slice(1)) expect(await authenticateToken(t)).not.toBeNull();
  });
});

describe("audit log", () => {
  it("records severity and client address", async () => {
    const a = await actorWith({ permissions: ["dashboard.view"] });
    await writeAudit({ actorId: a.userId, action: "ROLE_DELETED", resource: "Role", ip: "203.0.113.9" });
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: a.userId, action: "ROLE_DELETED" },
    });
    expect(row.severity).toBe("HIGH");
    expect(row.ip).toBe("203.0.113.9");
    expect(row.ipHash).toBeTruthy();
    const info = await prisma.auditLog.findFirstOrThrow({ where: { actorId: a.userId, action: "LOGIN" } });
    expect(info.severity).toBe("INFO");
  });

  it("raises an email alert for high-severity events only", async () => {
    await writeAudit({ action: "LOGOUT", resource: "User", ip: null });
    await writeAudit({ action: "ROLE_DELETED", resource: "Role", ip: null });
    for (let i = 0; i < 40 && mailer.outbox.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
    expect(mailer.outbox.length).toBeGreaterThan(0);
    expect(mailer.outbox.every((m) => m.subject.includes("ROLE_DELETED"))).toBe(true);
    expect(mailer.outbox.every((m) => !/password|token/i.test(m.text.replace(/Security event/g, "")))).toBe(
      true,
    );
  });

  it("is append-only: rows cannot be edited or deleted", async () => {
    const a = await actorWith({ permissions: [] });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { actorId: a.userId } });
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: "X" } })).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(prisma.auditLog.deleteMany({ where: { id: row.id } })).rejects.toThrow();
  });

  it("locking an account is recorded", async () => {
    const { email, user } = await makeUser({ permissions: [] });
    const ip = randomIp();
    for (let i = 0; i < 5; i++)
      await login({ email, password: "Wrong-Passw0rd!" }, { ip }).catch(() => undefined);
    const row = await prisma.auditLog.findFirst({ where: { action: "ACCOUNT_LOCKED", resourceId: user.id } });
    expect(row?.severity).toBe("WARNING");
    expect(row?.metadata).toMatchObject({ seconds: 30 });
  });
});

describe("deployment configuration", () => {
  const config = readFileSync("next.config.ts", "utf8");
  it("sets the full header set", () => {
    for (const h of [
      "Cross-Origin-Embedder-Policy",
      "Cross-Origin-Resource-Policy",
      "X-Permitted-Cross-Domain-Policies",
      "Strict-Transport-Security",
      "Permissions-Policy",
    ])
      expect(config).toContain(h);
    expect(config).toContain("includeSubDomains; preload");
    for (const f of ["payment", "usb", "serial", "bluetooth", "browsing-topics", "camera", "microphone"])
      expect(config).toContain(`"${f}"`);
  });
  it("uses SameSite=Strict for the session cookie", () => {
    expect(readFileSync("src/lib/auth/session.ts", "utf8")).toContain('sameSite: "strict"');
  });
  it("never runs the console mail driver in production", () => {
    expect(readFileSync("src/lib/mail/mailer.ts", "utf8")).toContain('e.NODE_ENV !== "production"');
  });
});
