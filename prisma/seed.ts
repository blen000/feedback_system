/**
 * Development seed. Idempotent — safe to re-run.
 *   npm run db:seed
 * Set SEED_PASSWORD to choose the demo users' password. In production a password is mandatory
 * and only the SUPER_ADMIN user is created.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PrismaClient, type ScopeType } from "../src/generated/prisma/client";
import { ALL_PERMISSIONS, permissionGroup, SYSTEM_ROLES } from "../src/lib/rbac/permissions";
import type { AuthContext } from "../src/lib/rbac/authorize";
import { createQuestion } from "../src/server/services/questions";
import {
  activateQuestionnaire,
  createQuestionnaire,
  publishQuestionnaire,
  saveDraft,
  setAssignments,
} from "../src/server/services/questionnaires";
import { createQRCode } from "../src/server/services/qr";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const isProd = process.env.NODE_ENV === "production";

async function seedPermissionsAndRoles() {
  const newKeys: string[] = [];
  for (const key of ALL_PERMISSIONS) {
    if (!(await prisma.permission.findUnique({ where: { key } }))) newKeys.push(key);
    await prisma.permission.upsert({
      where: { key },
      update: { group: permissionGroup(key) },
      create: { key, group: permissionGroup(key) },
    });
  }
  const perms = await prisma.permission.findMany();
  const idOf = new Map(perms.map((p) => [p.key, p.id]));

  for (const def of SYSTEM_ROLES) {
    const existing = await prisma.role.findUnique({ where: { key: def.key } });
    const role =
      existing ??
      (await prisma.role.create({
        data: { key: def.key, name: def.name, description: def.description, isSystem: true },
      }));
    // New roles get their default permissions. Existing roles keep administrator edits,
    // except SUPER_ADMIN which always receives the complete catalog (incl. newly added permissions).
    if (!existing || def.key === "SUPER_ADMIN") {
      await prisma.rolePermission.createMany({
        data: def.permissions.map((k) => ({ roleId: role.id, permissionId: idOf.get(k)! })),
        skipDuplicates: true,
      });
    } else if (newKeys.length) {
      // A permission added to the catalog since the last seed: give it to the roles whose defaults include it.
      const grant = def.permissions.filter((k) => newKeys.includes(k));
      await prisma.rolePermission.createMany({
        data: grant.map((k) => ({ roleId: role.id, permissionId: idOf.get(k)! })),
        skipDuplicates: true,
      });
    }
  }
}

async function seedOrganization() {
  const district = await prisma.district.upsert({
    where: { code: "D1" },
    update: {},
    create: { code: "D1", name: "District 1" },
  });
  const branches = [
    { code: "BOLE", name: "Bole Branch", city: "Addis Ababa" },
    { code: "CMC", name: "CMC Branch", city: "Addis Ababa" },
    { code: "PIASSA", name: "Piassa Branch", city: "Addis Ababa" },
  ];
  const created = [];
  for (const b of branches) {
    created.push(
      await prisma.branch.upsert({
        where: { code: b.code },
        update: {},
        create: { ...b, districtId: district.id },
      }),
    );
  }
  for (const d of [
    { code: "HO-RETAIL", name: "Retail Banking" },
    { code: "HO-CX", name: "Customer Experience" },
  ]) {
    await prisma.department.upsert({ where: { code: d.code }, update: {}, create: d });
  }
  return { district, bole: created[0] };
}

async function upsertUser(
  email: string,
  name: string,
  password: string,
  roleKey: string,
  scope: { scopeType: ScopeType; districtId?: string; branchId?: string },
) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, passwordHash },
  });
  const has = await prisma.userRole.count({ where: { userId: user.id } });
  if (!has) {
    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: role.id,
        scopeType: scope.scopeType,
        districtId: scope.districtId ?? null,
        branchId: scope.branchId ?? null,
      },
    });
  }
}

const SAMPLE_TITLE = "Branch Customer Experience Survey";

/** Sample questionnaire + working QR, created through the real services (so validation and audit apply). */
async function seedSample(districtId: string, boleId: string) {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@bank.local" } });
  const ctx: AuthContext = {
    userId: admin.id,
    sessionId: "seed",
    email: admin.email,
    name: admin.name,
    mustChangePassword: false,
    assignments: [
      {
        roleKey: "SUPER_ADMIN",
        scopeType: "ALL",
        districtId: null,
        branchId: null,
        departmentId: null,
        permissions: new Set<string>(ALL_PERMISSIONS),
      },
    ],
  };

  const existing = await prisma.questionnaireTranslation.findFirst({
    where: { title: SAMPLE_TITLE, questionnaire: { deletedAt: null } },
  });
  if (!existing) {
    const q = async (input: Record<string, unknown>) => (await createQuestion(ctx, input)).id;
    const services = [
      "Account Opening",
      "Cash Deposit",
      "Cash Withdrawal",
      "Loan Service",
      "Card Service",
      "Customer Service",
      "Other",
    ];
    const rating = await q({
      type: "STAR_RATING",
      config: { scale: 5 },
      text: { en: "How would you rate our service?", am: "አገልግሎታችንን እንዴት ይመዝኑታል?" },
    });
    const resolved = await q({ type: "YES_NO", text: { en: "Was your issue resolved?", am: "ጉዳይዎ ተፈትቷል?" } });
    const service = await q({
      type: "SINGLE_CHOICE",
      text: { en: "Which service did you use?", am: "የትኛውን አገልግሎት ተጠቀሙ?" },
      options: services.map((en) => ({ label: { en } })),
    });
    const others = await q({
      type: "MULTIPLE_CHOICE",
      text: { en: "Which other services did you use today?" },
      options: services.slice(0, 6).map((en) => ({ label: { en } })),
    });
    const problem = await q({
      type: "SINGLE_CHOICE",
      text: { en: "What was the main problem?" },
      options: [
        "Long waiting time",
        "Staff behavior",
        "Service unavailable",
        "System problem",
        "Information problem",
        "Other",
      ].map((en) => ({ label: { en } })),
    });
    const improve = await q({
      type: "LONG_TEXT",
      text: { en: "What can we improve?", am: "ምን ማሻሻል እንችላለን?" },
      placeholder: { en: "Tell us about your experience" },
    });

    const { id } = await createQuestionnaire(ctx, {
      title: { en: SAMPLE_TITLE, am: "የቅርንጫፍ የደንበኛ ልምድ ዳሰሳ" },
      description: { en: "It takes less than a minute. Your voice helps us improve." },
      locales: ["en", "am"],
    });
    const refs = {
      rating: randomUUID(),
      resolved: randomUUID(),
      service: randomUUID(),
      others: randomUUID(),
      problem: randomUUID(),
      improve: randomUUID(),
    };
    await saveDraft(ctx, id, {
      meta: {
        title: { en: SAMPLE_TITLE, am: "የቅርንጫፍ የደንበኛ ልምድ ዳሰሳ" },
        description: { en: "It takes less than a minute. Your voice helps us improve." },
        defaultLocale: "en",
        locales: ["en", "am"],
        collectContact: true,
      },
      questions: [
        { ref: refs.rating, questionId: rating, isRequired: true, isPrimaryRating: true },
        { ref: refs.resolved, questionId: resolved, isRequired: true },
        { ref: refs.service, questionId: service },
        { ref: refs.others, questionId: others },
        {
          ref: refs.problem,
          questionId: problem,
          isRequired: true,
          visibility: {
            match: "all",
            rules: [{ questionRef: refs.resolved, operator: "equals", value: "no" }],
          },
        },
        { ref: refs.improve, questionId: improve },
      ],
    });
    await publishQuestionnaire(ctx, id);
    await setAssignments(ctx, id, [{ scopeType: "DISTRICT", id: districtId }]);
    await activateQuestionnaire(ctx, id);
  }

  const hasQr = await prisma.qRCode.findFirst({ where: { branchId: boleId, deletedAt: null } });
  const qr =
    hasQr ??
    (await prisma.qRCode.findUniqueOrThrow({
      where: {
        id: (
          await createQRCode(ctx, {
            label: "Bole Branch – main entrance",
            scopeType: "BRANCH",
            locationId: boleId,
          })
        ).id,
      },
    }));
  console.log(`Sample QR (Bole Branch): /f/${qr.publicCode}`);
}

