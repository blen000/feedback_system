import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// the public action reads request headers, which only exist inside Next.js
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "10.77.77.77", "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined }),
}));

import { prisma } from "@/lib/db/prisma";
import { createQuestion } from "@/server/services/questions";
import {
  activateQuestionnaire,
  createQuestionnaire,
  pauseQuestionnaire,
  publishQuestionnaire,
  reopenQuestionnaire,
  saveDraft,
  setAssignments,
} from "@/server/services/questionnaires";
import { createQRCode, updateQRCode } from "@/server/services/qr";
import { submitFeedback } from "@/server/services/feedback";
import { submitFeedbackAction } from "@/server/actions/public";
import { actorWith, cleanup, makeBranch, makeDistrict, randomIp } from "./helpers";

const AUTHOR = [
  "questionnaire.view",
  "questionnaire.create",
  "questionnaire.update",
  "questionnaire.publish",
  "question.view",
  "question.create",
  "qr.view",
  "qr.create",
  "qr.update",
];

let d1: { id: string };
let b1: { id: string };
let b2: { id: string };
let author: Awaited<ReturnType<typeof actorWith>>;
let qn: {
  id: string;
  refs: Record<"rating" | "resolved" | "problem" | "comment", string>;
  options: string[];
};
let code: string;
let qrId: string;

/** rating* (overall), resolved*, problem (only if resolved = no, options), comment (long text) */
async function buildQuestionnaire(collectContact = true) {
  const mk = async (input: Record<string, unknown>) => (await createQuestion(author, input)).id;
  const rating = await mk({ type: "STAR_RATING", text: { en: "TQ rate" }, config: { scale: 5 } });
  const resolved = await mk({ type: "YES_NO", text: { en: "TQ resolved?" } });
  const problem = await mk({
    type: "SINGLE_CHOICE",
    text: { en: "TQ problem?" },
    options: [{ label: { en: "Wait" } }, { label: { en: "Staff" } }],
  });
  const comment = await mk({ type: "LONG_TEXT", text: { en: "TQ comment" } });
  const refs = { rating: randomUUID(), resolved: randomUUID(), problem: randomUUID(), comment: randomUUID() };
  const { id } = await createQuestionnaire(author, { title: { en: "TQ Feedback survey" }, locales: ["en"] });
  await saveDraft(author, id, {
    meta: { title: { en: "TQ Feedback survey" }, defaultLocale: "en", locales: ["en"], collectContact },
    questions: [
      { ref: refs.rating, questionId: rating, isRequired: true, isPrimaryRating: true },
      { ref: refs.resolved, questionId: resolved, isRequired: true },
      {
        ref: refs.problem,
        questionId: problem,
        isRequired: true,
        visibility: {
          match: "all",
          rules: [{ questionRef: refs.resolved, operator: "equals", value: "no" }],
        },
      },
      { ref: refs.comment, questionId: comment },
    ],
  });
  await publishQuestionnaire(author, id);
  const options = (
    await prisma.questionOption.findMany({ where: { questionId: problem }, orderBy: { sortOrder: "asc" } })
  ).map((o) => o.value);
  return { id, refs, options };
}

const submit = (answers: Record<string, unknown>, extra: Record<string, unknown> = {}, ip = randomIp()) =>
  submitFeedback(code, { answers, ...extra }, { ip });

beforeAll(async () => {
  const d = await makeDistrict("FBD1");
  d1 = d;
  b1 = await makeBranch(d.id, "FB1");
  b2 = await makeBranch(d.id, "FB2");
  author = await actorWith({ permissions: AUTHOR });
  qn = await buildQuestionnaire();
  await setAssignments(author, qn.id, [{ scopeType: "DISTRICT", id: d1.id }]);
  await activateQuestionnaire(author, qn.id);
  const qr = await createQRCode(author, { label: "TQ feedback QR", scopeType: "BRANCH", locationId: b1.id });
  code = qr.publicCode;
  qrId = qr.id;
});
afterAll(cleanup);

