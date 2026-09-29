"use client";

import { Button } from "@/components/ui/button";
import { useAction } from "@/components/admin/use-action";
import { markNotificationsReadAction } from "@/server/actions/feedback";

export function MarkReadButton() {
  const { run, pending } = useAction();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => run(() => markNotificationsReadAction())}
    >
      Mark all read
    </Button>
  );
}
