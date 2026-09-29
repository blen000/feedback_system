import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteFeedbackButton } from "@/components/feedback/delete-feedback-button";
import { ForwardButton } from "@/components/feedback/forward-button";
import { SentimentBadge, Stars } from "@/components/feedback/rating";
import { AccessDenied, PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pageAccess } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { getFeedbackDetail } from "@/server/services/feedback-admin";

export const metadata: Metadata = { title: "Feedback details" };

export default async function FeedbackDetailPage({ params }: PageProps<"/admin/feedback/[id]">) {
  const { id } = await params;
  const { ctx, allowed } = await pageAccess("feedback.view");
  if (!allowed) return <AccessDenied />;

  let f;
  try {
    f = await getFeedbackDetail(ctx, id);
  } catch (e) {
    // out-of-scope records look exactly like missing ones
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }

  const rows: [string, React.ReactNode][] = [
    ["Location", f.location.label],
    ...(f.location.district && f.location.district !== f.location.label
      ? ([["District", f.location.district]] as [string, React.ReactNode][])
      : []),
    ["Questionnaire", `${f.questionnaire} (v${f.version})`],
    [
      "Submitted",
      f.submittedAt.toLocaleString("en-GB", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "Africa/Addis_Ababa",
      }),
    ],
    ["Overall rating", <Stars key="r" value={f.overallRating} />],
    ["Sentiment", <SentimentBadge key="s" value={f.sentiment} />],
    ["Language", f.locale.toUpperCase()],
  ];

  return (
    <>
      <PageHeader
        title="Feedback details"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" render={<Link href="/admin/feedback" />}>
              Back to list
            </Button>
            {f.canForward ? <ForwardButton feedbackId={f.id} /> : null}
            {f.canDelete ? <DeleteFeedbackButton id={f.id} /> : null}
          </div>
        }
      />
      {f.forwardedToMe ? (
        <div
          role="note"
          className="rounded-lg border border-[color:var(--brand-gold)]/50 bg-accent px-4 py-3 text-sm text-accent-foreground"
        >
          <p className="font-medium">
            Forwarded to you by {f.forwardedToMe.from} on{" "}
            {f.forwardedToMe.at.toLocaleDateString("en-GB", {
              dateStyle: "medium",
              timeZone: "Africa/Addis_Ababa",
            })}
          </p>
          {f.forwardedToMe.note ? <p className="mt-1 whitespace-pre-wrap">{f.forwardedToMe.note}</p> : null}
        </div>
      ) : null}
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k}</p>
              <div className="mt-0.5">{v}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Responses</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {f.answers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No answers were recorded.</p>
          ) : null}
          {f.answers.map((a) => (
            <div key={a.ref} className="border-b pb-3 last:border-0 last:pb-0">
              <p className="text-sm text-muted-foreground">{a.question}</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words font-medium">{a.answer}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {f.wantsFollowUp ? (
        <Card>
          <CardHeader>
            <CardTitle>Follow-up</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p>The customer asked to be contacted.</p>
            {f.contactPhone ? (
              <p>
                Phone: <span className="font-mono">{f.contactPhone}</span>
              </p>
            ) : (
              <p className="text-muted-foreground">
                {f.contactHidden
                  ? "A phone number was provided but you do not have permission to view contact details."
                  : "No contact details."}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
      {f.forwards.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Forwarded</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {f.forwards.map((x) => (
              <div key={x.id} className="border-b pb-2 last:border-0 last:pb-0">
                <p>
                  <span className="font-medium">{x.from}</span> → <span className="font-medium">{x.to}</span>{" "}
                  <span className="text-muted-foreground">
                    ·{" "}
                    {x.at.toLocaleString("en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Africa/Addis_Ababa",
                    })}
                  </span>{" "}
                  <Badge variant={x.read ? "secondary" : "outline"}>{x.read ? "Seen" : "Not seen yet"}</Badge>
                </p>
                {x.note ? <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{x.note}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