describe("valid submissions", () => {
  it("stores the submission with version, location snapshot, rating and answers", async () => {
    await submit({
      [qn.refs.rating]: 5,
      [qn.refs.resolved]: "yes",
      [qn.refs.comment]: "  Staff were helpful.  ",
    });
    const sub = await prisma.feedbackSubmission.findFirstOrThrow({
      where: { qrCodeId: qrId },
      orderBy: { submittedAt: "desc" },
      include: { answers: true, version: true },
    });
    expect(sub.questionnaireId).toBe(qn.id);
    expect(sub.version.version).toBe(1);
    expect(sub.branchId).toBe(b1.id);
    expect(sub.districtId).toBe(d1.id); // branch's district recorded for scoped reporting
    expect(sub.overallRating).toBe(5);
    expect(sub.sentiment).toBe("POSITIVE");
    expect(sub.answers).toHaveLength(3);
    expect(sub.answers.find((a) => a.questionRef === qn.refs.comment)?.valueText).toBe("Staff were helpful.");
    expect(sub.contactPhone).toBeNull(); // anonymous by default
    expect(sub.wantsFollowUp).toBe(false);
    expect(sub.ipHash).toMatch(/^[0-9a-f]{32}$/); // a keyed hash, never the raw address
  });

  it("accepts a conditional answer only when its condition holds", async () => {
    await submit({ [qn.refs.rating]: 2, [qn.refs.resolved]: "no", [qn.refs.problem]: qn.options[0] });
    const sub = await prisma.feedbackSubmission.findFirstOrThrow({
      where: { qrCodeId: qrId, overallRating: 2 },
      include: { answers: true },
    });
    expect(sub.answers.map((a) => a.questionRef)).toContain(qn.refs.problem);
    expect(sub.sentiment).toBe("NEGATIVE");
  });

  it("silently drops answers to hidden questions instead of storing them", async () => {
    await submit({ [qn.refs.rating]: 4, [qn.refs.resolved]: "yes", [qn.refs.problem]: qn.options[1] });
    const sub = await prisma.feedbackSubmission.findFirstOrThrow({
      where: { qrCodeId: qrId, overallRating: 4 },
      include: { answers: true },
    });
    expect(sub.answers.map((a) => a.questionRef)).not.toContain(qn.refs.problem);
  });
});

