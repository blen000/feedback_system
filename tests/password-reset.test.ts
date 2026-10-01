import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { hmac } from "@/lib/auth/crypto";
import * as mailer from "@/lib/mail/mailer";
import { inviteEmail } from "@/lib/mail/templates";
import { authenticateToken, login } from "@/server/services/auth";
import { completePasswordReset, inspectToken, requestPasswordReset } from "@/server/services/password-reset";
import { createUser, resendInvite } from "@/server/services/users";
import {
  actorWith,
  cleanup,
  makeDistrict,
  makeRole,
  makeUser,
  randomIp,
  TEST_PASSWORD,
  uid,
} from "./helpers";

afterAll(async () => {
  await prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: "reset" } } });
  await cleanup();
});
beforeEach(() => {
  mailer.outbox.length = 0;
});

const newEmail = () => `${uid("n").toLowerCase()}@test.local`;
const tokenFrom = (text: string) => decodeURIComponent(text.match(/reset-password\?token=([^\s"&<]+)/)![1]);
const waitForMail = async (n = 1) => {
  for (let i = 0; i < 40 && mailer.outbox.length < n; i++) await new Promise((r) => setTimeout(r, 25));
  return mailer.outbox;
};
const STRONG = "Brand-New-Passw0rd-9";

async function creator() {
  const role = await makeRole(["dashboard.view"]);
  const admin = await actorWith({
    permissions: ["user.create", "user.update", "dashboard.view"],
  });
  return { admin, roleId: role.id };
}

describe("driver selection", () => {
  it("uses the in-memory capture driver under tests, so tests never send real mail", () => {
    expect(mailer.mailDriver()).toBe("capture");
    expect(mailer.emailEnabled()).toBe(true);
  });
});

describe("invitations (user creation)", () => {
  it("emails a one-time set-password link instead of an admin-chosen password", async () => {
    const { admin, roleId } = await creator();
    const email = newEmail();
    const res = await createUser(admin, {
      email,
      name: "Abebe Kebede",
      password: "Ignored-Passw0rd-1", // ignored: the user picks their own
      assignments: [{ roleId, scopeType: "ALL" }],
    });
    expect(res).toMatchObject({ inviteMode: true, emailSent: true });

    const [mail] = await waitForMail();
    expect(mail.to).toBe(email);
    expect(mail.subject).toMatch(/Set up your/);
    expect(mail.text).toContain("/reset-password?token=");
    expect(mail.text + mail.html).not.toContain("Ignored-Passw0rd-1"); // no password travels by email

    // the typed password is not usable; the account only becomes usable via the link
    await expect(login({ email, password: "Ignored-Passw0rd-1" }, { ip: randomIp() })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    const token = tokenFrom(mail.text);
    expect(await inspectToken(token)).toEqual({ valid: true, purpose: "INVITE" });

    await completePasswordReset({ token, newPassword: STRONG, confirmPassword: STRONG });
    const session = await login({ email, password: STRONG }, { ip: randomIp() });
    expect(session.mustChangePassword).toBe(false); // they chose it themselves
    expect(
      await prisma.auditLog.findFirst({ where: { action: "USER_INVITED", actorId: admin.userId } }),
    ).not.toBeNull();
  });

  it("stores only a keyed hash of the emailed token", async () => {
    const { admin, roleId } = await creator();
    await createUser(admin, {
      email: newEmail(),
      name: "Hash Check",
      assignments: [{ roleId, scopeType: "ALL" }],
    });
    const token = tokenFrom((await waitForMail())[0].text);
    const rows = await prisma.passwordToken.findMany({
      where: { tokenHash: { in: [token, hmac(`pwd:${token}`)] } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(token);
  });

  it("does not undo the account when the email cannot be delivered, and can be resent", async () => {
    const { admin, roleId } = await creator();
    const spy = vi.spyOn(mailer, "sendMail").mockRejectedValueOnce(new Error("mail server down"));
    const email = newEmail();
    const res = await createUser(admin, {
      email,
      name: "No Mail",
      assignments: [{ roleId, scopeType: "ALL" }],
    });
    spy.mockRestore();
    expect(res).toMatchObject({ inviteMode: true, emailSent: false });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.status).toBe("ACTIVE");

    await resendInvite(admin, user.id);
    expect((await waitForMail()).at(-1)?.to).toBe(email);
  });

  it("escapes the user's name in the HTML body and builds links from configuration, not from request data", () => {
    const mail = inviteEmail({
      to: "a@b.c",
      name: `<img src=x onerror=alert(1)> Evil`,
      link: "http://localhost:3000/reset-password?token=abc",
      hours: 2,
    });
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).toContain("&lt;img");
    expect(mail.html).toContain("http://localhost:3000/reset-password?token=abc");
  });
});

describe("resending an invitation", () => {
  it("only for active users who have never signed in, and the new link voids the old one", async () => {
    const { admin, roleId } = await creator();
    const email = newEmail();
    const { id } = await createUser(admin, {
      email,
      name: "Later Joiner",
      assignments: [{ roleId, scopeType: "ALL" }],
    });
    const first = tokenFrom((await waitForMail())[0].text);

    await resendInvite(admin, id);
    const second = tokenFrom((await waitForMail(2))[1].text);
    expect(second).not.toBe(first);
    expect(await inspectToken(first)).toEqual({ valid: false });
    expect((await inspectToken(second)).valid).toBe(true);

    // once they have signed in, an invitation makes no sense
    await completePasswordReset({ token: second, newPassword: STRONG, confirmPassword: STRONG });
    await login({ email, password: STRONG }, { ip: randomIp() });
    await expect(resendInvite(admin, id)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("needs user.update", async () => {
    const { admin, roleId } = await creator();
    const { id } = await createUser(admin, {
      email: newEmail(),
      name: "Target",
      assignments: [{ roleId, scopeType: "ALL" }],
    });
    const nobody = await actorWith({ permissions: ["user.view"] });
    await expect(resendInvite(nobody, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("forgot password", () => {
  it("emails a reset link to a real, active account", async () => {
    const { email } = await makeUser({ permissions: [] });
    await requestPasswordReset(email, { ip: randomIp() });
    const [mail] = await waitForMail();
    expect(mail.to).toBe(email);
    expect(mail.subject).toMatch(/Reset your/);
    expect((await inspectToken(tokenFrom(mail.text))).valid).toBe(true);
  });

  it("answers identically for unknown, inactive and malformed emails, and sends nothing", async () => {
    const inactive = await makeUser({ permissions: [], status: "INACTIVE" });
    for (const e of ["nobody-here@test.local", inactive.email, "not-an-email", "", null, 42]) {
      await expect(requestPasswordReset(e, { ip: randomIp() })).resolves.toBeUndefined();
    }
    await new Promise((r) => setTimeout(r, 150));
    expect(mailer.outbox).toHaveLength(0);
  });

  it("rate-limits repeated requests for one address and from one source", async () => {
    const { email } = await makeUser({ permissions: [] });
    const outcomes: string[] = [];
    for (let i = 0; i < 5; i++)
      outcomes.push(
        await requestPasswordReset(email, { ip: randomIp() }).then(
          () => "ok",
          (e) => e.code,
        ),
      );
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(3);
    expect(outcomes).toContain("RATE_LIMITED");

    const ip = randomIp();
    const bySource: string[] = [];
    for (let i = 0; i < 12; i++)
      bySource.push(
        await requestPasswordReset(`x${i}@test.local`, { ip }).then(
          () => "ok",
          (e) => e.code,
        ),
      );
    expect(bySource).toContain("RATE_LIMITED");
  });

  it("a newer link voids the previous one", async () => {
    const { email } = await makeUser({ permissions: [] });
    await requestPasswordReset(email, { ip: randomIp() });
    const first = tokenFrom((await waitForMail())[0].text);
    await requestPasswordReset(email, { ip: randomIp() });
    const second = tokenFrom((await waitForMail(2))[1].text);
    expect(await inspectToken(first)).toEqual({ valid: false });
    expect((await inspectToken(second)).valid).toBe(true);
  });
});

describe("completing a reset", () => {
  async function linkFor() {
    const u = await makeUser({ permissions: ["dashboard.view"] });
    mailer.outbox.length = 0;
    await requestPasswordReset(u.email, { ip: randomIp() });
    return { ...u, token: tokenFrom((await waitForMail())[0].text) };
  }

  it("sets the new password, ends every existing session, clears lockout and audits it", async () => {
    const u = await linkFor();
    const before = await login({ email: u.email, password: TEST_PASSWORD }, { ip: randomIp() });
    for (let i = 0; i < 5; i++)
      await login({ email: u.email, password: "Wrong-Passw0rd!" }, { ip: randomIp() }).catch(() => undefined); // locked

    await completePasswordReset(
      { token: u.token, newPassword: STRONG, confirmPassword: STRONG },
      { ip: randomIp() },
    );

    expect(await authenticateToken(before.token)).toBeNull(); // old session revoked
    await expect(login({ email: u.email, password: TEST_PASSWORD }, { ip: randomIp() })).rejects.toBeTruthy();
    await expect(login({ email: u.email, password: STRONG }, { ip: randomIp() })).resolves.toBeTruthy(); // lock cleared too
    const log = await prisma.auditLog.findFirst({
      where: { action: "PASSWORD_RESET_COMPLETED", actorId: u.user.id },
    });
    expect(log).not.toBeNull();
    expect(JSON.stringify(log)).not.toContain(STRONG);
  });

  it("works exactly once", async () => {
    const u = await linkFor();
    await completePasswordReset({ token: u.token, newPassword: STRONG, confirmPassword: STRONG });
    await expect(
      completePasswordReset({
        token: u.token,
        newPassword: "Another-Passw0rd-2",
        confirmPassword: "Another-Passw0rd-2",
      }),
    ).rejects.toMatchObject({
      message: "This link is invalid or has expired.",
    });
    await expect(
      login({ email: u.email, password: "Another-Passw0rd-2" }, { ip: randomIp() }),
    ).rejects.toBeTruthy();
  });

  it("lets only one of two simultaneous submissions succeed", async () => {
    const u = await linkFor();
    const attempts = await Promise.allSettled([
      completePasswordReset({ token: u.token, newPassword: STRONG, confirmPassword: STRONG }),
      completePasswordReset({
        token: u.token,
        newPassword: "Second-Passw0rd-3",
        confirmPassword: "Second-Passw0rd-3",
      }),
    ]);
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  });

  it("rejects expired, forged, malformed and reused tokens without saying which", async () => {
    const u = await linkFor();
    await prisma.passwordToken.updateMany({
      where: { userId: u.user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    for (const bad of [u.token, "short", "x".repeat(200), "A".repeat(43), undefined, null, 123]) {
      expect(await inspectToken(bad)).toEqual({ valid: false });
    }
    await expect(
      completePasswordReset({ token: u.token, newPassword: STRONG, confirmPassword: STRONG }),
    ).rejects.toMatchObject({
      message: "This link is invalid or has expired.",
    });
  });

  it("enforces the password policy and matching confirmation before consuming the link", async () => {
    const u = await linkFor();
    await expect(
      completePasswordReset({ token: u.token, newPassword: "short1", confirmPassword: "short1" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      completePasswordReset({ token: u.token, newPassword: STRONG, confirmPassword: "different-Passw0rd" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await inspectToken(u.token)).valid).toBe(true); // still usable after a validation failure
    await completePasswordReset({ token: u.token, newPassword: STRONG, confirmPassword: STRONG });
  });

  it("refuses links for accounts that have since been deactivated", async () => {
    const u = await linkFor();
    await prisma.user.update({ where: { id: u.user.id }, data: { status: "INACTIVE" } });
    expect(await inspectToken(u.token)).toEqual({ valid: false });
    await expect(
      completePasswordReset({ token: u.token, newPassword: STRONG, confirmPassword: STRONG }),
    ).rejects.toBeTruthy();
  });
});

describe("without email configured", () => {
  it("falls back to an admin-set temporary password", async () => {
    const { admin, roleId } = await creator();
    const enabled = vi.spyOn(mailer, "emailEnabled").mockReturnValue(false);
    try {
      await expect(
        createUser(admin, { email: newEmail(), name: "Manual", assignments: [{ roleId, scopeType: "ALL" }] }),
      ).rejects.toMatchObject({
        code: "VALIDATION",
      });
      const email = newEmail();
      const res = await createUser(admin, {
        email,
        name: "Manual",
        password: "Typed-Passw0rd-1",
        assignments: [{ roleId, scopeType: "ALL" }],
      });
      expect(res).toMatchObject({ inviteMode: false, emailSent: null });
      const session = await login({ email, password: "Typed-Passw0rd-1" }, { ip: randomIp() });
      expect(session.mustChangePassword).toBe(true);
    } finally {
      enabled.mockRestore();
    }
    void makeDistrict;
  });
});
