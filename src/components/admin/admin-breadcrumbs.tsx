"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

const LABELS: Record<string, string> = {
  admin: "Admin",
  dashboard: "Dashboard",
  districts: "Districts",
  branches: "Branches",
  departments: "Departments",
  users: "Users",
  roles: "Roles",
  "audit-logs": "Audit logs",
  questionnaires: "Questionnaires",
  questions: "Question library",
  "qr-codes": "QR codes",
  feedback: "Feedback",
  forwarded: "Forwarded to me",
  reports: "Reports",
};

export function AdminBreadcrumbs() {
  const segments = usePathname().split("/").filter(Boolean);
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {segments.map((seg, i) => {
          const href = `/${segments.slice(0, i + 1).join("/")}`;
          const label = LABELS[seg] ?? seg;
          const last = i === segments.length - 1;
          return (
            <Fragment key={href}>
              <BreadcrumbItem>
                {last ? (
                  <BreadcrumbPage>{label}</BreadcrumbPage>
                ) : seg === "admin" ? (
                  <span className="text-muted-foreground">{label}</span>
                ) : (
                  <BreadcrumbLink render={<Link href={href} />}>{label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {last ? null : <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