async function main() {
  await seedPermissionsAndRoles();
  const { district, bole } = await seedOrganization();

  const configured = process.env.SEED_PASSWORD;
  if (isProd && !configured) throw new Error("SEED_PASSWORD is required when seeding in production.");
  const password = configured ?? `Dev-${randomBytes(6).toString("hex")}9`;

  await upsertUser("admin@bank.local", "Super Admin", password, "SUPER_ADMIN", { scopeType: "ALL" });
  if (!isProd) {
    await upsertUser("sysadmin@bank.local", "System Admin", password, "SYSTEM_ADMIN", { scopeType: "ALL" });
    await upsertUser("head@bank.local", "Head Office Manager", password, "HEAD_OFFICE_MANAGER", {
      scopeType: "ALL",
    });
    await upsertUser("district@bank.local", "District 1 Manager", password, "DISTRICT_MANAGER", {
      scopeType: "DISTRICT",
      districtId: district.id,
    });
    await upsertUser("bole@bank.local", "Bole Branch Manager", password, "BRANCH_MANAGER", {
      scopeType: "BRANCH",
      branchId: bole.id,
    });
    await upsertUser("analyst@bank.local", "Feedback Analyst", password, "FEEDBACK_ANALYST", {
      scopeType: "ALL",
    });
  }

  if (!isProd) await seedSample(district.id, bole.id);

  console.log("Seed complete.");
  if (!configured) {
    console.log(
      `Demo users (admin@bank.local, sysadmin@, head@, district@, bole@, analyst@ — all @bank.local)`,
    );
    console.log(`Password for newly created users: ${password}`);
    console.log(
      "(Users that already existed keep their previous password. Set SEED_PASSWORD to choose one.)",
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
