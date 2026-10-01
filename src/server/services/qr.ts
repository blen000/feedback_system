/**
 * QR codes identify a LOCATION, never a customer and never a fixed questionnaire.
 * Scanning resolves: QR → location → the questionnaire currently ACTIVE there.
 */
import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/audit";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { hit } from "@/lib/rate-limit";
import { hashIp } from "@/lib/auth/crypto";
import { requirePermission, requirePermissionOn, type AuthContext } from "@/lib/rbac/authorize";
import { qrWhere, type Target } from "@/lib/rbac/scope";
import { generatePublicCode, PUBLIC_CODE_PATTERN, publicUrl, qrSvgDataUri } from "@/lib/qr/generate";
import { createQrSchema, updateQrSchema } from "@/lib/validation/qr";
import { parse } from "@/lib/validation/parse";
import { ALL_LOCATIONS } from "@/lib/validation/location";
import { pick } from "@/lib/questionnaire/types";
import { Prisma } from "@/generated/prisma/client";
import { resolveActiveQuestionnaire } from "./questionnaires";
import { resolveTarget } from "./targets";

const include = {
  district: { select: { id: true, name: true, isActive: true, deletedAt: true } },
  branch: {
    select: {
      id: true,
      name: true,
      isActive: true,
      deletedAt: true,
      districtId: true,
      district: { select: { name: true, isActive: true, deletedAt: true } },
    },
  },
  department: {
    select: {
      id: true,
      name: true,
      isActive: true,
      deletedAt: true,
      districtId: true,
      district: { select: { name: true, isActive: true, deletedAt: true } },
    },
  },
} satisfies Prisma.QRCodeInclude;

type Row = Prisma.QRCodeGetPayload<{ include: typeof include }>;

function targetOf(qr: Row): Target {
  if (qr.allOf) return { type: "ALL" }; // spans the whole bank, so only bank-wide staff manage it
  if (qr.branch) return { type: "BRANCH", branchId: qr.branch.id, districtId: qr.branch.districtId };
  if (qr.department)
    return { type: "DEPARTMENT", departmentId: qr.department.id, districtId: qr.department.districtId };
  return { type: "DISTRICT", districtId: qr.districtId! };
}

const ALL_LABEL = {
  DISTRICT: "All districts",
  BRANCH: "All branches",
  DEPARTMENT: "All departments",
} as const;

function locationOf(qr: Row) {
  if (qr.allOf && qr.allOf !== "ALL") {
    return {
      type: "All" as const,
      name: ALL_LABEL[qr.allOf],
      parent: "Feedback is recorded for the entire bank",
      usable: true,
    };
  }
  if (qr.branch) {
    const usable =
      !qr.branch.deletedAt &&
      qr.branch.isActive &&
      !qr.branch.district.deletedAt &&
      qr.branch.district.isActive;
    return { type: "Branch" as const, name: qr.branch.name, parent: qr.branch.district.name, usable };
  }
  if (qr.department) {
    const d = qr.department.district;
    const usable = !qr.department.deletedAt && qr.department.isActive && (!d || (!d.deletedAt && d.isActive));
    return {
      type: "Department" as const,
      name: qr.department.name,
      parent: d?.name ?? "Head Office",
      usable,
    };
  }
  const d = qr.district!;
  return { type: "District" as const, name: d.name, parent: null, usable: !d.deletedAt && d.isActive };
}

async function loadForActor(id: string, ctx: AuthContext, permission: "qr.view" | "qr.update" | "qr.delete") {
  const uuid = /^[0-9a-f-]{36}$/i.test(id);
  const qr = uuid ? await prisma.qRCode.findFirst({ where: { id, deletedAt: null }, include }) : null;
  if (!qr) throw notFound("QR code");
  requirePermissionOn(ctx, permission, targetOf(qr));
  return qr;
}

// ───────────────────────── Reads ─────────────────────────

