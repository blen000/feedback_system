/**
 * Permission catalog — the single source of truth. Seeded into the Permission table;
 * authorization always reads granted permissions from the database, never from this list.
 */
export const PERMISSION_CATALOG = {
  dashboard: ["view"],
  feedback: ["view", "view_contact", "forward", "export", "delete"],
  questionnaire: ["view", "create", "update", "publish", "delete"],
  question: ["view", "create", "update", "delete"],
  qr: ["view", "create", "update", "delete"],
  branch: ["view", "create", "update", "delete"],
  district: ["view", "create", "update", "delete"],
  department: ["view", "create", "update", "delete"],
  user: ["view", "create", "update", "deactivate"],
  role: ["view", "create", "update", "delete"],
  reports: ["view", "export"],
  audit: ["view"],
} as const;

type Catalog = typeof PERMISSION_CATALOG;
export type PermissionKey = {
  [G in keyof Catalog]: `${G & string}.${Catalog[G][number]}`;
}[keyof Catalog];

export const ALL_PERMISSIONS: PermissionKey[] = Object.entries(PERMISSION_CATALOG).flatMap(
  ([group, actions]) => actions.map((a) => `${group}.${a}` as PermissionKey),
);

/**
 * Prerequisites. A permission is only useful (and only effective) when the role also holds the
 * permissions it depends on, because the page that hosts the feature is opened with `<group>.view`.
 * Without this a role could hold "user.update" yet see no Users menu, or "reports.view" and be sent
 * to a 403 page. Enforced in three places: the role editor (ticking selects prerequisites), the role
 * service (rejects incomplete roles) and sign-in (an incomplete legacy role simply grants less).
 */
const REQUIRES: Partial<Record<PermissionKey, PermissionKey[]>> = {};
for (const [group, actions] of Object.entries(PERMISSION_CATALOG)) {
  if (!(actions as readonly string[]).includes("view")) continue;
  for (const a of actions)
    if (a !== "view") REQUIRES[`${group}.${a}` as PermissionKey] = [`${group}.view` as PermissionKey];
}
// feedback.* are sub-features of the Feedback pages, and reports are built from feedback data
REQUIRES["reports.view"] = ["feedback.view"];
REQUIRES["reports.export"] = ["reports.view", "feedback.view"];
// forms that pick a district cannot work if the actor may not list districts
REQUIRES["branch.create"] = ["branch.view", "district.view"];
REQUIRES["branch.update"] = ["branch.view", "district.view"];
REQUIRES["department.create"] = ["department.view", "district.view"];
REQUIRES["department.update"] = ["department.view", "district.view"];
// the questionnaire builder is where questions are chosen
REQUIRES["questionnaire.update"] = ["questionnaire.view", "question.view"];

export const PERMISSION_REQUIRES: Readonly<Partial<Record<PermissionKey, readonly PermissionKey[]>>> =
  REQUIRES;

/** Every permission `key` needs (directly or indirectly), excluding itself. */
export function prerequisitesOf(key: string): PermissionKey[] {
  const out = new Set<PermissionKey>();
  const walk = (k: string) => {
    for (const r of PERMISSION_REQUIRES[k as PermissionKey] ?? []) {
      if (!out.has(r)) {
        out.add(r);
        walk(r);
      }
    }
  };
  walk(key);
  return [...out];
}

/** Every permission that (directly or indirectly) depends on `key`. */
export function dependentsOf(key: string): PermissionKey[] {
  return ALL_PERMISSIONS.filter((p) => prerequisitesOf(p).includes(key as PermissionKey));
}

/** Permissions of `granted` whose prerequisites are all present too (unknown keys are dropped). */
export function effectivePermissions(granted: Iterable<string>): Set<string> {
  const known = new Set<string>(ALL_PERMISSIONS);
  const set = new Set([...granted].filter((k) => known.has(k)));
  for (let changed = true; changed;) {
    changed = false;
    for (const p of [...set]) {
      if (prerequisitesOf(p).some((r) => !set.has(r))) {
        set.delete(p);
        changed = true;
      }
    }
  }
  return set;
}

