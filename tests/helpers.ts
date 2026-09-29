import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/crypto";
import type { AuthContext } from "@/lib/rbac/authorize";
import { authenticateToken, login } from "@/server/services/auth";
import type { ScopeType } from "@/lib/rbac/scope";

export const TEST_PASSWORD = "Test-Passw0rd-123";
const RUN = randomBytes(3).toString("hex").toUpperCase();
let counter = 0;
export const uid = (p = "T") => `${p}${RUN}${++counter}`;
export const randomIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

export async function makeDistrict(name = "Test District") {
  return prisma.district.create({ data: { code: uid("TD"), name } });
}

export async function makeBranch(districtId: string, name = "Test Branch") {
  return prisma.branch.create({ data: { code: uid("TB"), name, districtId } });
}

export async function makeRole(permissions: string[], key = uid("TR")) {
  const perms = await prisma.permission.findMany({ where: { key: { in: permissions } } });
  if (perms.length !== permissions.length) throw new Error("unknown permission in test fixture");
  return prisma.role.create({
    data: { key, name: key, permissions: { create: perms.map((p) => ({ permissionId: p.id })) } },
  });
}

interface UserOpts {
  permissions: string[];
  scopeType?: ScopeType;
  districtId?: string;
  branchId?: string;
  status?: "ACTIVE" | "INACTIVE";
  roleId?: string;
}

export async function makeUser(opts: UserOpts) {
  const role = opts.roleId ? { id: opts.roleId } : await makeRole(opts.permissions);
  const email = `${uid("u").toLowerCase()}@test.local`;
  const user = await prisma.user.create({
    data: {
      email,
      name: "Test User",
      passwordHash: await hashPassword(TEST_PASSWORD),
      status: opts.status ?? "ACTIVE",
      roles: {
        create: {
          roleId: role.id,
          scopeType: opts.scopeType ?? "ALL",
          districtId: opts.districtId ?? null,
          branchId: opts.branchId ?? null,
        },
      },
    },
  });
  return { user, email, roleId: role.id };
}

/** Full real path: create user → login → resolve session token to an AuthContext. */
export async function actorWith(opts: UserOpts): Promise<AuthContext & { token: string; email: string }> {
  const { email } = await makeUser(opts);
  const { token } = await login({ email, password: TEST_PASSWORD }, { ip: randomIp() });
  const ctx = await authenticateToken(token);
  if (!ctx) throw new Error("fixture login failed");
  return { ...ctx, token, email };
}

/** Removes every row created by tests (fixtures use test.local emails / TD/TB/TR/TDEP prefixes). */
export async function cleanup() {
  // feedback first: it references questionnaires, versions and QR codes
  const tq = await prisma.questionnaireTranslation.findMany({
    where: { title: { startsWith: "TQ" } },
    select: { questionnaireId: true },
  });
  const tqIds = [...new Set(tq.map((t) => t.questionnaireId))];
  // notifications raised for test feedback also reach real staff (e.g. the seeded admin): remove them too
  const subs = await prisma.feedbackSubmission.findMany({
    where: { questionnaireId: { in: tqIds } },
    select: { id: true },
  });
  if (subs.length) {
    await prisma.notification.deleteMany({
      where: { OR: subs.map((s) => ({ data: { path: ["submissionId"], equals: s.id } })) },
    });
  }
  await prisma.feedbackSubmission.deleteMany({ where: { questionnaireId: { in: tqIds } } });
  await prisma.qRCode.deleteMany({ where: { label: { startsWith: "TQ" } } });
  // questionnaires/questions created by tests carry a "TQ" title/text prefix
  const qn = await prisma.questionnaireTranslation.findMany({
    where: { title: { startsWith: "TQ" } },
    select: { questionnaireId: true },
  });
  const qnIds = [...new Set(qn.map((t) => t.questionnaireId))];
  await prisma.questionnaireVersion.deleteMany({ where: { questionnaireId: { in: qnIds } } });
  await prisma.questionnaire.deleteMany({ where: { id: { in: qnIds } } });
  const qs = await prisma.questionTranslation.findMany({
    where: { text: { startsWith: "TQ" } },
    select: { questionId: true },
  });
  await prisma.question.deleteMany({ where: { id: { in: [...new Set(qs.map((t) => t.questionId))] } } });

  const users = await prisma.user.findMany({
    where: { email: { endsWith: "@test.local" } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorId: { in: ids } }, { resourceId: { in: ids } }] },
  });
  await prisma.feedbackForward.deleteMany({
    where: { OR: [{ fromUserId: { in: ids } }, { toUserId: { in: ids } }] },
  });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { key: { startsWith: "TR" } } } });
  await prisma.role.deleteMany({ where: { key: { startsWith: "TR" } } });
  await prisma.department.deleteMany({ where: { code: { startsWith: "TDEP" } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: "TB" } } });
  await prisma.district.deleteMany({ where: { code: { startsWith: "TD" } } });
  await prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: "login:" } } });
  await prisma.rateLimitBucket.deleteMany({
    where: { OR: [{ key: { startsWith: "scan:" } }, { key: { startsWith: "submit:" } }] },
  });
}
