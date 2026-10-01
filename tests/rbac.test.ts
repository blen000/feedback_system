import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import * as mailer from "@/lib/mail/mailer";
import { passwordSchema } from "@/lib/validation/auth";
import { isWeakPassword } from "@/lib/validation/common-passwords";
import { authenticateToken, login } from "@/server/services/auth";
import { ALL_PERMISSIONS } from "@/lib/rbac/permissions";
import {
  createBranch,
  createDepartment,
  createDistrict,
  deleteBranch,
  listBranches,
  listDistricts,
  updateBranch,
} from "@/server/services/organization";
import { createRole, deleteRole, updateRole } from "@/server/services/roles";
import { createUser, listUsers, resetUserPassword, setUserActive, updateUser } from "@/server/services/users";
import {
  actorWith,
  cleanup,
  makeBranch,
  makeDistrict,
  makeRole,
  randomIp,
  TEST_PASSWORD,
  uid,
} from "./helpers";

let d1: { id: string };
let d2: { id: string };
let b1a: { id: string }; // district 1
let b1b: { id: string }; // district 1
let b2a: { id: string }; // district 2

beforeAll(async () => {
  d1 = await makeDistrict("D1");
  d2 = await makeDistrict("D2");
  b1a = await makeBranch(d1.id, "B1A");
  b1b = await makeBranch(d1.id, "B1B");
  b2a = await makeBranch(d2.id, "B2A");
});
afterAll(cleanup);

const BRANCH_PERMS = ["branch.view", "branch.create", "branch.update", "branch.delete"];
const validBranch = (districtId: string) => ({ code: uid("TB"), name: "New Branch", districtId });

describe("permission catalog", () => {
  it("is fully seeded in the database", async () => {
    const keys = (await prisma.permission.findMany()).map((p) => p.key);
    for (const p of ALL_PERMISSIONS) expect(keys).toContain(p);
  });

  it("SUPER_ADMIN holds every permission via stored role_permissions, not a hard-coded bypass", async () => {
    const role = await prisma.role.findUniqueOrThrow({
      where: { key: "SUPER_ADMIN" },
      include: { permissions: true },
    });
    expect(role.permissions.length).toBe(ALL_PERMISSIONS.length);
  });
});