export async function listQRCodes(ctx: AuthContext) {
  const scope = requirePermission(ctx, "qr.view");
  const rows = await prisma.qRCode.findMany({
    where: { deletedAt: null, ...qrWhere(scope) },
    orderBy: { createdAt: "desc" },
    include,
  });
  const ids = rows.map((r) => r.id);
  const [scans, feedback] = await Promise.all([
    prisma.qRScan.groupBy({ by: ["qrCodeId"], where: { qrCodeId: { in: ids } }, _count: { _all: true } }),
    prisma.feedbackSubmission.groupBy({
      by: ["qrCodeId"],
      where: { qrCodeId: { in: ids }, deletedAt: null },
      _count: { _all: true },
      _avg: { overallRating: true },
    }),
  ]);
  const scanOf = new Map(scans.map((s) => [s.qrCodeId, s._count._all]));
  const fbOf = new Map(feedback.map((f) => [f.qrCodeId, f]));

  return Promise.all(
    rows.map(async (r) => {
      const loc = locationOf(r);
      const active = await resolveActiveQuestionnaire({
        branchId: r.branchId,
        departmentId: r.departmentId,
        districtId: r.districtId,
      });
      const scanCount = scanOf.get(r.id) ?? 0;
      const fb = fbOf.get(r.id);
      const feedbackCount = fb?._count._all ?? 0;
      return {
        id: r.id,
        label: r.label,
        publicCode: r.publicCode,
        url: publicUrl(r.publicCode),
        svg: await qrSvgDataUri(r.publicCode),
        isActive: r.isActive,
        location: loc,
        questionnaire: active ? pick(active.definition.title, active.definition.defaultLocale) : null,
        scanCount,
        feedbackCount,
        // scans are page opens, not unique customers; completion is therefore an approximation
        completionRate: scanCount > 0 ? Math.min(feedbackCount / scanCount, 1) : null,
        averageRating: fb?._avg.overallRating ?? null,
        createdAt: r.createdAt,
      };
    }),
  );
}

