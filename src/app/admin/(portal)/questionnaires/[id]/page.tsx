import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDenied, PageHeader } from "@/components/admin/page-header";
import { QuestionnaireBuilder } from "@/components/questionnaire/builder";
import { pageAccess } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { can } from "@/lib/rbac/authorize";
import { listQuestions } from "@/server/services/questions";
import { getQuestionnaireEditor, listAssignableLocations } from "@/server/services/questionnaires";
import { pick } from "@/lib/questionnaire/types";

export const metadata: Metadata = { title: "Questionnaire" };

export default async function QuestionnaireBuilderPage({ params }: PageProps<"/admin/questionnaires/[id]">) {
  const { id } = await params;
  const { ctx, allowed } = await pageAccess("questionnaire.view");
  if (!allowed) return <AccessDenied />;

  let editor;
  try {
    editor = await getQuestionnaireEditor(ctx, id);
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "VALIDATION")) notFound();
    throw e;
  }

  const [library, locations] = await Promise.all([
    can(ctx, "question.view") ? listQuestions(ctx) : [],
    can(ctx, "questionnaire.publish") ? listAssignableLocations(ctx) : null,
  ]);

  return (
    <>
      <PageHeader
        title={pick(editor.meta.title, editor.meta.defaultLocale) || "Questionnaire"}
        description="Build, preview and publish a feedback form."
      />
      <QuestionnaireBuilder
        // remount when the server-side lifecycle changes so local editing state resets
        key={`${editor.status}-${editor.latestVersion}`}
        initial={editor}
        library={library}
        locations={locations}
        perms={{
          update: can(ctx, "questionnaire.update"),
          publish: can(ctx, "questionnaire.publish"),
          delete: can(ctx, "questionnaire.delete"),
        }}
      />
    </>
  );
}
