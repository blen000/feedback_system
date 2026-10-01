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
import {
  ALL_PERMISSIONS,
  incompletePermissions,
  permissionGroup,
  SYSTEM_ROLES,
} from "../src/lib/rbac/permissions";
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
/**
 * Production mode: NODE_ENV=production, or the --production flag (`npm run db:seed:prod`).
 * `prisma db seed` does not set NODE_ENV by itself, so a deployment must use the flag; otherwise
 * demo users and sample data would be created.
 */
const isProd = process.env.NODE_ENV === "production" || process.argv.includes("--production");

/** Demo accounts created for development only. */
const DEMO_EMAILS = [
  "sysadmin@bank.local",
  "head@bank.local",
  "district@bank.local",
  "bole@bank.local",
  "analyst@bank.local",
];

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
    // Only SUPER_ADMIN is protected; the other built-in roles are ordinary, deletable roles.
    const isSystem = def.key === "SUPER_ADMIN";
    let existing = await prisma.role.findUnique({ where: { key: def.key } });
    if (existing && existing.isSystem !== isSystem) {
      existing = await prisma.role.update({ where: { id: existing.id }, data: { isSystem } });
    }
    const role =
      existing ??
      (await prisma.role.create({
        data: { key: def.key, name: def.name, description: def.description, isSystem },
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

/**
 * Keeps stored roles consistent with the permission catalog:
 *  - permissions the application no longer enforces are removed (with their role grants),
 *  - a role holding a permission without its prerequisites (e.g. reports.view without feedback.view) is
 *    reported. It is NOT widened automatically: sign-in already ignores the orphaned permissions, and an
 *    administrator decides whether to add the prerequisites or drop the permission in /admin/roles.
 */
async function reconcileRoles() {
  const removed = await prisma.permission.deleteMany({ where: { key: { notIn: ALL_PERMISSIONS } } });
  if (removed.count) console.log(`Removed ${removed.count} obsolete permission(s).`);

  const roles = await prisma.role.findMany({
    where: { deletedAt: null },
    include: { permissions: { include: { permission: { select: { key: true } } } } },
  });
  for (const role of roles) {
    const gaps = incompletePermissions(role.permissions.map((p) => p.permission.key));
    if (!gaps.length) continue;
    console.warn(
      `Role ${role.key} has permissions without their prerequisites (they have no effect until fixed in /admin/roles):`,
    );
    for (const g of gaps) console.warn(`  ${g.key} needs ${g.missing.join(", ")}`);
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
  opts: { applyPassword: boolean; mustChangePassword: boolean },
) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findUnique({ where: { email } });
  const user = existing
    ? // An explicit SEED_PASSWORD is re-applied so the old password stops working; without one, existing accounts are left alone.
      opts.applyPassword
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash,
            mustChangePassword: opts.mustChangePassword,
            status: "ACTIVE",
            deletedAt: null,
          },
        })
      : existing
    : await prisma.user.create({
        data: { email, name, passwordHash, mustChangePassword: opts.mustChangePassword },
      });
  if (existing && opts.applyPassword) {
    await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }); // old sign-ins end
  }
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
  await reconcileRoles();
  const { district, bole } = await seedOrganization();

  const configured = process.env.SEED_PASSWORD;
  if (isProd && !configured) throw new Error("SEED_PASSWORD is required when seeding in production.");
  const password = configured ?? `Dev-${randomBytes(6).toString("hex")}9`;

  // With an explicit SEED_PASSWORD the seeded accounts are (re)set to it. In production the admin must
  // choose their own password at first sign-in, so the shared seed password is only ever a bootstrap.
  const opts = { applyPassword: !!configured, mustChangePassword: isProd };
  await upsertUser("admin@bank.local", "Super Admin", password, "SUPER_ADMIN", { scopeType: "ALL" }, opts);
  if (!isProd) {
    const demo = { applyPassword: !!configured, mustChangePassword: false };
    await upsertUser(
      "sysadmin@bank.local",
      "System Admin",
      password,
      "SYSTEM_ADMIN",
      { scopeType: "ALL" },
      demo,
    );
    await upsertUser(
      "head@bank.local",
      "Head Office Manager",
      password,
      "HEAD_OFFICE_MANAGER",
      { scopeType: "ALL" },
      demo,
    );
    await upsertUser(
      "district@bank.local",
      "District 1 Manager",
      password,
      "DISTRICT_MANAGER",
      { scopeType: "DISTRICT", districtId: district.id },
      demo,
    );
    await upsertUser(
      "bole@bank.local",
      "Bole Branch Manager",
      password,
      "BRANCH_MANAGER",
      { scopeType: "BRANCH", branchId: bole.id },
      demo,
    );
    await upsertUser(
      "analyst@bank.local",
      "Feedback Analyst",
      password,
      "FEEDBACK_ANALYST",
      { scopeType: "ALL" },
      demo,
    );
    await seedSample(district.id, bole.id);
  } else {
    // Production: no demo accounts may be usable. Any that exist from an earlier development
    // database are deactivated (not deleted) and signed out; sample data is never created.
    const demo = await prisma.user.findMany({
      where: { email: { in: DEMO_EMAILS }, status: "ACTIVE" },
      select: { id: true, email: true },
    });
    if (demo.length) {
      await prisma.user.updateMany({
        where: { id: { in: demo.map((u) => u.id) } },
        data: { status: "INACTIVE" },
      });
      await prisma.session.updateMany({
        where: { userId: { in: demo.map((u) => u.id) }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      console.log(`Deactivated demo accounts: ${demo.map((u) => u.email).join(", ")}`);
    }
  }

  console.log("Seed complete.");
  if (configured) {
    console.log(
      isProd
        ? "Super admin: admin@bank.local — signs in with SEED_PASSWORD and must choose a new password immediately."
        : "Seeded accounts (admin@, sysadmin@, head@, district@, bole@, analyst@ — all @bank.local) now use SEED_PASSWORD.",
    );
  } else {
    console.log("Demo users (admin@, sysadmin@, head@, district@, bole@, analyst@ — all @bank.local)");
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
