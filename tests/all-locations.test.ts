import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createQRCode, resolvePublicCode } from "@/server/services/qr";
import { createQuestionnaire, setAssignments } from "@/server/services/questionnaires";
import { createUser } from "@/server/services/users";
import { actorWith, cleanup, makeBranch, makeDistrict, makeRole, uid } from "./helpers";

// A district-scoped administrator's "All" must stay inside their district.
let d1: { id: string };
let d2: { id: string };
let b1: { id: string };
let b2: { id: string };
let b3: { id: string };
let district: Awaited<ReturnType<typeof actorWith>>;
let bank: Awaited<ReturnType<typeof actorWith>>;

beforeAll(async () => {
  d1 = await makeDistrict();
  d2 = await makeDistrict();
  b1 = await makeBranch(d1.id, "AllTest One");
  b2 = await makeBranch(d1.id, "AllTest Two");
  b3 = await makeBranch(d2.id, "AllTest Three");
  const perms = ["qr.create", "questionnaire.create", "questionnaire.update", "questionnaire.publish"];
  district = await actorWith({ permissions: perms, scopeType: "DISTRICT", districtId: d1.id });
  bank = await actorWith({ permissions: [...perms, "user.create"] });
});
afterAll(cleanup);

describe("All branches / districts / departments", () => {
  it("creates ONE shared QR code for all branches, only for bank-wide staff", async () => {
    const before = await prisma.qRCode.count({ where: { deletedAt: null } });
    const res = await createQRCode(bank, { label: "TQ Shared", scopeType: "BRANCH", locationId: "all" });
    expect(await prisma.qRCode.count({ where: { deletedAt: null } })).toBe(before + 1);
    const row = await prisma.qRCode.findUniqueOrThrow({ where: { id: res.id } });
    expect(row).toMatchObject({ allOf: "BRANCH", branchId: null, districtId: null, departmentId: null });
    await expect(
      createQRCode(district, { label: "TQ Nope", scopeType: "BRANCH", locationId: "all" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // scanning goes straight to the form; nothing asks for a location
    expect((await resolvePublicCode(res.publicCode)).status).not.toBe("LOCATION_REQUIRED");
  });

  it("assigns a questionnaire to every branch in scope, never outside it", async () => {
    const { id } = await createQuestionnaire(district, { title: { en: uid("TQ") }, locales: ["en"] });
    await setAssignments(district, id, [{ scopeType: "BRANCH", id: "all" }]);
    const rows = await prisma.questionnaireAssignment.findMany({ where: { questionnaireId: id } });
    expect(rows.map((r) => r.branchId).sort()).toEqual([b1.id, b2.id].sort());
  });

  it("expands All districts for a bank-wide actor and dedupes explicit entries", async () => {
    const { id } = await createQuestionnaire(bank, { title: { en: uid("TQ") }, locales: ["en"] });
    await setAssignments(bank, id, [
      { scopeType: "DISTRICT", id: d1.id },
      { scopeType: "DISTRICT", id: "all" },
    ]);
    const rows = await prisma.questionnaireAssignment.findMany({
      where: { questionnaireId: id, districtId: { not: null } },
    });
    const ids = rows.map((r) => r.districtId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([d1.id, d2.id]));
  });

  it("grants a role over every branch in scope, and rejects 'all' for the wrong scope field", async () => {
    const role = await makeRole(["qr.view"]);
    const res = await createUser(bank, {
      email: `${uid("u").toLowerCase()}@test.local`,
      name: "All Branch User",
      password: "Test-Passw0rd-123!x",
      assignments: [{ roleId: role.id, scopeType: "BRANCH", branchId: "all" }],
    });
    const rows = await prisma.userRole.findMany({ where: { userId: res.id } });
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every((r) => r.scopeType === "BRANCH" && r.branchId && r.branchId !== "all")).toBe(true);
    expect(rows.map((r) => r.branchId)).toEqual(expect.arrayContaining([b1.id, b2.id, b3.id]));
    await expect(
      createUser(bank, {
        email: `${uid("u").toLowerCase()}@test.local`,
        name: "Bad",
        password: "Test-Passw0rd-123!x",
        assignments: [{ roleId: role.id, scopeType: "BRANCH", districtId: "all" }],
      }),
    ).rejects.toThrow();
  });
});
