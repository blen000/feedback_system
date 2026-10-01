import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { QuestionnairesList } from "@/components/questionnaire/questionnaires-list";
import { pageAccess } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { listQuestionnaires } from "@/server/services/questionnaires";

export const metadata: Metadata = { title: "Questionnaires" };

export default async function QuestionnairesPage() {
  const { ctx } = await pageAccess("questionnaire.view");
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
