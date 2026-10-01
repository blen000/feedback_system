import { forbidden, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/session";
import { firstAllowedHref } from "@/lib/rbac/nav";

/** Landing page: send the user to the first page their permissions allow (not always the dashboard). */
export default async function AdminIndex() {
  const ctx = await requireAuth();
  if (ctx.mustChangePassword) redirect("/admin/change-password");
  const href = firstAllowedHref(ctx);
  if (!href) forbidden(); // signed in, but no role grants any page
  redirect(href);
}
