import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { QuestionsManager } from "@/components/questionnaire/questions-manager";
import { pageAccess } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { listQuestions } from "@/server/services/questions";

export const metadata: Metadata = { title: "Question library" };

export default async function QuestionLibraryPage() {
  const { ctx } = await pageAccess("question.view");
  return (
    <>
      <PageHeader
        title="Question library"
        description="Reusable questions. Add them to any questionnaire without duplicating them."
      />
      <QuestionsManager
        rows={await listQuestions(ctx)}
        canCreate={can(ctx, "question.create")}
        canUpdate={can(ctx, "question.update")}
        canDelete={can(ctx, "question.delete")}
      />
    </>
  );
}
