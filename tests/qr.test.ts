import { randomUUID } from "node:crypto";
import jsQR from "jsqr";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { generatePublicCode, PUBLIC_CODE_PATTERN, publicUrl, qrPng, qrSvg } from "@/lib/qr/generate";
import { createQuestion } from "@/server/services/questions";
import {
  activateQuestionnaire,
  createQuestionnaire,
  pauseQuestionnaire,
  publishQuestionnaire,
  saveDraft,
  setAssignments,
} from "@/server/services/questionnaires";
import {
  createQRCode,
  deleteQRCode,
  getQrForDownload,
  listQRCodes,
  recordScan,
  regenerateQRCode,
  resolvePublicCode,
  updateQRCode,
} from "@/server/services/qr";
import { actorWith, cleanup, makeBranch, makeDistrict, randomIp } from "./helpers";

const ALL = ["qr.view", "qr.create", "qr.update", "qr.delete"];
const AUTHOR = [
  "questionnaire.view",
  "questionnaire.create",
  "questionnaire.update",
  "questionnaire.publish",
  "question.view",
  "question.create",
];

let d1: { id: string };
let d2: { id: string };
let b1: { id: string };
let b2: { id: string };
let admin: Awaited<ReturnType<typeof actorWith>>;
let author: Awaited<ReturnType<typeof actorWith>>;

beforeAll(async () => {
  d1 = await makeDistrict("QRD1");
  d2 = await makeDistrict("QRD2");
  b1 = await makeBranch(d1.id, "QRB1");
  b2 = await makeBranch(d2.id, "QRB2");
  admin = await actorWith({ permissions: ALL });
  author = await actorWith({ permissions: AUTHOR });
});
afterAll(cleanup);

const mk = (scopeType: "DISTRICT" | "BRANCH" | "DEPARTMENT", locationId: string, label = "TQ QR") =>
  createQRCode(admin, { label, scopeType, locationId });

/** Publishes and activates a one-question questionnaire at the given location. */
async function activeAt(target: { scopeType: "DISTRICT" | "BRANCH" | "ALL"; id?: string }) {
  const { id } = await createQuestionnaire(author, { title: { en: "TQ Survey" }, locales: ["en"] });
  const q = (await createQuestion(author, { type: "STAR_RATING", text: { en: "TQ rate us" } })).id;
  await saveDraft(author, id, {
    meta: { title: { en: "TQ Survey" }, defaultLocale: "en", locales: ["en"], collectContact: false },
    questions: [{ ref: randomUUID(), questionId: q, isRequired: true, isPrimaryRating: true }],
  });
  await publishQuestionnaire(author, id);
  await setAssignments(author, id, [target]);
  await activateQuestionnaire(author, id);
  return id;
}

describe("public codes", () => {
  it("are 8 unambiguous characters, random and unique", () => {
    const codes = new Set(Array.from({ length: 2000 }, generatePublicCode));
    expect(codes.size).toBe(2000);
    for (const c of codes) expect(c).toMatch(PUBLIC_CODE_PATTERN);
    expect([...codes].join("")).not.toMatch(/[01OIL]/);
  });

  it("do not leak database ids or follow a sequence", async () => {
    const a = await mk("BRANCH", b1.id);
    const b = await mk("BRANCH", b1.id);
    expect(a.publicCode).not.toContain(a.id);
    expect(a.publicCode).not.toBe(b.publicCode);
    expect(publicUrl(a.publicCode)).toMatch(/\/f\/[A-Z0-9]{8}$/);
  });
});

describe("QR images", () => {
  it("renders valid SVG and PNG for the public URL", async () => {
    const svg = await qrSvg("ABCD2345");
    expect(svg).toContain("<svg");
    const png = await qrPng("ABCD2345", 256);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a"); // PNG signature
  });

  it("embeds the centre logo and still decodes to the public URL", async () => {
    const decode = async (image: Buffer) => {
      const { data, info } = await sharp(image).flatten({ background: "#ffffff" }).ensureAlpha().raw().toBuffer({
        resolveWithObject: true,
      });
      return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
    };
    const svg = await qrSvg("ABCD2345");
    expect(svg).toContain("<image href=\"data:image/png;base64,");
    for (const width of [256, 1024]) expect(await decode(await qrPng("ABCD2345", width))).toBe(publicUrl("ABCD2345"));
    expect(await decode(await sharp(Buffer.from(svg), { density: 300 }).png().toBuffer())).toBe(
      publicUrl("ABCD2345"),
    );
  });
});

