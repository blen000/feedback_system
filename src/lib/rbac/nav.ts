import type { NavGroup } from "@/components/admin/admin-sidebar";
import { can, type AuthContext } from "./authorize";
import type { PermissionKey } from "./permissions";

export type NavItem = NavGroup["items"][number] & { permission: PermissionKey };

/**
 * The admin menu. Each entry is shown only to users holding its permission, and the page behind the
 * href opens with the same permission (a test keeps the two in step). Order = priority for the landing page.
 */
export const NAV: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/admin/dashboard", label: "Dashboard", icon: "dashboard", permission: "dashboard.view" },
    ],
  },
  {
    label: "Feedback",
    items: [
      { href: "/admin/feedback", label: "All feedback", icon: "feedback", permission: "feedback.view" },
      {
        href: "/admin/feedback/forwarded",
        label: "Forwarded to me",
        icon: "forwarded",
        permission: "feedback.view",
      },
      { href: "/admin/reports", label: "Reports", icon: "reports", permission: "reports.view" },
    ],
  },
  {
    label: "Questionnaires",
    items: [
      {
        href: "/admin/questionnaires",
        label: "All questionnaires",
        icon: "questionnaire",
        permission: "questionnaire.view",
      },
      { href: "/admin/questions", label: "Question library", icon: "library", permission: "question.view" },
    ],
  },
  {
    items: [{ href: "/admin/qr-codes", label: "QR codes", icon: "qr", permission: "qr.view" }],
  },
  {
    label: "Locations",
    items: [
      { href: "/admin/districts", label: "Districts", icon: "district", permission: "district.view" },
      { href: "/admin/branches", label: "Branches", icon: "branch", permission: "branch.view" },
      { href: "/admin/departments", label: "Departments", icon: "department", permission: "department.view" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/users", label: "Users", icon: "users", permission: "user.view" },
      { href: "/admin/roles", label: "Roles", icon: "roles", permission: "role.view" },
      { href: "/admin/audit-logs", label: "Audit logs", icon: "audit", permission: "audit.view" },
    ],
  },
];

/** First page the user may open, for the landing redirect (null = nothing assigned). */
export function firstAllowedHref(ctx: AuthContext): string | null {
  for (const g of NAV) for (const i of g.items) if (can(ctx, i.permission)) return i.href;
  return null;
}
