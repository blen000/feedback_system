"use server";

import { runAction } from "./helpers";
import * as questions from "@/server/services/questions";
import * as qn from "@/server/services/questionnaires";

const LIST = "/admin/questionnaires";
const LIBRARY = "/admin/questions";

export async function saveQuestionAction(id: string | null, input: unknown) {
  return runAction(
    async (ctx) => {
      if (id) {
        await questions.updateQuestion(ctx, id, input);
        return null;
      }
      return (await questions.createQuestion(ctx, input)).question;
    },
    { revalidate: [LIBRARY, LIST], message: id ? "Question updated." : "Question added to the library." },
  );
}
export async function deleteQuestionAction(id: string) {
  return runAction((ctx) => questions.deleteQuestion(ctx, id), {
    revalidate: [LIBRARY],
    message: "Question deleted.",
  });
}

export async function createQuestionnaireAction(input: unknown) {
  return runAction((ctx) => qn.createQuestionnaire(ctx, input), { revalidate: [LIST] });
}
export async function saveDraftAction(id: string, input: unknown) {
  return runAction((ctx) => qn.saveDraft(ctx, id, input), {
    revalidate: [LIST, `${LIST}/${id}`],
    message: "Draft saved.",
  });
}
/** Builds the customer view from the saved draft. Writes nothing. */
export async function previewAction(id: string) {
  return runAction((ctx) => qn.previewDefinition(ctx, id));
}
export async function publishAction(id: string) {
  return runAction((ctx) => qn.publishQuestionnaire(ctx, id), {
    revalidate: [LIST, `${LIST}/${id}`],
    message: "Published. Assign locations and activate it to start collecting feedback.",
  });
}
export async function activateAction(id: string) {
  return runAction((ctx) => qn.activateQuestionnaire(ctx, id), {
    revalidate: [LIST, `${LIST}/${id}`],
    message: "Questionnaire is now active.",
  });
}
export async function pauseAction(id: string) {
  return runAction((ctx) => qn.pauseQuestionnaire(ctx, id), {
    revalidate: [LIST, `${LIST}/${id}`],
    message: "Questionnaire paused.",
  });
}
export async function closeAction(id: string) {
  return runAction((ctx) => qn.closeQuestionnaire(ctx, id), {
    revalidate: [LIST, `${LIST}/${id}`],
    message: "Questionnaire closed.",
  });
}
export async function reopenAction(id: string) {
  return runAction((ctx) => qn.reopenQuestionnaire(ctx, id), {
    revalidate: [LIST, `${LIST}/${id}`],
    message: "Reopened as a draft. Publish again to create a new version.",
  });
}
export async function deleteQuestionnaireAction(id: string) {
  return runAction((ctx) => qn.deleteQuestionnaire(ctx, id), {
    revalidate: [LIST],
    message: "Questionnaire deleted.",
  });
}
export async function setAssignmentsAction(id: string, input: unknown) {
  return runAction((ctx) => qn.setAssignments(ctx, id, input), {
    revalidate: [`${LIST}/${id}`],
    message: "Locations updated.",
  });
}
