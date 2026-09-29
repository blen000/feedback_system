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
  settings: ["view", "update"],
} as const;

type Catalog = typeof PERMISSION_CATALOG;
export type PermissionKey = {
  [G in keyof Catalog]: `${G & string}.${Catalog[G][number]}`;
}[keyof Catalog];

export const ALL_PERMISSIONS: PermissionKey[] = Object.entries(PERMISSION_CATALOG).flatMap(
  ([group, actions]) => actions.map((a) => `${group}.${a}` as PermissionKey),
);

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
      ...only(
        "user",
        "role",
        "branch",
        "district",
        "department",
        "qr",
        "question",
        "questionnaire",
        "settings",
      ),
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
