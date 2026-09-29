"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAction } from "./use-action";
import type { ActionResult } from "@/server/actions/helpers";

/** Button + confirmation dialog for destructive or session-affecting actions. */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "destructive",
  size = "sm",
  action,
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: "destructive" | "outline" | "ghost";
  size?: "sm" | "xs" | "default";
  action: () => Promise<ActionResult<unknown>>;
}) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant={variant === "outline" ? "default" : "destructive"}
              disabled={pending}
              onClick={() => run(action, () => setOpen(false))}
            >
              {pending ? "Working…" : confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
