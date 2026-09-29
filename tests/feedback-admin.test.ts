import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { neutralizeFormula, toCsv, toXlsx } from "@/lib/export/tabular";
import { addDays, dayKey, today } from "@/lib/time";
import { parseFilters } from "@/lib/validation/feedback";
import { createQuestion } from "@/server/services/questions";
import {
  activateQuestionnaire,
  createQuestionnaire,
  publishQuestionnaire,
  saveDraft,
  setAssignments,
} from "@/server/services/questionnaires";
import {
  deleteFeedback,
  exportFeedbackTable,
  feedbackFilterOptions,
  getFeedbackDetail,
  listFeedback,
  answerFilterOptions,
} from "@/server/services/feedback-admin";
import {
  forwardFeedback,
  listForwardRecipients,
  listForwardedToMe,
  unreadForwardCount,
} from "@/server/services/forwards";
import { authenticateToken } from "@/server/services/auth";
import { exportReportTable, getOverview, getQuestionReport } from "@/server/services/analytics";
import { actorWith, cleanup, makeBranch, makeDistrict } from "./helpers";

const AUTHOR = [
  "questionnaire.view",
  "questionnaire.create",
  "questionnaire.update",
  "questionnaire.publish",
  "question.view",
  "question.create",
];

let dA: { id: string };
let dB: { id: string };
let bA1: { id: string };
let bA2: { id: string };
let bB1: { id: string };
let qnId: string;
let refs: { rating: string; resolved: string; comment: string };
const ids: Record<string, string> = {};

async function submission(
  branch: { id: string },
  district: { id: string },
  over: {
    rating: number;
    resolved: "yes" | "no";
    comment?: string;
    phone?: string;
    daysAgo?: number;
    key: string;
  },
) {
  const version = await prisma.questionnaireVersion.findFirstOrThrow({ where: { questionnaireId: qnId } });
  const at = new Date(Date.now() - (over.daysAgo ?? 0) * 86_400_000);
  const s = await prisma.feedbackSubmission.create({
    data: {
      questionnaireId: qnId,
      versionId: version.id,
      branchId: branch.id,
      districtId: district.id,
      overallRating: over.rating,
      sentiment: over.rating >= 4 ? "POSITIVE" : over.rating > 2.5 ? "NEUTRAL" : "NEGATIVE",
      wantsFollowUp: !!over.phone,
      contactPhone: over.phone ?? null,
      submittedAt: at,
      answers: {
        create: [
          { questionRef: refs.rating, questionType: "STAR_RATING", valueNumber: over.rating },
          { questionRef: refs.resolved, questionType: "YES_NO", valueOptions: [over.resolved] },
          ...(over.comment
            ? [{ questionRef: refs.comment, questionType: "LONG_TEXT" as const, valueText: over.comment }]
            : []),
        ],
      },
    },
  });
  ids[over.key] = s.id;
  return s;
}

