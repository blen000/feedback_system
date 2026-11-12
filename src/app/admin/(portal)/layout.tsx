import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminSidebar, type NavGroup } from "@/components/admin/admin-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { requireAuth } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { unreadForwardCount } from "@/server/services/forwards";
import { NAV } from "@/lib/rbac/nav";
import { SessionTimeout } from "@/components/auth/session-timeout";
import { SESSION_IDLE_MS } from "@/server/services/auth";

export default async function PortalLayout({ children }: LayoutProps<"/admin">) {
  const ctx = await requireAuth();
  if (ctx.mustChangePassword) redirect("/admin/change-password");

  const unreadForwards = can(ctx, "feedback.view") ? await unreadForwardCount(ctx) : 0;

  // Hiding links is a convenience only; every page and action re-checks permissions server-side.
  const groups: NavGroup[] = NAV.map((g) => ({
    label: g.label,
    items: g.items
      .filter((i) => can(ctx, i.permission))
      .map((i) => ({
        href: i.href,
        label: i.label,
        icon: i.icon,
        badge: i.icon === "forwarded" ? unreadForwards : undefined,
      })),
  })).filter((g) => g.items.length > 0);

  return (
    <SidebarProvider>
      <AdminSidebar groups={groups} user={{ name: ctx.name, email: ctx.email }} />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-[#e2d6c0] bg-[#efe6d4] px-4 dark:border-[#38302a] dark:bg-[#1f1a15] shadow-[0_1px_2px_rgba(60,40,20,0.05)]">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <AdminBreadcrumbs />
          <ThemeToggle className="ml-auto" />
        </header>
        <div className="min-w-0 flex-1 space-y-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
      <SessionTimeout idleMs={SESSION_IDLE_MS} />
    </SidebarProvider>
  );
}
