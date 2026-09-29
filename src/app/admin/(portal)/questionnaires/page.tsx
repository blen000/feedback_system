import type { Metadata } from "next";
import { AccessDenied, PageHeader } from "@/components/admin/page-header";
import { QuestionnairesList } from "@/components/questionnaire/questionnaires-list";
import { pageAccess } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { listQuestionnaires } from "@/server/services/questionnaires";

export const metadata: Metadata = { title: "Questionnaires" };

export default async function QuestionnairesPage() {
  const { ctx, allowed } = await pageAccess("questionnaire.view");
  if (!allowed) return <AccessDenied />;
  const rows = await listQuestionnaires(ctx);
  return (
    <>
      <PageHeader
        title="Questionnaires"
        description="Feedback forms shown to customers when they scan a QR code."
      />
      <QuestionnairesList
        canCreate={can(ctx, "questionnaire.create")}
        rows={rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }))}
      />
    </>
  );
}
