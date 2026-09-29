"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/server/actions/helpers";

/**
 * Runs a server action, surfaces its outcome as a toast, exposes field errors,
 * and refreshes server data on success. Authorization is enforced by the action itself.
 */
export function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function run<T>(action: () => Promise<ActionResult<T>>, onSuccess?: (data: T | undefined) => void) {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        if (result.message) toast.success(result.message);
        onSuccess?.(result.data);
        router.refresh();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        if (!result.fieldErrors) toast.error(result.error);
      }
    });
  }

  function reset() {
    setError(null);
    setFieldErrors({});
  }

  return { run, pending, error, fieldErrors, reset };
}
