"use client";

import { useState } from "react";
import { MonitorIcon, SmartphoneIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QuestionnaireForm } from "@/components/feedback/questionnaire-form";
import type { QuestionnaireDefinition } from "@/lib/questionnaire/types";

/** Renders exactly what customers see. Submitting only validates — nothing is stored. */
export function PreviewDialog({
  definition,
  onClose,
}: {
  definition: QuestionnaireDefinition;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"mobile" | "desktop">("mobile");
  // remount the form to reset answers when the device toggle is used
  const [run, setRun] = useState(0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Preview</DialogTitle>
          <DialogDescription>
            Try it as a customer would. Answers are validated but never saved.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={mode === "mobile" ? "default" : "outline"}
            onClick={() => {
              setMode("mobile");
              setRun((n) => n + 1);
            }}
          >
            <SmartphoneIcon /> Mobile
          </Button>
          <Button
            size="sm"
            variant={mode === "desktop" ? "default" : "outline"}
            onClick={() => {
              setMode("desktop");
              setRun((n) => n + 1);
            }}
          >
            <MonitorIcon /> Desktop
          </Button>
        </div>
        <div className="overflow-auto rounded-lg bg-muted/40 p-4" style={{ maxHeight: "65vh" }}>
          <div
            className={
              mode === "mobile"
                ? "mx-auto w-[375px] max-w-full rounded-[28px] border-4 border-foreground/80 bg-background p-4"
                : "mx-auto w-full bg-background p-6"
            }
          >
            {definition.questions.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No active questions yet.</p>
            ) : (
              <QuestionnaireForm
                key={`${mode}-${run}`}
                definition={definition}
                submitLabel="Submit (preview)"
                onSubmit={() => {
                  toast.success("Preview only — validation passed and nothing was saved.");
                  setRun((n) => n + 1);
                }}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