beforeAll(async () => {
  dA = await makeDistrict("FAD-A");
  dB = await makeDistrict("FAD-B");
  bA1 = await makeBranch(dA.id, "FA-A1");
  bA2 = await makeBranch(dA.id, "FA-A2");
  bB1 = await makeBranch(dB.id, "FA-B1");
  const author = await actorWith({ permissions: AUTHOR });
  const q = async (input: Record<string, unknown>) => (await createQuestion(author, input)).id;
  const [rating, resolved, comment] = [
    await q({ type: "STAR_RATING", text: { en: "TQ rate" } }),
    await q({ type: "YES_NO", text: { en: "TQ resolved?" } }),
    await q({ type: "LONG_TEXT", text: { en: "TQ comment" } }),
  ];
  refs = { rating: randomUUID(), resolved: randomUUID(), comment: randomUUID() };
  qnId = (await createQuestionnaire(author, { title: { en: "TQ Admin survey" }, locales: ["en"] })).id;
  await saveDraft(author, qnId, {
    meta: { title: { en: "TQ Admin survey" }, defaultLocale: "en", locales: ["en"], collectContact: true },
    questions: [
      { ref: refs.rating, questionId: rating, isRequired: true, isPrimaryRating: true },
      { ref: refs.resolved, questionId: resolved, isRequired: true },
      { ref: refs.comment, questionId: comment },
    ],
  });
  await publishQuestionnaire(author, qnId);
  await setAssignments(author, qnId, [{ scopeType: "DISTRICT", id: dA.id }]);
  await activateQuestionnaire(author, qnId);

  await submission(bA1, dA, {
    key: "a1-good",
    rating: 5,
    resolved: "yes",
    comment: "Staff were helpful",
    daysAgo: 1,
  });
  await submission(bA1, dA, {
    key: "a1-bad",
    rating: 1,
    resolved: "no",
    comment: '=HYPERLINK("http://evil","x") waited long',
    phone: "+251911111111",
    daysAgo: 2,
  });
  await submission(bA2, dA, { key: "a2-mid", rating: 3, resolved: "yes", daysAgo: 3 });
  await submission(bB1, dB, {
    key: "b1-good",
    rating: 4,
    resolved: "yes",
    comment: "Quick service",
    daysAgo: 1,
  });
  await submission(bB1, dB, { key: "b1-old", rating: 2, resolved: "no", daysAgo: 60 });
});
afterAll(cleanup);