describe("create / update / delete", () => {
  it("creates QR codes for a district, a branch and a department", async () => {
    const dept = await prisma.department.create({
      data: { code: `TDEP${Date.now()}`, name: "QR Dept", districtId: null },
    });
    for (const [type, id] of [
      ["DISTRICT", d1.id],
      ["BRANCH", b1.id],
      ["DEPARTMENT", dept.id],
    ] as const) {
      const r = await mk(type, id);
      const row = await prisma.qRCode.findUniqueOrThrow({ where: { id: r.id } });
      const set = [row.districtId, row.branchId, row.departmentId].filter(Boolean);
      expect(set).toEqual([id]); // exactly one location
    }
  });

  it("the database refuses a QR with zero or two locations", async () => {
    const base = { publicCode: generatePublicCode(), label: "TQ bad" };
    await expect(prisma.qRCode.create({ data: base })).rejects.toBeTruthy();
    await expect(
      prisma.qRCode.create({ data: { ...base, districtId: d1.id, branchId: b1.id } }),
    ).rejects.toBeTruthy();
  });

  it("validates input and unknown locations", async () => {
    await expect(
      createQRCode(admin, { label: "x", scopeType: "BRANCH", locationId: "nope" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      createQRCode(admin, { label: "TQ ok", scopeType: "BRANCH", locationId: randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses inactive locations", async () => {
    const off = await prisma.branch.create({
      data: { code: `TB${Date.now()}`, name: "Off", districtId: d1.id, isActive: false },
    });
    await expect(mk("BRANCH", off.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("deactivates, reactivates and audits", async () => {
    const { id } = await mk("BRANCH", b1.id);
    await updateQRCode(admin, id, { label: "TQ renamed", isActive: false });
    expect((await prisma.qRCode.findUniqueOrThrow({ where: { id } })).isActive).toBe(false);
    await updateQRCode(admin, id, { label: "TQ renamed", isActive: true });
    const actions = (await prisma.auditLog.findMany({ where: { resourceId: id } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["QR_CREATED", "QR_DEACTIVATED", "QR_UPDATED"]));
  });

  it("regenerating kills the old code and keeps the record", async () => {
    const { id, publicCode } = await mk("BRANCH", b1.id);
    const fresh = await regenerateQRCode(admin, id);
    expect(fresh.publicCode).not.toBe(publicCode);
    expect((await resolvePublicCode(publicCode)).status).toBe("NOT_FOUND");
    expect((await resolvePublicCode(fresh.publicCode)).status).not.toBe("NOT_FOUND");
  });

  it("deleting makes the code unresolvable", async () => {
    const { id, publicCode } = await mk("BRANCH", b1.id);
    await deleteQRCode(admin, id);
    expect((await resolvePublicCode(publicCode)).status).toBe("NOT_FOUND");
    await expect(deleteQRCode(admin, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("authorization and scope", () => {
  it("denies actors without the permission", async () => {
    const viewer = await actorWith({ permissions: ["qr.view"] });
    const { id } = await mk("BRANCH", b1.id);
    await expect(
      createQRCode(viewer, { label: "TQ x", scopeType: "BRANCH", locationId: b1.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateQRCode(viewer, id, { label: "TQ y", isActive: false })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(regenerateQRCode(viewer, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteQRCode(viewer, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const nobody = await actorWith({ permissions: ["dashboard.view"] });
    await expect(listQRCodes(nobody)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a district manager sees QR codes of their district's branches, but not another district's", async () => {
    const mine = await mk("BRANCH", b1.id, "TQ mine");
    const theirs = await mk("BRANCH", b2.id, "TQ theirs");
    const dm = await actorWith({
      permissions: ["qr.view", "qr.create", "qr.update"],
      scopeType: "DISTRICT",
      districtId: d1.id,
    });
    const ids = (await listQRCodes(dm)).map((q) => q.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });

  it("a branch manager sees only their branch and cannot act on a sibling or foreign QR (IDOR)", async () => {
    const sibling = await makeBranch(d1.id, "QR sibling");
    const own = await mk("BRANCH", b1.id, "TQ own");
    const other = await mk("BRANCH", sibling.id, "TQ sibling");
    const bm = await actorWith({
      permissions: ["qr.view", "qr.update", "qr.delete"],
      scopeType: "BRANCH",
      branchId: b1.id,
    });
    const ids = (await listQRCodes(bm)).map((q) => q.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(other.id);
    await expect(getQrForDownload(bm, other.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateQRCode(bm, other.id, { label: "TQ hax", isActive: false })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(regenerateQRCode(bm, other.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteQRCode(bm, other.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getQrForDownload(bm, own.id)).resolves.toMatchObject({ id: own.id });
  });

  it("cannot create a QR outside one's scope", async () => {
    const dm = await actorWith({ permissions: ["qr.create"], scopeType: "DISTRICT", districtId: d1.id });
    await expect(
      createQRCode(dm, { label: "TQ no", scopeType: "BRANCH", locationId: b2.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createQRCode(dm, { label: "TQ no", scopeType: "DISTRICT", locationId: d2.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createQRCode(dm, { label: "TQ yes", scopeType: "BRANCH", locationId: b1.id }),
    ).resolves.toBeTruthy();
  });

  it("tolerates malformed ids without a server error", async () => {
    await expect(getQrForDownload(admin, "not-a-uuid")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("resolving a public code (QR → location → active questionnaire)", () => {
  it("rejects junk without touching the database shape", async () => {
    for (const bad of ["", "abc", "12", "ZZZZZZZZ".toLowerCase(), "'; DROP TABLE", "0OIL0OIL"]) {
      expect((await resolvePublicCode(bad)).status).toBe("NOT_FOUND");
    }
    expect((await resolvePublicCode("ZZZZZZZZ")).status).toBe("NOT_FOUND"); // well-formed but unknown
  });

  it("reports each failure reason distinctly", async () => {
    const { id, publicCode } = await mk("BRANCH", b1.id);
    // no questionnaire anywhere yet for this branch's district scope → nothing active
    expect((await resolvePublicCode(publicCode)).status).toBe("NO_ACTIVE_QUESTIONNAIRE");

    await updateQRCode(admin, id, { label: "TQ QR", isActive: false });
    expect((await resolvePublicCode(publicCode)).status).toBe("QR_INACTIVE");
    await updateQRCode(admin, id, { label: "TQ QR", isActive: true });

    await prisma.branch.update({ where: { id: b1.id }, data: { isActive: false } });
    expect((await resolvePublicCode(publicCode)).status).toBe("LOCATION_INACTIVE");
    await prisma.branch.update({ where: { id: b1.id }, data: { isActive: true } });
    await prisma.district.update({ where: { id: d1.id }, data: { isActive: false } });
    expect((await resolvePublicCode(publicCode)).status).toBe("LOCATION_INACTIVE"); // parent inactive
    await prisma.district.update({ where: { id: d1.id }, data: { isActive: true } });
  });

  it("serves whatever questionnaire is currently ACTIVE, so QR codes never need reprinting", async () => {
    const { publicCode } = await mk("BRANCH", b1.id);
    const first = await activeAt({ scopeType: "DISTRICT", id: d1.id });
    let res = await resolvePublicCode(publicCode);
    expect(res.status === "OK" && res.questionnaire.questionnaireId).toBe(first);
    expect(res.status === "OK" && res.branchId).toBe(b1.id);
    expect(res.status === "OK" && res.districtId).toBe(d1.id); // branch's district is filled in

    // swap in a branch-specific questionnaire: same QR, different form
    const second = await activeAt({ scopeType: "BRANCH", id: b1.id });
    res = await resolvePublicCode(publicCode);
    expect(res.status === "OK" && res.questionnaire.questionnaireId).toBe(second);

    // pausing both leaves nothing to show
    await pauseQuestionnaire(author, second);
    await pauseQuestionnaire(author, first);
    expect((await resolvePublicCode(publicCode)).status).toBe("NO_ACTIVE_QUESTIONNAIRE");
  });
});

describe("analytics", () => {
  it("counts scans (de-duplicated per source), feedback and completion without claiming unique customers", async () => {
    const { id } = await mk("BRANCH", b1.id, "TQ stats");
    const ip = randomIp();
    expect(await recordScan(id, ip)).toBe(true);
    expect(await recordScan(id, ip)).toBe(false); // refresh from same source within 5 min
    expect(await recordScan(id, randomIp())).toBe(true);
    expect(await recordScan(id, randomIp())).toBe(true);

    let row = (await listQRCodes(admin)).find((q) => q.id === id)!;
    expect(row.scanCount).toBe(3);
    expect(row.feedbackCount).toBe(0);
    expect(row.completionRate).toBe(0);

    const qnId = await activeAt({ scopeType: "BRANCH", id: b1.id });
    const version = await prisma.questionnaireVersion.findFirstOrThrow({ where: { questionnaireId: qnId } });
    await prisma.feedbackSubmission.createMany({
      data: [4, 5].map((r) => ({
        questionnaireId: qnId,
        versionId: version.id,
        qrCodeId: id,
        branchId: b1.id,
        districtId: d1.id,
        overallRating: r,
      })),
    });
    row = (await listQRCodes(admin)).find((q) => q.id === id)!;
    expect(row.feedbackCount).toBe(2);
    expect(row.completionRate).toBeCloseTo(2 / 3);
    expect(row.averageRating).toBeCloseTo(4.5);
    expect(row.questionnaire).toBe("TQ Survey");

    await prisma.feedbackSubmission.deleteMany({ where: { questionnaireId: qnId } });
    await pauseQuestionnaire(author, qnId);
  });

  it("completion never exceeds 100% even if scans were under-counted", async () => {
    const { id } = await mk("BRANCH", b1.id, "TQ over");
    await recordScan(id, randomIp());
    const qnId = await activeAt({ scopeType: "BRANCH", id: b1.id });
    const version = await prisma.questionnaireVersion.findFirstOrThrow({ where: { questionnaireId: qnId } });
    await prisma.feedbackSubmission.createMany({
      data: [1, 2, 3].map(() => ({
        questionnaireId: qnId,
        versionId: version.id,
        qrCodeId: id,
        branchId: b1.id,
      })),
    });
    const row = (await listQRCodes(admin)).find((q) => q.id === id)!;
    expect(row.completionRate).toBe(1);
    await prisma.feedbackSubmission.deleteMany({ where: { questionnaireId: qnId } });
    await pauseQuestionnaire(author, qnId);
  });
});