/** Locations the actor may create QR codes for (UI convenience; createQR re-checks). */
export async function listQrLocations(ctx: AuthContext) {
  const scope = requirePermission(ctx, "qr.create");
  const d = [...scope.districtIds];
  const [districts, branches, departments] = await Promise.all([
    prisma.district.findMany({
      where: { deletedAt: null, isActive: true, ...(scope.all ? {} : { id: { in: d } }) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.branch.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(scope.all ? {} : { OR: [{ districtId: { in: d } }, { id: { in: [...scope.branchIds] } }] }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.department.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(scope.all ? {} : { OR: [{ districtId: { in: d } }, { id: { in: [...scope.departmentIds] } }] }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  // A single QR covering every branch/district/department spans the bank: bank-wide staff only.
  return { districts, branches, departments, canAll: scope.all };
}

/** For downloads/print: verifies permission and scope, returns only what is needed. */
export async function getQrForDownload(ctx: AuthContext, id: string) {
  const qr = await loadForActor(id, ctx, "qr.view");
  const loc = locationOf(qr);
  return {
    id: qr.id,
    label: qr.label,
    publicCode: qr.publicCode,
    url: publicUrl(qr.publicCode),
    location: loc,
  };
}

// ───────────────────────── Writes ─────────────────────────

export async function createQRCode(ctx: AuthContext, input: unknown) {
  const scope = requirePermission(ctx, "qr.create");
  const data = parse(createQrSchema, input);
  if (data.locationId === ALL_LOCATIONS) {
    // ONE code for every branch/district/department; the customer picks theirs when scanning.
    if (!scope.all) throw forbidden();
    return createOne(ctx, data.label, data.scopeType, null);
  }
  return createOne(ctx, data.label, data.scopeType, data.locationId);
}

async function createOne(
  ctx: AuthContext,
  label: string,
  scopeType: "DISTRICT" | "BRANCH" | "DEPARTMENT",
  locationId: string | null,
) {
  if (locationId) {
    const target = await resolveTarget({
      scopeType,
      districtId: scopeType === "DISTRICT" ? locationId : null,
      branchId: scopeType === "BRANCH" ? locationId : null,
      departmentId: scopeType === "DEPARTMENT" ? locationId : null,
    });
    requirePermissionOn(ctx, "qr.create", target);

    const inactive = await isLocationInactive(scopeType, locationId);
    if (inactive) throw conflict("That location is inactive. Activate it before creating a QR code.");
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const qr = await prisma.qRCode.create({
        data: {
          publicCode: generatePublicCode(),
          label,
          districtId: locationId && scopeType === "DISTRICT" ? locationId : null,
          branchId: locationId && scopeType === "BRANCH" ? locationId : null,
          departmentId: locationId && scopeType === "DEPARTMENT" ? locationId : null,
          allOf: locationId ? null : scopeType,
          createdById: ctx.userId,
        },
      });
      await writeAudit({
        actorId: ctx.userId,
        action: "QR_CREATED",
        resource: "QRCode",
        resourceId: qr.id,
        metadata: { label, scopeType, locationId },
      });
      return { id: qr.id, publicCode: qr.publicCode };
    } catch (e) {
      // extremely unlikely public-code collision: try another code
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  throw conflict("Could not generate a unique code. Please try again.");
}

async function isLocationInactive(scopeType: "DISTRICT" | "BRANCH" | "DEPARTMENT", id: string) {
  if (scopeType === "DISTRICT")
    return !(await prisma.district.findFirst({ where: { id, isActive: true, deletedAt: null } }));
  if (scopeType === "BRANCH")
    return !(await prisma.branch.findFirst({ where: { id, isActive: true, deletedAt: null } }));
  return !(await prisma.department.findFirst({ where: { id, isActive: true, deletedAt: null } }));
}

export async function updateQRCode(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "qr.update");
  const qr = await loadForActor(id, ctx, "qr.update");
  const data = parse(updateQrSchema, input);
  if (data.isActive && !qr.isActive && !locationOf(qr).usable) {
    throw conflict("The location is inactive. Activate the location first.");
  }
  await prisma.qRCode.update({ where: { id }, data: { label: data.label, isActive: data.isActive } });
  await writeAudit({
    actorId: ctx.userId,
    action: qr.isActive && !data.isActive ? "QR_DEACTIVATED" : "QR_UPDATED",
    resource: "QRCode",
    resourceId: id,
    metadata: { label: data.label, isActive: data.isActive },
  });
}

/**
 * Issues a new public code. The old printed QR stops working immediately, so use this when a
 * code has leaked or been abused. History (scans, feedback) stays with the QR record.
 */
export async function regenerateQRCode(ctx: AuthContext, id: string) {
  requirePermission(ctx, "qr.update");
  await loadForActor(id, ctx, "qr.update");
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const qr = await prisma.qRCode.update({ where: { id }, data: { publicCode: generatePublicCode() } });
      await writeAudit({
        actorId: ctx.userId,
        action: "QR_UPDATED",
        resource: "QRCode",
        resourceId: id,
        metadata: { regenerated: true },
      });
      return { publicCode: qr.publicCode };
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  throw conflict("Could not generate a unique code. Please try again.");
}

export async function deleteQRCode(ctx: AuthContext, id: string) {
  requirePermission(ctx, "qr.delete");
  const qr = await loadForActor(id, ctx, "qr.delete");
  await prisma.qRCode.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await writeAudit({
    actorId: ctx.userId,
    action: "QR_DELETED",
    resource: "QRCode",
    resourceId: id,
    metadata: { label: qr.label },
  });
}

// ───────────────────────── Public path (no authentication) ─────────────────────────

export type QrResolution =
  | {
      status: "OK";
      qrCodeId: string;
      location: { type: string; name: string; parent: string | null };
      districtId: string | null;
      branchId: string | null;
      departmentId: string | null;
      questionnaire: NonNullable<Awaited<ReturnType<typeof resolveActiveQuestionnaire>>>;
    }
  | { status: "NOT_FOUND" | "QR_INACTIVE" | "LOCATION_INACTIVE" | "NO_ACTIVE_QUESTIONNAIRE" };

/**
 * Turns a scanned public code into what the customer should see. The status distinguishes the
 * failure so the page can show a friendly message without leaking internals.
 */
export async function resolvePublicCode(code: string): Promise<QrResolution> {
  if (!PUBLIC_CODE_PATTERN.test(code)) return { status: "NOT_FOUND" };
  const qr = await prisma.qRCode.findUnique({ where: { publicCode: code }, include });
  if (!qr || qr.deletedAt) return { status: "NOT_FOUND" };
  if (!qr.isActive) return { status: "QR_INACTIVE" };

  if (qr.allOf) {
    // Shared "All branches/districts/departments" code: straight to the bank-wide questionnaire and the
    // feedback is recorded for the entire bank (no district/branch/department).
    const questionnaire = await resolveActiveQuestionnaire({});
    if (!questionnaire) return { status: "NO_ACTIVE_QUESTIONNAIRE" };
    return {
      status: "OK",
      qrCodeId: qr.id,
      location: { type: "Bank", name: "Entire bank", parent: null },
      districtId: null,
      branchId: null,
      departmentId: null,
      questionnaire,
    };
  }

  const loc = locationOf(qr);
  if (!loc.usable) return { status: "LOCATION_INACTIVE" };

  const questionnaire = await resolveActiveQuestionnaire({
    branchId: qr.branchId,
    departmentId: qr.departmentId,
    districtId: qr.districtId,
  });
  if (!questionnaire) return { status: "NO_ACTIVE_QUESTIONNAIRE" };

  // Expose the leaf location's own ids (branch → its district) for snapshotting on submissions.
  const districtId = qr.branch?.districtId ?? qr.department?.districtId ?? qr.districtId;
  return {
    status: "OK",
    qrCodeId: qr.id,
    location: { type: loc.type, name: loc.name, parent: loc.parent },
    districtId,
    branchId: qr.branchId,
    departmentId: qr.departmentId,
    questionnaire,
  };
}

/**
 * Counts a page open. Repeat opens from the same source within 5 minutes count once,
 * which limits inflation from refreshes. It is NOT a unique-customer count.
 */
export async function recordScan(qrCodeId: string, ip: string | null | undefined): Promise<boolean> {
  const source = hashIp(ip) ?? "unknown";
  if ((await hit(`scan:${qrCodeId}:${source}`, 300)) > 1) return false;
  await prisma.qRScan.create({ data: { qrCodeId } });
  return true;
}