const idsOf = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("list, scope and filters", () => {
  it("bank-wide viewers see everything", async () => {
    const all = await actorWith({ permissions: ["feedback.view"] });
    const { rows, total } = await listFeedback(all, { questionnaireId: qnId });
    expect(total).toBe(5);
    expect(idsOf(rows)).toEqual(expect.arrayContaining(Object.values(ids)));
  });

  it("district and branch managers only see their own locations (filtered in the query)", async () => {
    const dm = await actorWith({ permissions: ["feedback.view"], scopeType: "DISTRICT", districtId: dA.id });
    const got = idsOf((await listFeedback(dm, { questionnaireId: qnId })).rows);
    expect(got.sort()).toEqual([ids["a1-good"], ids["a1-bad"], ids["a2-mid"]].sort());

    const bm = await actorWith({ permissions: ["feedback.view"], scopeType: "BRANCH", branchId: bA1.id });
    expect(idsOf((await listFeedback(bm, { questionnaireId: qnId })).rows).sort()).toEqual(
      [ids["a1-good"], ids["a1-bad"]].sort(),
    );

    const nobody = await actorWith({ permissions: ["dashboard.view"] });
    await expect(listFeedback(nobody, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a user cannot widen their view by passing another location as a filter", async () => {
    const bm = await actorWith({ permissions: ["feedback.view"], scopeType: "BRANCH", branchId: bA1.id });
    expect((await listFeedback(bm, { districtId: dB.id, branchId: bB1.id })).total).toBe(0);
    const opts = await feedbackFilterOptions(bm);
    expect(opts.branches.map((b) => b.id)).toEqual([bA1.id]);
    expect(opts.districts).toEqual([]);
  });

  it("filters by rating, sentiment, date, follow-up, answer and free text", async () => {
    const all = await actorWith({ permissions: ["feedback.view"] });
    const q = (f: Record<string, unknown>) =>
      listFeedback(all, { questionnaireId: qnId, ...f }).then((r) => idsOf(r.rows).sort());
    expect(await q({ maxRating: 2 })).toEqual([ids["a1-bad"], ids["b1-old"]].sort());
    expect(await q({ minRating: 4 })).toEqual([ids["a1-good"], ids["b1-good"]].sort());
    expect(await q({ sentiment: "NEGATIVE" })).toEqual([ids["a1-bad"], ids["b1-old"]].sort());
    expect(await q({ from: addDays(today(), -5) })).toHaveLength(4); // excludes the 60-day-old one
    expect(await q({ to: addDays(today(), -30) })).toEqual([ids["b1-old"]]);
    expect(await q({ followUp: "1" })).toEqual([ids["a1-bad"]]);
    expect(await q({ questionRef: refs.resolved, answer: "no" })).toEqual(
      [ids["a1-bad"], ids["b1-old"]].sort(),
    );
    expect(await q({ q: "helpful" })).toEqual([ids["a1-good"]]);
    expect(await q({ branchId: bA2.id })).toEqual([ids["a2-mid"]]);
  });

  it("paginates and rejects malformed filters instead of erroring", async () => {
    const all = await actorWith({ permissions: ["feedback.view"] });
    const p = await listFeedback(all, { questionnaireId: qnId, page: 1 });
    expect(p.pageSize).toBe(25);
    await expect(listFeedback(all, { districtId: "not-a-uuid" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    // the page-level parser degrades gracefully
    expect(parseFilters({ districtId: "junk", from: "2026-01-05", sentiment: "NEGATIVE" })).toMatchObject({
      from: "2026-01-05",
      sentiment: "NEGATIVE",
    });
    expect(parseFilters({ from: "2026-02-01", to: "2026-01-01" }).from).toBeUndefined(); // inconsistent range dropped
  });

  it("offers answer filters only for questionnaires the actor can see feedback for", async () => {
    const all = await actorWith({ permissions: ["feedback.view"] });
    expect((await answerFilterOptions(all, qnId))[0].options.map((o) => o.value)).toEqual(["yes", "no"]);
    const none = await actorWith({
      permissions: ["feedback.view"],
      scopeType: "BRANCH",
      branchId: (await makeBranch(dA.id, "FA-empty")).id,
    });
    expect(await answerFilterOptions(none, qnId)).toEqual([]);
  });
});

describe("detail (IDOR and personal data)", () => {
  it("renders answers from the version snapshot", async () => {
    const all = await actorWith({ permissions: ["feedback.view"] });
    const d = await getFeedbackDetail(all, ids["a1-good"]);
    expect(d.location).toMatchObject({ branch: "FA-A1", district: "FAD-A" });
    expect(d.answers.map((a) => [a.question, a.answer])).toEqual([
      ["TQ rate", "5 / 5"],
      ["TQ resolved?", "Yes"],
      ["TQ comment", "Staff were helpful"],
    ]);
    expect(d.version).toBe(1);
  });

  it("out-of-scope, unknown and malformed ids are indistinguishable (404)", async () => {
    const bm = await actorWith({ permissions: ["feedback.view"], scopeType: "BRANCH", branchId: bA1.id });
    await expect(getFeedbackDetail(bm, ids["a2-mid"])).rejects.toMatchObject({ code: "NOT_FOUND" }); // sibling branch
    await expect(getFeedbackDetail(bm, ids["b1-good"])).rejects.toMatchObject({ code: "NOT_FOUND" }); // other district
    await expect(getFeedbackDetail(bm, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getFeedbackDetail(bm, "1 OR 1=1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getFeedbackDetail(bm, ids["a1-good"])).resolves.toBeTruthy();
  });

  it("hides the phone number without feedback.view_contact, shows it with it", async () => {
    const plain = await actorWith({ permissions: ["feedback.view"] });
    const d1 = await getFeedbackDetail(plain, ids["a1-bad"]);
    expect(d1.contactPhone).toBeNull();
    expect(d1.contactHidden).toBe(true);
    expect(JSON.stringify(d1)).not.toContain("+251911111111");

    const privileged = await actorWith({ permissions: ["feedback.view", "feedback.view_contact"] });
    expect((await getFeedbackDetail(privileged, ids["a1-bad"])).contactPhone).toBe("+251911111111");

    // contact permission held only over a DIFFERENT branch does not reveal this record's number
    const { authenticateToken } = await import("@/server/services/auth");
    const contactRole = await prisma.role.create({
      data: {
        key: `TR_CON${Date.now()}`,
        name: "contact",
        permissions: { create: [{ permission: { connect: { key: "feedback.view_contact" } } }] },
      },
    });
    const mixed = await actorWith({ permissions: ["feedback.view"] });
    await prisma.userRole.create({
      data: { userId: mixed.userId, roleId: contactRole.id, scopeType: "BRANCH", branchId: bA2.id },
    });
    expect(
      (await getFeedbackDetail((await authenticateToken(mixed.token))!, ids["a1-bad"])).contactPhone,
    ).toBeNull();
    // ...but over the right branch it does
    await prisma.userRole.create({
      data: { userId: mixed.userId, roleId: contactRole.id, scopeType: "BRANCH", branchId: bA1.id },
    });
    expect(
      (await getFeedbackDetail((await authenticateToken(mixed.token))!, ids["a1-bad"])).contactPhone,
    ).toBe("+251911111111");
  });

  it("soft-deleting needs feedback.delete over the record's scope, removes it from lists and is audited", async () => {
    const victim = await submission(bA2, dA, { key: "victim", rating: 4, resolved: "yes" });
    const viewer = await actorWith({ permissions: ["feedback.view"] });
    await expect(deleteFeedback(viewer, victim.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const wrongScope = await actorWith({
      permissions: ["feedback.view", "feedback.delete"],
      scopeType: "BRANCH",
      branchId: bA1.id,
    });
    await expect(deleteFeedback(wrongScope, victim.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const admin = await actorWith({ permissions: ["feedback.view", "feedback.delete"] });
    await deleteFeedback(admin, victim.id);
    await expect(getFeedbackDetail(admin, victim.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (await prisma.auditLog.findFirst({ where: { action: "FEEDBACK_DELETED", resourceId: victim.id } }))
        ?.actorId,
    ).toBe(admin.userId);
  });
});

describe("export", () => {
  it("neutralizes spreadsheet formulas and quotes correctly", () => {
    expect(neutralizeFormula("=SUM(A1)")).toBe("'=SUM(A1)");
    for (const bad of ["+1", "-1", "@cmd", "\tx"]) expect(neutralizeFormula(bad).startsWith("'")).toBe(true);
    expect(neutralizeFormula("normal")).toBe("normal");
    const csv = toCsv({
      name: "t",
      columns: ["a", "b"],
      rows: [
        ["=evil", 'he said "hi", ok'],
        [null, 5],
      ],
    });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("'=evil");
    expect(csv).toContain('"he said ""hi"", ok"');
  });

  it("produces a real .xlsx", async () => {
    const buf = await toXlsx({
      name: "Feedback",
      columns: ["x", "y"],
      rows: [
        ["=1+1", 4.5],
        [new Date(), null],
      ],
    });
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    expect(buf.length).toBeGreaterThan(500);
  });

  it("requires feedback.export, is limited to the actor's scope and is audited", async () => {
    const noExport = await actorWith({ permissions: ["feedback.view"] });
    await expect(exportFeedbackTable(noExport, {}, "csv")).rejects.toMatchObject({ code: "FORBIDDEN" });

    const dm = await actorWith({
      permissions: ["feedback.view", "feedback.export"],
      scopeType: "DISTRICT",
      districtId: dA.id,
    });
    const t = await exportFeedbackTable(dm, { questionnaireId: qnId }, "csv");
    expect(t.rows).toHaveLength(3);
    expect(t.columns).not.toContain("Phone"); // no view_contact → no phone column
    const csv = toCsv(t);
    expect(csv).toContain("'=HYPERLINK"); // customer text cannot become a live formula
    expect(csv).not.toContain("+251911111111");
    expect(csv).not.toMatch(/Quick service/); // other district's comment
    const log = await prisma.auditLog.findFirst({
      where: { action: "FEEDBACK_EXPORTED", actorId: dm.userId },
    });
    expect((log?.metadata as { rows: number }).rows).toBe(3);
  });

  it("cannot export more than can be viewed: export scope wider than view scope is intersected", async () => {
    const odd = await actorWith({ permissions: ["feedback.view"], scopeType: "BRANCH", branchId: bA1.id });
    // grant a bank-wide export via a second role
    const exportRole = await prisma.role.create({
      data: {
        key: `TR_EXP${Date.now()}`,
        name: "exp",
        permissions: { create: [{ permission: { connect: { key: "feedback.export" } } }] },
      },
    });
    await prisma.userRole.create({ data: { userId: odd.userId, roleId: exportRole.id, scopeType: "ALL" } });
    const { authenticateToken } = await import("@/server/services/auth");
    const ctx = (await authenticateToken(odd.token))!;
    const t = await exportFeedbackTable(ctx, { questionnaireId: qnId }, "csv");
    expect(t.rows).toHaveLength(2); // only branch A1, not the whole bank
  });

  it("includes the phone column only for users allowed to see contact details", async () => {
    const hq = await actorWith({
      permissions: ["feedback.view", "feedback.export", "feedback.view_contact"],
    });
    const t = await exportFeedbackTable(hq, { questionnaireId: qnId }, "xlsx");
    expect(t.columns).toContain("Phone");
    expect(t.rows.flat()).toContain("+251911111111");
  });
});

describe("forwarding", () => {
  const VIEW = ["feedback.view"];
  const FWD = ["feedback.view", "feedback.forward"];

  it("shares one record with a colleague outside its scope, without exposing the phone number", async () => {
    const sender = await actorWith({ permissions: FWD, scopeType: "BRANCH", branchId: bA1.id });
    const recipient = await actorWith({
      permissions: [...VIEW, "feedback.view_contact"],
      scopeType: "BRANCH",
      branchId: bB1.id,
    });

    // before forwarding the recipient cannot see it (different district)
    await expect(getFeedbackDetail(recipient, ids["a1-bad"])).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await unreadForwardCount(recipient)).toBe(0);

    await forwardFeedback(sender, ids["a1-bad"], {
      toUserId: recipient.userId,
      note: "Please look at this one",
    });
    expect(await unreadForwardCount(recipient)).toBe(1);

    const d = await getFeedbackDetail(recipient, ids["a1-bad"]);
    expect(d.forwardedToMe).toMatchObject({ note: "Please look at this one" });
    expect(d.contactPhone).toBeNull(); // view_contact is held over branch B1, not A1
    expect(d.contactHidden).toBe(true);
    expect(d.canForward).toBe(false); // cannot pass it on outside their own scope
    expect(d.forwards).toEqual([]);
    expect(await unreadForwardCount(recipient)).toBe(0); // opening marks it read

    // only that one record is shared
    await expect(getFeedbackDetail(recipient, ids["a1-good"])).rejects.toMatchObject({ code: "NOT_FOUND" });
    const inbox = await listForwardedToMe(recipient);
    expect(inbox.map((r) => r.feedbackId)).toEqual([ids["a1-bad"]]);
    expect(inbox[0]).toMatchObject({ note: "Please look at this one", read: true });

    // the recipient is notified in-app
    const n = await prisma.notification.findFirst({
      where: { userId: recipient.userId, type: "FEEDBACK_FORWARDED" },
    });
    expect(n?.title).toContain("forwarded feedback from FA-A1");
  });

  it("shows the sender where a record has been forwarded", async () => {
    const sender = await actorWith({ permissions: FWD, scopeType: "DISTRICT", districtId: dA.id });
    const colleague = await actorWith({ permissions: VIEW, scopeType: "BRANCH", branchId: bA2.id });
    await forwardFeedback(sender, ids["a1-good"], { toUserId: colleague.userId });
    const d = await getFeedbackDetail(sender, ids["a1-good"]);
    expect(d.canForward).toBe(true);
    expect(d.forwards).toHaveLength(1);
    expect(d.forwards[0]).toMatchObject({ read: false, note: null });
    // the colleague, without forward permission, sees no forwarding history
    expect((await getFeedbackDetail(colleague, ids["a1-good"])).forwards).toEqual([]);
  });

  it("forwarding again to the same person refreshes it instead of duplicating", async () => {
    const sender = await actorWith({ permissions: FWD });
    const to = await actorWith({ permissions: VIEW, scopeType: "BRANCH", branchId: bB1.id });
    await forwardFeedback(sender, ids["a2-mid"], { toUserId: to.userId, note: "first" });
    await getFeedbackDetail(to, ids["a2-mid"]); // read
    await forwardFeedback(sender, ids["a2-mid"], { toUserId: to.userId, note: "second" });
    expect(
      await prisma.feedbackForward.count({ where: { feedbackId: ids["a2-mid"], toUserId: to.userId } }),
    ).toBe(1);
    expect(await unreadForwardCount(to)).toBe(1);
    expect((await listForwardedToMe(to)).find((r) => r.feedbackId === ids["a2-mid"])).toMatchObject({
      note: "second",
      read: false,
    });
  });

  it("requires feedback.forward and access to the record", async () => {
    const to = await actorWith({ permissions: VIEW });
    const noForward = await actorWith({ permissions: VIEW });
    await expect(forwardFeedback(noForward, ids["a1-good"], { toUserId: to.userId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(listForwardRecipients(noForward)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // out-of-scope sender: the record does not exist for them (404, not 403)
    const foreign = await actorWith({ permissions: FWD, scopeType: "BRANCH", branchId: bB1.id });
    await expect(forwardFeedback(foreign, ids["a1-good"], { toUserId: to.userId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // forward scope narrower than view scope: BOTH must cover the record
    const mixed = await actorWith({ permissions: VIEW });
    const narrowRole = await prisma.role.create({
      data: {
        key: `TR_FW${Date.now()}`,
        name: "fw",
        permissions: { create: [{ permission: { connect: { key: "feedback.forward" } } }] },
      },
    });
    await prisma.userRole.create({
      data: { userId: mixed.userId, roleId: narrowRole.id, scopeType: "BRANCH", branchId: bB1.id },
    });
    const mixedCtx = (await authenticateToken(mixed.token))!;
    await expect(forwardFeedback(mixedCtx, ids["a1-good"], { toUserId: to.userId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("only allows valid recipients: active colleagues who already hold feedback.view", async () => {
    const sender = await actorWith({ permissions: FWD });
    const noAccess = await actorWith({ permissions: ["dashboard.view"] });
    const inactive = await actorWith({ permissions: VIEW });
    await prisma.user.update({ where: { id: inactive.userId }, data: { status: "INACTIVE" } });
    const ok = await actorWith({ permissions: VIEW });

    const options = (await listForwardRecipients(sender)).map((u) => u.id);
    expect(options).toContain(ok.userId);
    expect(options).not.toContain(noAccess.userId);
    expect(options).not.toContain(inactive.userId);
    expect(options).not.toContain(sender.userId);

    for (const bad of [noAccess.userId, inactive.userId, sender.userId]) {
      await expect(forwardFeedback(sender, ids["a1-good"], { toUserId: bad })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    await expect(forwardFeedback(sender, ids["a1-good"], { toUserId: "nope" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      forwardFeedback(sender, ids["a1-good"], { toUserId: ok.userId, note: "x".repeat(501) }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(forwardFeedback(sender, "not-a-uuid", { toUserId: ok.userId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("is audited without storing the note text, and deleted feedback leaves the inbox", async () => {
    const sender = await actorWith({ permissions: [...FWD, "feedback.delete"] });
    const to = await actorWith({ permissions: VIEW, scopeType: "BRANCH", branchId: bB1.id });
    const rec = await submission(bA2, dA, { key: "to-delete", rating: 3, resolved: "yes" });
    await forwardFeedback(sender, rec.id, { toUserId: to.userId, note: "secret note text" });
    const log = await prisma.auditLog.findFirst({
      where: { action: "FEEDBACK_FORWARDED", actorId: sender.userId },
    });
    expect(log?.metadata).toMatchObject({ toUserId: to.userId, hasNote: true });
    expect(JSON.stringify(log)).not.toContain("secret note text");

    expect((await listForwardedToMe(to)).map((r) => r.feedbackId)).toContain(rec.id);
    await deleteFeedback(sender, rec.id);
    expect((await listForwardedToMe(to)).map((r) => r.feedbackId)).not.toContain(rec.id);
    await expect(getFeedbackDetail(to, rec.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("analytics", () => {
  const range = { from: dayKey(new Date(Date.now() - 90 * 86_400_000)), to: today() };

  it("computes totals, distribution, trend and location breakdowns", async () => {
    const all = await actorWith({ permissions: ["dashboard.view", "feedback.view"] });
    const o = await getOverview(all, { ...range, questionnaireId: qnId });
    expect(o.totals.feedback).toBe(5);
    expect(o.totals.averageRating).toBeCloseTo((5 + 1 + 3 + 4 + 2) / 5);
    expect(o.totals.followUps).toBe(1);
    expect(o.sentiment).toMatchObject({ POSITIVE: 2, NEUTRAL: 1, NEGATIVE: 2 });
    expect(o.ratingDistribution.map((r) => r.count)).toEqual([1, 1, 1, 1, 1]);
    expect(o.trend.reduce((s, d) => s + d.count, 0)).toBe(5);
    expect(o.trend.length).toBe(91);
    expect(o.byDistrict.map((d) => [d.name, d.count])).toEqual(
      expect.arrayContaining([
        ["FAD-A", 3],
        ["FAD-B", 2],
      ]),
    );
    expect(o.byBranch.find((b) => b.name === "FA-A1")?.count).toBe(2);
  });

  it("defaults to the last 30 days", async () => {
    const all = await actorWith({ permissions: ["dashboard.view", "feedback.view"] });
    const o = await getOverview(all, { questionnaireId: qnId });
    expect(o.trend).toHaveLength(30);
    expect(o.totals.feedback).toBe(4); // the 60-day-old one is outside
  });

  it("only aggregates what the actor's scope allows", async () => {
    const bm = await actorWith({
      permissions: ["dashboard.view", "feedback.view"],
      scopeType: "BRANCH",
      branchId: bA1.id,
    });
    const o = await getOverview(bm, { ...range, questionnaireId: qnId });
    expect(o.totals.feedback).toBe(2);
    expect(o.byDistrict.map((d) => d.name)).toEqual(["FAD-A"]);
    expect(o.byBranch.map((b) => b.name)).toEqual(["FA-A1"]);
    expect(JSON.stringify(o)).not.toContain("FAD-B");
  });

  it("shows no feedback figures to a dashboard viewer without feedback.view", async () => {
    const dashOnly = await actorWith({ permissions: ["dashboard.view"] });
    const o = await getOverview(dashOnly, { ...range, questionnaireId: qnId });
    expect(o.totals.feedback).toBe(0);
    await expect(getOverview(await actorWith({ permissions: ["feedback.view"] }), {})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("builds question-level statistics", async () => {
    const analyst = await actorWith({ permissions: ["reports.view", "feedback.view"] });
    const r = (await getQuestionReport(analyst, { ...range, questionnaireId: qnId }))!;
    expect(r.total).toBe(5);
    const yn = r.questions.find((q) => q.type === "YES_NO")!;
    expect(yn.distribution).toEqual([
      { label: "Yes", count: 3 },
      { label: "No", count: 2 },
    ]);
    const stars = r.questions.find((q) => q.type === "STAR_RATING")!;
    expect(stars.average).toBeCloseTo(3);
    expect(stars.distribution?.map((d) => d.count)).toEqual([1, 1, 1, 1, 1]);
    expect(await getQuestionReport(analyst, range)).toBeNull(); // needs a questionnaire
    await expect(
      getQuestionReport(await actorWith({ permissions: ["feedback.view"] }), { questionnaireId: qnId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("report export needs reports.export and respects scope", async () => {
    const viewOnly = await actorWith({ permissions: ["reports.view", "feedback.view"] });
    await expect(exportReportTable(viewOnly, range, "csv")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const dm = await actorWith({
      permissions: ["reports.view", "reports.export", "feedback.view"],
      scopeType: "DISTRICT",
      districtId: dB.id,
    });
    const t = await exportReportTable(dm, { ...range, questionnaireId: qnId }, "csv");
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].slice(2, 5)).toEqual(["FAD-B", "FA-B1", 2]);
    expect(toCsv(t)).not.toContain("FAD-A");
  });
});
