"use client";

import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/admin/confirm-dialog";
import { deleteFeedbackAction } from "@/server/actions/feedback";

export function DeleteFeedbackButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      label="Delete"
      size="default"
      title="Delete this feedback?"
      description="It is removed from lists, reports and exports. This is recorded in the audit log."
      confirmLabel="Delete feedback"
      action={async () => {
        const r = await deleteFeedbackAction(id);
        if (r.ok) router.push("/admin/feedback");
        return r;
      }}
    />
  );
}
