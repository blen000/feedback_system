"use client";

import { useEffect, useState } from "react";
import { SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormError, NativeSelect } from "@/components/admin/form-bits";
import { useAction } from "@/components/admin/use-action";
import { forwardFeedbackAction, listForwardRecipientsAction } from "@/server/actions/feedback";

interface Person {
  id: string;
  name: string;
  email: string;
}

/** Sends this feedback to a colleague with an optional note. The recipient gets it in "Forwarded to me". */
export function ForwardButton({ feedbackId }: { feedbackId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <SendIcon /> Forward
      </Button>
      {open ? <ForwardDialog feedbackId={feedbackId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ForwardDialog({ feedbackId, onClose }: { feedbackId: string; onClose: () => void }) {
  const { run, pending, error, fieldErrors } = useAction();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [to, setTo] = useState("");

  useEffect(() => {
    let alive = true;
    listForwardRecipientsAction().then((r) => {
      if (alive) setPeople(r.ok ? (r.data ?? []) : []);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Forward feedback</DialogTitle>
          <DialogDescription>
            The person you choose can open this feedback even if it is outside their usual locations. Phone
            numbers stay hidden unless they already have permission to see contact details.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(
              () => forwardFeedbackAction(feedbackId, { toUserId: to, note: f.get("note") || null }),
              onClose,
            );
          }}
        >
          <Field label="Forward to" htmlFor="to" errors={fieldErrors.toUserId}>
            <NativeSelect
              id="to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
              disabled={people === null}
            >
              <option value="">
                {people === null ? "Loading…" : people.length ? "Choose a person" : "No one available"}
              </option>
              {(people ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.email})
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Note (optional)" htmlFor="note" errors={fieldErrors.note}>
            <Textarea
              id="note"
              name="note"
              rows={3}
              maxLength={500}
              placeholder="Why are you sending this?"
            />
          </Field>
          <FormError message={Object.keys(fieldErrors).length ? null : error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !to}>
              {pending ? "Sending…" : "Forward"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
