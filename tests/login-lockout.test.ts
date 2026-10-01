import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { login } from "@/server/services/auth";
import { throttleKeyFor, LOCKOUT_SECONDS, MAX_LOGIN_ATTEMPTS } from "@/server/services/login-throttle";
import { cleanup, makeUser, randomIp, TEST_PASSWORD, uid } from "./helpers";

afterAll(cleanup);

const WRONG = "Wrong-Passw0rd!";
const fail = (email: string, ip = randomIp()) => login({ email, password: WRONG }, { ip }).catch((e) => e);

describe("login lockout: 5 attempts, then exactly 30 seconds", () => {
  it("has the required constants", () => {
    expect(MAX_LOGIN_ATTEMPTS).toBe(5);
    expect(LOCKOUT_SECONDS).toBe(30);
  });

  it("allows 4 failures, locks on the 5th with a 30 second countdown", async () => {
    const { email } = await makeUser({ permissions: [] });
    for (let i = 1; i <= 4; i++) {
      const e = await fail(email);
      expect(e.code, `attempt ${i}`).toBe("UNAUTHENTICATED");
      expect(e.retryAfterSeconds).toBeUndefined();
    }
    const fifth = await fail(email);
    expect(fifth.code).toBe("RATE_LIMITED");
    expect(fifth.retryAfterSeconds).toBe(30);

    const row = await prisma.loginThrottle.findUniqueOrThrow({ where: { key: throttleKeyFor(email) } });
    const left = (row.lockedUntil!.getTime() - Date.now()) / 1000;
    expect(left).toBeGreaterThan(28);
    expect(left).toBeLessThanOrEqual(30);
  });

  it("refuses every attempt during the lock, including the correct password, without extending it", async () => {
    const { email } = await makeUser({ permissions: [] });
    for (let i = 0; i < 5; i++) await fail(email);
    const before = await prisma.loginThrottle.findUniqueOrThrow({ where: { key: throttleKeyFor(email) } });

    for (const password of [TEST_PASSWORD, WRONG, TEST_PASSWORD]) {
      const e = await login({ email, password }, { ip: randomIp() }).catch((x) => x);
      expect(e.code).toBe("RATE_LIMITED");
      expect(e.retryAfterSeconds).toBeGreaterThan(0);
      expect(e.retryAfterSeconds).toBeLessThanOrEqual(30);
    }
    const after = await prisma.loginThrottle.findUniqueOrThrow({ where: { key: throttleKeyFor(email) } });
    expect(after.lockedUntil!.getTime()).toBe(before.lockedUntil!.getTime()); // not extended
    expect(after.attempts).toBe(before.attempts); // not counted
  });

  it("unlocks by itself after the lock time has passed, then allows a fresh 5 attempts", async () => {
    const { email } = await makeUser({ permissions: [] });
    for (let i = 0; i < 5; i++) await fail(email);
    // shorten the remaining lock to ~1 s and wait it out for real
    await prisma.loginThrottle.update({
      where: { key: throttleKeyFor(email) },
      data: { lockedUntil: new Date(Date.now() + 1000) },
    });
    expect((await fail(email)).code).toBe("RATE_LIMITED");
    await new Promise((r) => setTimeout(r, 1200));

    for (let i = 1; i <= 4; i++)
      expect((await fail(email)).code, `fresh attempt ${i}`).toBe("UNAUTHENTICATED");
    await expect(login({ email, password: TEST_PASSWORD }, { ip: randomIp() })).resolves.toBeTruthy(); // 5th, correct
  });

  it("a correct sign-in resets the counter", async () => {
    const { email } = await makeUser({ permissions: [] });
    for (let i = 0; i < 4; i++) await fail(email);
    await login({ email, password: TEST_PASSWORD }, { ip: randomIp() });
    for (let i = 0; i < 4; i++) expect((await fail(email)).code).toBe("UNAUTHENTICATED");
  });

  it("is enforced even when requests arrive in parallel: only 5 passwords are ever checked", async () => {
    const { email, user } = await makeUser({ permissions: [] });
    const results = await Promise.all(Array.from({ length: 20 }, () => fail(email)));
    expect(results.filter((e) => e.code === "UNAUTHENTICATED").length).toBeLessThanOrEqual(5);
    const checked = await prisma.auditLog.count({
      where: {
        actorId: user.id,
        action: "LOGIN_FAILED",
        metadata: { path: ["reason"], equals: "bad_password" },
      },
    });
    expect(checked).toBe(5);
    // and the right password is refused while locked
    await expect(login({ email, password: TEST_PASSWORD }, { ip: randomIp() })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("behaves the same for an address that has no account (no enumeration)", async () => {
    const email = `${uid("ghost").toLowerCase()}@test.local`;
    for (let i = 1; i <= 4; i++) expect((await fail(email)).code).toBe("UNAUTHENTICATED");
    const fifth = await fail(email);
    expect(fifth.code).toBe("RATE_LIMITED");
    expect(fifth.retryAfterSeconds).toBe(30);
    expect((await fail(email)).code).toBe("RATE_LIMITED");
  });

  it("locks per account: another account is unaffected", async () => {
    const a = await makeUser({ permissions: [] });
    const b = await makeUser({ permissions: [] });
    for (let i = 0; i < 5; i++) await fail(a.email);
    await expect(
      login({ email: b.email, password: TEST_PASSWORD }, { ip: randomIp() }),
    ).resolves.toBeTruthy();
  });
});