describe("permission checks (server-side, direct service calls)", () => {
  it("denies a user whose role lacks the permission", async () => {
    const viewer = await actorWith({ permissions: ["branch.view"] });
    await expect(createBranch(viewer, validBranch(d1.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateBranch(viewer, b1a.id, validBranch(d1.id))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(deleteBranch(viewer, b1a.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a role with no permissions grants nothing, whatever it is called", async () => {
    const role = await makeRole([], "TR_ADMINISH");
    const nobody = await actorWith({ permissions: [], roleId: role.id });
    await expect(listBranches(nobody)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listDistricts(nobody)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listUsers(nobody)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("grants access when the permission is held", async () => {
    const admin = await actorWith({ permissions: BRANCH_PERMS });
    const created = await createBranch(admin, validBranch(d1.id));
    expect(created.districtId).toBe(d1.id);
    await deleteBranch(admin, created.id);
  });

  it("records an audit entry for each mutation", async () => {
    const admin = await actorWith({ permissions: BRANCH_PERMS });
    const created = await createBranch(admin, validBranch(d1.id));
    const log = await prisma.auditLog.findFirst({
      where: { actorId: admin.userId, action: "BRANCH_CREATED" },
    });
    expect(log?.resourceId).toBe(created.id);
  });
});

describe("organizational scope", () => {
  it("district manager sees only their district's branches", async () => {
    const dm = await actorWith({ permissions: ["branch.view"], scopeType: "DISTRICT", districtId: d1.id });
    const ids = (await listBranches(dm)).map((b) => b.id);
    expect(ids).toContain(b1a.id);
    expect(ids).toContain(b1b.id);
    expect(ids).not.toContain(b2a.id);
  });

  it("branch manager sees only their own branch", async () => {
    const bm = await actorWith({ permissions: ["branch.view"], scopeType: "BRANCH", branchId: b1a.id });
    expect((await listBranches(bm)).map((b) => b.id)).toEqual([b1a.id]);
  });

  it("bank-wide user sees branches in every district", async () => {
    const ho = await actorWith({ permissions: ["branch.view"], scopeType: "ALL" });
    const ids = (await listBranches(ho)).map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining([b1a.id, b1b.id, b2a.id]));
  });

  it("district manager cannot modify or delete another district's branch (IDOR)", async () => {
    const dm = await actorWith({ permissions: BRANCH_PERMS, scopeType: "DISTRICT", districtId: d1.id });
    await expect(updateBranch(dm, b2a.id, validBranch(d2.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteBranch(dm, b2a.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createBranch(dm, validBranch(d2.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("district manager cannot move their own branch into another district", async () => {
    const dm = await actorWith({ permissions: BRANCH_PERMS, scopeType: "DISTRICT", districtId: d1.id });
    await expect(
      updateBranch(dm, b1a.id, { code: "MOVED", name: "Moved Branch", districtId: d2.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("branch manager cannot act on a sibling branch in the same district", async () => {
    const bm = await actorWith({ permissions: BRANCH_PERMS, scopeType: "BRANCH", branchId: b1a.id });
    await expect(updateBranch(bm, b1b.id, validBranch(d1.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("only bank-wide users can create districts or Head Office departments", async () => {
    const dm = await actorWith({
      permissions: ["district.create", "department.create"],
      scopeType: "DISTRICT",
      districtId: d1.id,
    });
    await expect(createDistrict(dm, { code: uid("TD"), name: "Nope" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(createDepartment(dm, { code: uid("TDEP"), name: "HO dept" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // but inside their own district it is allowed
    await expect(
      createDepartment(dm, { code: uid("TDEP"), name: "District dept", districtId: d1.id }),
    ).resolves.toBeTruthy();
  });

  it("validates input on the server", async () => {
    const admin = await actorWith({ permissions: BRANCH_PERMS });
    await expect(
      createBranch(admin, { code: "!", name: "", districtId: "not-a-uuid" }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("privilege escalation", () => {
  it("cannot create a role with permissions the actor does not hold", async () => {
    const actor = await actorWith({ permissions: ["role.create", "dashboard.view"] });
    await expect(
      createRole(actor, { key: uid("TR"), name: "Sneaky", permissions: ["dashboard.view", "user.create"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createRole(actor, { key: uid("TR"), name: "Fine", permissions: ["dashboard.view"] }),
    ).resolves.toBeTruthy();
  });

  it("cannot grant yourself more power by editing a role you hold", async () => {
    const actor = await actorWith({ permissions: ["role.update", "role.view", "dashboard.view"] });
    const roleId = await prisma.userRole
      .findFirstOrThrow({ where: { userId: actor.userId } })
      .then((r) => r.roleId);
    await expect(
      updateRole(actor, roleId, {
        name: "Mine",
        permissions: ["role.update", "role.view", "dashboard.view", "user.create"],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cannot edit or delete a role more powerful than yourself", async () => {
    const actor = await actorWith({ permissions: ["role.update", "role.delete"] });
    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
    await expect(
      updateRole(actor, superAdmin.id, { name: "Hijacked", permissions: [] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteRole(actor, superAdmin.id)).rejects.toMatchObject({ code: "CONFLICT" }); // system role
  });

  it("cannot assign a stronger role, or a wider scope, when creating a user", async () => {
    const hr = await actorWith({
      permissions: ["user.create", "dashboard.view", "branch.view"],
      scopeType: "DISTRICT",
      districtId: d1.id,
    });
    const strong = await makeRole(["user.create", "user.update", "dashboard.view"]);
    const weak = await makeRole(["dashboard.view"]);
    const base = {
      email: `${uid("n").toLowerCase()}@test.local`,
      name: "New Person",
      password: "Valid-Passw0rd-1",
    };

    // role with permissions the actor lacks
    await expect(
      createUser(hr, {
        ...base,
        assignments: [{ roleId: strong.id, scopeType: "DISTRICT", districtId: d1.id }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // weak role, but bank-wide scope (actor only has a district)
    await expect(
      createUser(hr, { ...base, assignments: [{ roleId: weak.id, scopeType: "ALL" }] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // weak role in a different district
    await expect(
      createUser(hr, {
        ...base,
        assignments: [{ roleId: weak.id, scopeType: "DISTRICT", districtId: d2.id }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // weak role in own district: allowed
    await expect(
      createUser(hr, {
        ...base,
        assignments: [{ roleId: weak.id, scopeType: "DISTRICT", districtId: d1.id }],
      }),
    ).resolves.toBeTruthy();
  });

  it("cannot manage, reset or deactivate a user who holds more than you", async () => {
    const lowAdmin = await actorWith({ permissions: ["user.update", "user.deactivate", "dashboard.view"] });
    const powerful = await actorWith({ permissions: ["dashboard.view", "user.create", "feedback.view"] });
    await expect(
      resetUserPassword(lowAdmin, powerful.userId, { currentPassword: TEST_PASSWORD }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setUserActive(lowAdmin, powerful.userId, false)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      updateUser(lowAdmin, powerful.userId, { name: "Renamed", assignments: [] }),
    ).rejects.toBeTruthy();
  });

  it("cannot change own roles or deactivate self", async () => {
    const actor = await actorWith({ permissions: ["user.update", "user.deactivate", "dashboard.view"] });
    const roleId = await prisma.userRole
      .findFirstOrThrow({ where: { userId: actor.userId } })
      .then((r) => r.roleId);
    await expect(
      updateUser(actor, actor.userId, { name: "Me", assignments: [{ roleId, scopeType: "ALL" }] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setUserActive(actor, actor.userId, false)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("password reset (email configured) emails a link: the administrator never sees a password", async () => {
    const admin = await actorWith({ permissions: ["user.update", "dashboard.view"] });
    const target = await actorWith({ permissions: ["dashboard.view"] });
    const res = await resetUserPassword(admin, target.userId, { currentPassword: TEST_PASSWORD });
    expect(res).toMatchObject({ temporaryPassword: null, emailSent: true });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
    expect(row.mustChangePassword).toBe(true);
    // the old password no longer works and the user's sessions ended
    await expect(
      login({ email: target.email, password: TEST_PASSWORD }, { ip: randomIp() }),
    ).rejects.toThrow();
    expect(await authenticateToken(target.token)).toBeNull();
  });

  it("password reset (no email) issues an expiring temporary password and forces a change", async () => {
    const spy = vi.spyOn(mailer, "emailEnabled").mockReturnValue(false);
    try {
      const admin = await actorWith({ permissions: ["user.update", "dashboard.view"] });
      const target = await actorWith({ permissions: ["dashboard.view"] });
      const res = await resetUserPassword(admin, target.userId, { currentPassword: TEST_PASSWORD });
      expect(res.temporaryPassword!.length).toBeGreaterThanOrEqual(12);
      expect(isWeakPassword(res.temporaryPassword!)).toBe(false);
      expect(passwordSchema.safeParse(res.temporaryPassword).success).toBe(true);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
      expect(row.mustChangePassword).toBe(true);
      expect(row.passwordHash).not.toContain(res.temporaryPassword!);
      expect(row.tempPasswordExpiresAt!.getTime()).toBeGreaterThan(Date.now());

      const ok = await login({ email: target.email, password: res.temporaryPassword! }, { ip: randomIp() });
      expect(ok.mustChangePassword).toBe(true);

      // once the window has passed the temporary password is refused
      await prisma.user.update({
        where: { id: target.userId },
        data: { tempPasswordExpiresAt: new Date(Date.now() - 1000) },
      });
      await expect(
        login({ email: target.email, password: res.temporaryPassword! }, { ip: randomIp() }),
      ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    } finally {
      spy.mockRestore();
    }
  });

  it("password reset requires the administrator's own password and audits failures", async () => {
    const admin = await actorWith({ permissions: ["user.update", "dashboard.view"] });
    const target = await actorWith({ permissions: ["dashboard.view"] });
    await expect(
      resetUserPassword(admin, target.userId, { currentPassword: "Not-My-Passw0rd!" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(resetUserPassword(admin, target.userId, {})).rejects.toMatchObject({ code: "VALIDATION" });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
    expect(row.mustChangePassword).toBe(false); // nothing changed
    const audit = await prisma.auditLog.findFirst({
      where: { action: "REAUTH_FAILED", actorId: admin.userId },
    });
    expect(audit?.severity).toBe("HIGH");
  });
});

describe("user list scoping", () => {
  it("a district-scoped user manager only sees users inside their district", async () => {
    const inD1 = await actorWith({ permissions: ["dashboard.view"], scopeType: "BRANCH", branchId: b1a.id });
    const inD2 = await actorWith({ permissions: ["dashboard.view"], scopeType: "BRANCH", branchId: b2a.id });
    const mgr = await actorWith({ permissions: ["user.view"], scopeType: "DISTRICT", districtId: d1.id });
    const ids = (await listUsers(mgr)).map((u) => u.id);
    expect(ids).toContain(inD1.userId);
    expect(ids).not.toContain(inD2.userId);
  });

  it("never returns password hashes", async () => {
    const mgr = await actorWith({ permissions: ["user.view"] });
    const users = await listUsers(mgr);
    expect(users.length).toBeGreaterThan(0);
    expect(JSON.stringify(users)).not.toContain("passwordHash");
  });
});
