import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pageAccess } from "@/lib/auth/session";
import { listAuditLogs } from "@/server/services/audit";

export const metadata: Metadata = { title: "Audit logs" };

export default async function AuditLogsPage({ searchParams }: PageProps<"/admin/audit-logs">) {
  const { ctx } = await pageAccess("audit.view");

  const sp = await searchParams;
  const page = Math.max(Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1, 1);
  const { rows, total, pageSize } = await listAuditLogs(ctx, { page });
  const pages = Math.max(Math.ceil(total / pageSize), 1);

  return (
    <>
      <PageHeader title="Audit logs" description="Who did what, and when. Entries cannot be edited." />
      {rows.length === 0 ? (
        <EmptyState title="No audit entries yet" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm">{r.createdAt.toLocaleString()}</TableCell>
                  <TableCell className="text-sm">{r.actor ? `${r.actor.name}` : "—"}</TableCell>
                  <TableCell>
                    <Badge
                      variant={r.severity === "HIGH" || r.severity === "CRITICAL" ? "destructive" : "outline"}
                    >
                      {r.severity}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{r.action}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{r.resource}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.ip ?? "—"}</TableCell>
                  <TableCell className="max-w-xs truncate font-mono text-xs text-muted-foreground">
                    {r.metadata ? JSON.stringify(r.metadata) : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Page {page} of {pages} · {total} entries
        </span>
        <div className="flex gap-2">
          {page > 1 ? (
            <Button variant="outline" size="sm" render={<Link href={`/admin/audit-logs?page=${page - 1}`} />}>
              Previous
            </Button>
          ) : null}
          {page < pages ? (
            <Button variant="outline" size="sm" render={<Link href={`/admin/audit-logs?page=${page + 1}`} />}>
              Next
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}
