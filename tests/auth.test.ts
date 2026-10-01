import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { hmac } from "@/lib/auth/crypto";
import {
  authenticateToken,
  changeOwnPassword,
  login,
  logout,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
} from "@/server/services/auth";
import { setUserActive } from "@/server/services/users";
import { actorWith, cleanup, makeUser, randomIp, TEST_PASSWORD } from "./helpers";

afterAll(cleanup);

describe("login", () => {
  it("accepts valid credentials and issues a session that resolves to the user", async () => {
    const { email } = await makeUser({ permissions: ["dashboard.view"] });
    const res = await login({ email: email.toUpperCase(), password: TEST_PASSWORD }, { ip: randomIp() });
    expect(res.token.length).toBeGreaterThan(30);
    const ctx = await authenticateToken(res.token);
    expect(ctx?.email).toBe(email);
    expect(ctx?.assignments[0].permissions.has("dashboard.view")).toBe(true);
  });

  it("stores only a keyed hash of the session token", async () => {
    const { email } = await makeUser({ permissions: [] });
    const { token } = await login({ email, password: TEST_PASSWORD }, { ip: randomIp() });
    const rows = await prisma.session.findMany({ where: { tokenHash: { in: [token, hmac(token)] } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hmac(token));
    expect(rows[0].tokenHash).not.toBe(token);
  });

  it("rejects a wrong password and an unknown email with the same message", async () => {
    const { email } = await makeUser({ permissions: [] });
    const bad = await login({ email, password: "wrong-password-1" }, { ip: randomIp() }).catch((e) => e);
    const unknown = await login(
      { email: "nobody@test.local", password: "wrong-password-1" },
      { ip: randomIp() },
    ).catch((e) => e);
    expect(bad.code).toBe("UNAUTHENTICATED");
    expect(unknown.code).toBe("UNAUTHENTICATED");
    expect(bad.message).toBe(unknown.message);
  });

  it("rejects inactive users even with the correct password", async () => {
    const { email } = await makeUser({ permissions: [], status: "INACTIVE" });
    await expect(login({ email, password: TEST_PASSWORD }, { ip: randomIp() })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("locks the login after 5 failures, even for the right password (see login-lockout.test.ts)", async () => {
    const { email } = await makeUser({ permissions: [] });
    for (let i = 0; i < 5; i++) {
      await login({ email, password: "wrong-password-1" }, { ip: randomIp() }).catch(() => undefined);
    }
    await expect(login({ email, password: TEST_PASSWORD }, { ip: randomIp() })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("rate-limits a single source", async () => {
    const ip = randomIp();
    let limited = false;
    for (let i = 0; i < 35 && !limited; i++) {
      const e = await login({ email: `x${i}@test.local`, password: "whatever-123" }, { ip }).catch((e) => e);
      limited = e.code === "RATE_LIMITED";
    }
    expect(limited).toBe(true);
  });

  it("writes audit entries without ever storing the password", async () => {
    const { email, user } = await makeUser({ permissions: [] });
    await login({ email, password: "wrong-password-1" }, { ip: randomIp() }).catch(() => undefined);
    await login({ email, password: TEST_PASSWORD }, { ip: randomIp() });
    const logs = await prisma.auditLog.findMany({ where: { actorId: user.id } });
    expect(logs.map((l) => l.action).sort()).toEqual(["LOGIN", "LOGIN_FAILED"]);
    expect(JSON.stringify(logs)).not.toContain(TEST_PASSWORD);
    expect(JSON.stringify(logs)).not.toContain("wrong-password-1");
  });
});

describe("session lifecycle", () => {
  it("returns null for missing, unknown or revoked tokens", async () => {
    expect(await authenticateToken(undefined)).toBeNull();
    expect(await authenticateToken("not-a-real-token")).toBeNull();
    const actor = await actorWith({ permissions: [] });
    await logout(actor.token);
    expect(await authenticateToken(actor.token)).toBeNull();
  });

  it("expires after the absolute lifetime", async () => {
    const actor = await actorWith({ permissions: [] });
    await prisma.session.update({
      where: { id: actor.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await authenticateToken(actor.token)).toBeNull();
    expect(SESSION_ABSOLUTE_MS).toBe(8 * 3600 * 1000);
  });

  it("expires after the idle timeout", async () => {
    const actor = await actorWith({ permissions: [] });
    await prisma.session.update({
      where: { id: actor.sessionId },
      data: { lastUsedAt: new Date(Date.now() - SESSION_IDLE_MS - 1000) },
    });
    expect(await authenticateToken(actor.token)).toBeNull();
  });

  it("stops working immediately when the user is deactivated", async () => {
    // the admin must hold everything the target holds (hierarchy rule), hence dashboard.view
    const admin = await actorWith({ permissions: ["user.deactivate", "dashboard.view"] });
    const target = await actorWith({ permissions: ["dashboard.view"] });
    expect(await authenticateToken(target.token)).not.toBeNull();
    await setUserActive(admin, target.userId, false);
    expect(await authenticateToken(target.token)).toBeNull();
  });

  it("picks up permission changes on the very next request", async () => {
    const actor = await actorWith({ permissions: ["dashboard.view"] });
    await prisma.rolePermission.deleteMany({
      where: { role: { users: { some: { userId: actor.userId } } } },
    });
    const ctx = await authenticateToken(actor.token);
    expect(ctx?.assignments[0].permissions.size).toBe(0);
  });
});

describe("changeOwnPassword", () => {
  it("requires the current password, enforces the policy and revokes other sessions", async () => {
    const actor = await actorWith({ permissions: [] });
    const { token: other } = await login({ email: actor.email, password: TEST_PASSWORD }, { ip: randomIp() });

    await expect(
      changeOwnPassword(actor, {
        currentPassword: "nope",
        newPassword: "New-Passw0rd-456",
        confirmPassword: "New-Passw0rd-456",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      changeOwnPassword(actor, {
        currentPassword: TEST_PASSWORD,
        newPassword: "short1",
        confirmPassword: "short1",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await changeOwnPassword(actor, {
      currentPassword: TEST_PASSWORD,
      newPassword: "New-Passw0rd-456",
      confirmPassword: "New-Passw0rd-456",
    });
    expect(await authenticateToken(other)).toBeNull(); // other session revoked
    expect(await authenticateToken(actor.token)).not.toBeNull(); // current one kept
    await expect(
      login({ email: actor.email, password: TEST_PASSWORD }, { ip: randomIp() }),
    ).rejects.toBeTruthy();
    await expect(
      login({ email: actor.email, password: "New-Passw0rd-456" }, { ip: randomIp() }),
    ).resolves.toBeTruthy();
  });
});