describe("server-side validation", () => {
  it("rejects missing required answers with per-question messages", async () => {
    const e = await submit({ [qn.refs.comment]: "hi" }).catch((x) => x);
    expect(e.code).toBe("VALIDATION");
    expect(Object.keys(e.fieldErrors)).toEqual(expect.arrayContaining([qn.refs.rating, qn.refs.resolved]));
  });

  it("requires a visible conditional question", async () => {
    const e = await submit({ [qn.refs.rating]: 3, [qn.refs.resolved]: "no" }).catch((x) => x);
    expect(e.fieldErrors?.[qn.refs.problem]).toBeTruthy();
  });

  it("rejects wrong types, out-of-range values and options that do not exist", async () => {
    for (const bad of [
      { [qn.refs.rating]: 6, [qn.refs.resolved]: "yes" },
      { [qn.refs.rating]: "5", [qn.refs.resolved]: "yes" },
      { [qn.refs.rating]: 3, [qn.refs.resolved]: "maybe" },
      { [qn.refs.rating]: 3, [qn.refs.resolved]: "no", [qn.refs.problem]: "not-an-option" },
      { [qn.refs.rating]: 3, [qn.refs.resolved]: "yes", [qn.refs.comment]: 42 },
      { [qn.refs.rating]: 3, [qn.refs.resolved]: "yes", [qn.refs.comment]: "x".repeat(2001) },
    ]) {
      await expect(submit(bad)).rejects.toMatchObject({ code: "VALIDATION" });
    }
  });

  it("rejects malformed bodies and unknown question refs", async () => {
    await expect(submitFeedback(code, null, { ip: randomIp() })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(submitFeedback(code, { answers: "nope" }, { ip: randomIp() })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      submit({ [qn.refs.rating]: 5, [qn.refs.resolved]: "yes", [randomUUID()]: "injected" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(submit({ [qn.refs.rating]: { $gt: 0 }, [qn.refs.resolved]: "yes" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("stores nothing when validation fails", async () => {
    const before = await prisma.feedbackSubmission.count({ where: { questionnaireId: qn.id } });
    await submit({ [qn.refs.rating]: 9 }).catch(() => undefined);
    expect(await prisma.feedbackSubmission.count({ where: { questionnaireId: qn.id } })).toBe(before);
  });
});

describe("contact details (opt-in only)", () => {
  const base = () => ({ [qn.refs.rating]: 3, [qn.refs.resolved]: "yes" });

  it("stores a phone only when the customer opts in, and flags the record for follow-up", async () => {
    await submit(base(), { wantsFollowUp: true, contactPhone: " +251 911 234567 " });
    const sub = await prisma.feedbackSubmission.findFirstOrThrow({
      where: { contactPhone: { not: null }, questionnaireId: qn.id },
    });
    expect(sub.contactPhone).toBe("+251 911 234567");
    expect(sub.wantsFollowUp).toBe(true);
  });

  it("rejects an invalid phone, and ignores a phone sent without opting in", async () => {
    await expect(
      submit(base(), { wantsFollowUp: true, contactPhone: "call me maybe" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const before = await prisma.feedbackSubmission.count({
      where: { questionnaireId: qn.id, contactPhone: { not: null } },
    });
    await submit(base(), { wantsFollowUp: false, contactPhone: "+251911000000" });
    expect(
      await prisma.feedbackSubmission.count({
        where: { questionnaireId: qn.id, contactPhone: { not: null } },
      }),
    ).toBe(before);
  });

  it("never collects contact details when the questionnaire does not ask for them", async () => {
    const off = await buildQuestionnaire(false);
    const b3 = await makeBranch(d1.id, "FB3");
    await setAssignments(author, off.id, [{ scopeType: "BRANCH", id: b3.id }]);
    await activateQuestionnaire(author, off.id);
    const qr = await createQRCode(author, { label: "TQ no contact", scopeType: "BRANCH", locationId: b3.id });
    await submitFeedback(
      qr.publicCode,
      {
        answers: { [off.refs.rating]: 4, [off.refs.resolved]: "yes" },
        wantsFollowUp: true,
        contactPhone: "+251911000000",
      },
      { ip: randomIp() },
    );
    const sub = await prisma.feedbackSubmission.findFirstOrThrow({ where: { questionnaireId: off.id } });
    expect(sub.contactPhone).toBeNull();
    expect(sub.wantsFollowUp).toBe(false);
  });
});

describe("closed / unavailable", () => {
  it("returns customer-safe messages for invalid, inactive and closed cases", async () => {
    await expect(submitFeedback("ZZZZZZZZ", { answers: {} }, { ip: randomIp() })).rejects.toMatchObject({
      message: "This feedback link is no longer available.",
      code: "NOT_FOUND",
    });
    await expect(submitFeedback("bad", { answers: {} }, { ip: randomIp() })).rejects.toMatchObject({
      message: "This feedback link is no longer available.",
    });

    const other = await createQRCode(author, {
      label: "TQ toggling",
      scopeType: "BRANCH",
      locationId: b2.id,
    });
    await updateQRCode(author, other.id, { label: "TQ toggling", isActive: false });
    await expect(submitFeedback(other.publicCode, { answers: {} }, { ip: randomIp() })).rejects.toMatchObject(
      { message: "This feedback link is no longer available." },
    );
  });

  it("stops accepting feedback the moment the questionnaire is paused", async () => {
    await pauseQuestionnaire(author, qn.id);
    await expect(submit({ [qn.refs.rating]: 5, [qn.refs.resolved]: "yes" })).rejects.toMatchObject({
      message: "This feedback form is currently closed.",
    });
    await activateQuestionnaire(author, qn.id);
    await expect(submit({ [qn.refs.rating]: 5, [qn.refs.resolved]: "yes" })).resolves.toEqual({ ok: true });
  });

  it("never leaks internals through the public action", async () => {
    const r = await submitFeedbackAction("ZZZZZZZZ", { answers: {} });
    expect(r).toEqual({
      ok: false,
      error: "This feedback link is no longer available.",
      fieldErrors: undefined,
    });
    const g = await submitFeedbackAction(code, { answers: { [qn.refs.rating]: 99 } });
    expect(g.ok).toBe(false);
    expect(JSON.stringify(g)).not.toMatch(/prisma|stack|select|sql/i);
  });
});

describe("historical accuracy", () => {
  it("old submissions stay linked to the version they were answered on after a new version is published", async () => {
    const hq = await buildQuestionnaire();
    const b4 = await makeBranch(d1.id, "FB4");
    await setAssignments(author, hq.id, [{ scopeType: "BRANCH", id: b4.id }]);
    await activateQuestionnaire(author, hq.id);
    const qr = await createQRCode(author, { label: "TQ history", scopeType: "BRANCH", locationId: b4.id });
    await submitFeedback(
      qr.publicCode,
      { answers: { [hq.refs.rating]: 3, [hq.refs.resolved]: "yes" } },
      { ip: randomIp() },
    );

    // new version drops a question
    await pauseQuestionnaire(author, hq.id);
    await reopenQuestionnaire(author, hq.id);
    const ed = await prisma.questionnaireQuestion.findMany({
      where: { questionnaireId: hq.id },
      orderBy: { sortOrder: "asc" },
    });
    await saveDraft(author, hq.id, {
      meta: {
        title: { en: "TQ Feedback survey" },
        defaultLocale: "en",
        locales: ["en"],
        collectContact: true,
      },
      questions: ed.slice(0, 2).map((q) => ({
        ref: q.id,
        questionId: q.questionId,
        isRequired: q.isRequired,
        isPrimaryRating: q.isPrimaryRating,
      })),
    });
    await publishQuestionnaire(author, hq.id);
    await activateQuestionnaire(author, hq.id);
    await submitFeedback(
      qr.publicCode,
      { answers: { [hq.refs.rating]: 5, [hq.refs.resolved]: "yes" } },
      { ip: randomIp() },
    );

    const subs = await prisma.feedbackSubmission.findMany({
      where: { questionnaireId: hq.id },
      include: { version: true },
      orderBy: { submittedAt: "asc" },
    });
    expect(subs.map((s) => s.version.version)).toEqual([1, 2]);
    const v1 = subs[0].version.definition as { questions: unknown[] };
    const v2 = subs[1].version.definition as { questions: unknown[] };
    expect(v1.questions).toHaveLength(4);
    expect(v2.questions).toHaveLength(2);
  });
});

describe("abuse protection", () => {
  it("throttles a source that floods one QR code", async () => {
    const ip = randomIp();
    const results: string[] = [];
    for (let i = 0; i < 9; i++) {
      results.push(
        await submit({ [qn.refs.rating]: 4, [qn.refs.resolved]: "yes" }, {}, ip).then(
          () => "ok",
          (e) => e.code,
        ),
      );
    }
    expect(results.filter((r) => r === "ok")).toHaveLength(6);
    expect(results.filter((r) => r === "RATE_LIMITED").length).toBeGreaterThanOrEqual(3);
  });
});

describe("notifications", () => {
  it("alerts in-scope staff about low ratings and follow-up requests, but not out-of-scope staff", async () => {
    const inScope = await actorWith({
      permissions: ["feedback.view"],
      scopeType: "BRANCH",
      branchId: b1.id,
    });
    const inDistrict = await actorWith({
      permissions: ["feedback.view"],
      scopeType: "DISTRICT",
      districtId: d1.id,
    });
    const otherBranch = await actorWith({
      permissions: ["feedback.view"],
      scopeType: "BRANCH",
      branchId: b2.id,
    });
    await submit(
      { [qn.refs.rating]: 1, [qn.refs.resolved]: "yes" },
      { wantsFollowUp: true, contactPhone: "+251911000001" },
    );
    await new Promise((r) => setTimeout(r, 700)); // notifications are fire-and-forget
    const types = async (userId: string) =>
      (await prisma.notification.findMany({ where: { userId } })).map((n) => n.type).sort();
    expect(await types(inScope.userId)).toEqual(["FOLLOW_UP_REQUESTED", "LOW_RATING"]);
    expect(await types(inDistrict.userId)).toEqual(["FOLLOW_UP_REQUESTED", "LOW_RATING"]);
    expect(await types(otherBranch.userId)).toEqual([]);
  });
});
