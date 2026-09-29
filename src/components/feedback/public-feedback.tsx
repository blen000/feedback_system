"use client";

import { useEffect, useState } from "react";
import { CheckCircle2Icon } from "lucide-react";
import { QuestionnaireForm, type FormSubmission } from "./questionnaire-form";
import { submitFeedbackAction } from "@/server/actions/public";
import type { QuestionnaireDefinition } from "@/lib/questionnaire/types";

const KIOSK_RESET_MS = 6000;

/**
 * Customer form + thank-you state. In kiosk mode (?kiosk=1) the thank-you screen resets
 * automatically so the next customer starts with a fresh form.
 */
export function PublicFeedback({
  code,
  definition,
  kiosk,
}: {
  code: string;
  definition: QuestionnaireDefinition;
  kiosk: boolean;
}) {
  const [done, setDone] = useState(false);
  const [round, setRound] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!done || !kiosk) return;
    const t = setTimeout(() => {
      setDone(false);
      setRound((n) => n + 1); // remount the form: all answers cleared
    }, KIOSK_RESET_MS);
    return () => clearTimeout(t);
  }, [done, kiosk]);

  async function submit(s: FormSubmission) {
    setBanner(null);
    setServerErrors({});
    try {
      const res = await submitFeedbackAction(code, s);
      if (res.ok) {
        setDone(true);
        return;
      }
      setServerErrors(res.fieldErrors ?? {});
      setBanner(res.error);
    } catch {
      // network failure: keep the customer's answers and let them retry
      setBanner("Something went wrong. Please try again.");
    }
  }

  if (done) {
    return (
      <div role="status" className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center">
        <CheckCircle2Icon className="size-16 text-green-600" aria-hidden />
        <h1 className="text-3xl font-semibold">Thank you!</h1>
        <p className="text-lg">Your feedback has been submitted successfully.</p>
        <p className="text-lg text-muted-foreground">Your voice helps us improve our service.</p>
      </div>
    );
  }

  return (
    <>
      <QuestionnaireForm key={round} definition={definition} onSubmit={submit} serverErrors={serverErrors} />
      {banner ? (
        <p
          role="alert"
          className="mx-auto mt-4 max-w-xl rounded-lg bg-destructive/10 px-4 py-3 text-center text-destructive"
        >
          {banner}
        </p>
      ) : null}
    </>
  );
}
