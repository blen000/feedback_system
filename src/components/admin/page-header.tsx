import * as React from "react";
import { ShieldAlertIcon } from "lucide-react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

/** Shown when a signed-in user opens a page they hold no permission for. No data is loaded. */
export function AccessDenied() {
  return (
    <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-3 text-center">
      <ShieldAlertIcon className="size-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold">Access denied</h1>
      <p className="text-sm text-muted-foreground">
        You do not have permission to view this page. If you believe this is a mistake, contact your
        administrator.
      </p>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <p className="font-medium">{title}</p>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}
