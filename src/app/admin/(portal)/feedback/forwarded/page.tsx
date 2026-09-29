import type { Metadata } from "next";
import Link from "next/link";
import { SentimentBadge, Stars } from "@/components/feedback/rating";
import { AccessDenied, EmptyState, PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pageAccess } from "@/lib/auth/session";
import { listForwardedToMe } from "@/server/services/forwards";

export const metadata: Metadata = { title: "Forwarded to me" };

const fmt = (d: Date) =>
  d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Addis_Ababa" });

export default async function ForwardedPage() {
  const { ctx, allowed } = await pageAccess("feedback.view");
  if (!allowed) return <AccessDenied />;
  const rows = await listForwardedToMe(ctx);
  return (
    <>
      <PageHeader title="Forwarded to me" description="Feedback that colleagues have sent to you." />
      {rows.length === 0 ? (
        <EmptyState
          title="Nothing forwarded yet"
          description="When a colleague forwards feedback to you it will appear here."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Forwarded</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Note</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className={r.read ? "" : "bg-accent/40"}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {fmt(r.forwardedAt)} {r.read ? null : <Badge className="ml-1">New</Badge>}
                  </TableCell>
                  <TableCell>{r.from}</TableCell>
                  <TableCell className="font-medium">{r.location}</TableCell>
                  <TableCell className="space-x-2 whitespace-nowrap">
                    <Stars value={r.overallRating} />
                    <SentimentBadge value={r.sentiment} />
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-sm text-muted-foreground">
                    {r.note ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      render={<Link href={`/admin/feedback/${r.feedbackId}`} />}
                    >
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
