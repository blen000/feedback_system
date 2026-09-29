"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenIcon,
  BuildingIcon,
  BarChart3Icon,
  ClipboardListIcon,
  MessageSquareTextIcon,
  SendIcon,
  QrCodeIcon,
  KeyRoundIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MapPinIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { BrandMark } from "@/components/brand/brand";
import { logoutAction } from "@/server/actions/auth";

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboardIcon,
  district: MapPinIcon,
  branch: LandmarkIcon,
  department: BuildingIcon,
  users: UsersIcon,
  roles: ShieldCheckIcon,
  audit: ScrollTextIcon,
  questionnaire: ClipboardListIcon,
  library: BookOpenIcon,
  qr: QrCodeIcon,
  feedback: MessageSquareTextIcon,
  forwarded: SendIcon,
  reports: BarChart3Icon,
};

export interface NavGroup {
  label?: string;
  items: { href: string; label: string; icon: keyof typeof ICONS; badge?: number }[];
}

export function AdminSidebar({
  groups,
  user,
}: {
  groups: NavGroup[];
  user: { name: string; email: string };
}) {
  const pathname = usePathname();
  const activeHref = groups
    .flatMap((g) => g.items.map((i) => i.href))
    .filter((h) => pathname === h || pathname.startsWith(`${h}/`))
    .sort((a, b) => b.length - a.length)[0];
  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <div className="flex items-center gap-2 font-semibold text-primary">
          <BrandMark className="size-9" />
          Feedback Portal
        </div>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g, i) => (
          <SidebarGroup key={g.label ?? i}>
            {g.label ? <SidebarGroupLabel>{g.label}</SidebarGroupLabel> : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const Icon = ICONS[item.icon];
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={item.href === activeHref}
                        render={<Link href={item.href} />}
                      >
                        <Icon />
                        <span>{item.label}</span>
                        {item.badge ? <SidebarMenuBadge>{item.badge}</SidebarMenuBadge> : null}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t">
        <div className="px-2 py-1 text-sm">
          <p className="truncate font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/admin/change-password" />}>
              <KeyRoundIcon />
              <span>Change password</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <form action={logoutAction}>
              <SidebarMenuButton type="submit">
                <LogOutIcon />
                <span>Sign out</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