/**
 * Per-assignment permission sets for one user. Prerequisites are checked against everything the user
 * holds (across all assignments): a contact-details grant over one branch needs the user to be able to
 * open Feedback at all, but not necessarily through the same role. Orphaned permissions are dropped.
 */
export function effectiveAssignmentPermissions(sets: readonly Iterable<string>[]): Set<string>[] {
  const materialized = sets.map((s) => new Set(s));
  const effective = effectivePermissions(materialized.flatMap((s) => [...s]));
  return materialized.map((s) => new Set([...s].filter((k) => effective.has(k))));
}

/** Permissions of `granted` that lack a prerequisite, with what is missing (for validation messages). */
export function incompletePermissions(granted: Iterable<string>): { key: string; missing: string[] }[] {
  const set = new Set(granted);
  return [...set].flatMap((key) => {
    const missing = prerequisitesOf(key).filter((r) => !set.has(r));
    return missing.length ? [{ key, missing }] : [];
  });
}

export function permissionGroup(key: string): string {
  return key.split(".")[0];
}

export interface SystemRoleDefinition {
  key: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
}

const only = (...groups: (keyof Catalog)[]) =>
  ALL_PERMISSIONS.filter((p) => groups.includes(permissionGroup(p) as keyof Catalog));

/** Default permission sets for seeded roles. Administrators may edit these in /admin/roles. */
export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    key: "SUPER_ADMIN",
    name: "Super Admin",
    description: "Unrestricted access to every feature.",
    permissions: ALL_PERMISSIONS,
  },
  {
    key: "SYSTEM_ADMIN",
    name: "System Admin",
    description: "Manages users, roles, organization, questionnaires and QR codes. No feedback data access.",
    permissions: [
      "dashboard.view",
      ...only("user", "role", "branch", "district", "department", "qr", "question", "questionnaire"),
      "audit.view",
    ],
  },
  {
    key: "HEAD_OFFICE_MANAGER",
    name: "Head Office Manager",
    description: "Bank-wide visibility, questionnaire management and reporting.",
    permissions: [
      "dashboard.view",
      "feedback.view",
      "feedback.view_contact",
      "feedback.forward",
      "feedback.export",
      "questionnaire.view",
      "questionnaire.create",
      "questionnaire.update",
      "questionnaire.publish",
      "question.view",
      "question.create",
      "question.update",
      "qr.view",
      "branch.view",
      "district.view",
      "department.view",
      "reports.view",
      "reports.export",
    ],
  },
  {
    key: "DISTRICT_MANAGER",
    name: "District Manager",
    description: "Feedback, QR codes and reports for the assigned district.",
    permissions: [
      "dashboard.view",
      "feedback.view",
      "feedback.view_contact",
      "feedback.forward",
      "feedback.export",
      "questionnaire.view",
      "qr.view",
      "branch.view",
      "district.view",
      "department.view",
      "reports.view",
      "reports.export",
    ],
  },
  {
    key: "BRANCH_MANAGER",
    name: "Branch Manager",
    description: "Feedback and reports for the assigned branch only.",
    permissions: [
      "dashboard.view",
      "feedback.view",
      "feedback.view_contact",
      "feedback.forward",
      "questionnaire.view",
      "qr.view",
      "branch.view",
      "reports.view",
    ],
  },
  {
    key: "FEEDBACK_ANALYST",
    name: "Feedback Analyst",
    description: "Read and export feedback and reports within the assigned scope.",
    permissions: [
      "dashboard.view",
      "feedback.view",
      "feedback.export",
      "questionnaire.view",
      "question.view",
      "branch.view",
      "district.view",
      "department.view",
      "reports.view",
      "reports.export",
    ],
  },
];
