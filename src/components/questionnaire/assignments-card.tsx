"use client";

import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, NativeSelect } from "@/components/admin/form-bits";
import { useAction } from "@/components/admin/use-action";
import { ALL_LOCATIONS } from "@/lib/validation/location";
import { setAssignmentsAction } from "@/server/actions/questionnaires";

type ScopeType = "ALL" | "DISTRICT" | "BRANCH" | "DEPARTMENT";
export interface AssignmentItem {
  scopeType: ScopeType;
  id?: string;
  label: string;
}
export interface LocationOptions {
  districts: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  canAssignAll: boolean;
}

/**
 * Where this questionnaire is shown. QR codes identify a location, and each location
 * shows its currently ACTIVE questionnaire — so administrators can change forms without reprinting QR codes.
 */
export function AssignmentsCard({
  questionnaireId,
  initial,
  options,
  editable,
}: {
  questionnaireId: string;
  initial: AssignmentItem[];
  options: LocationOptions | null;
  editable: boolean;
}) {
  const { run, pending, error } = useAction();
  const [items, setItems] = useState<AssignmentItem[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [scope, setScope] = useState<ScopeType>(
    options?.canAssignAll ? "ALL" : options?.districts.length ? "DISTRICT" : "BRANCH",
  );
  const list =
    scope === "DISTRICT"
      ? options?.districts
      : scope === "BRANCH"
        ? options?.branches
        : scope === "DEPARTMENT"
          ? options?.departments
          : [];
  const [target, setTarget] = useState("");

  function add() {
    const picked = scope === "ALL" ? undefined : target || ALL_LOCATIONS;
    if (scope !== "ALL" && !picked) return;
    const noun = scope === "DISTRICT" ? "District" : scope === "BRANCH" ? "Branch" : "Department";
    const name = list?.find((l) => l.id === picked)?.name ?? "";
    const label =
      scope === "ALL"
        ? "Entire bank (default)"
        : picked === ALL_LOCATIONS
          ? `All ${noun.toLowerCase()}${noun === "Branch" ? "es" : "s"}`
          : `${noun}: ${name}`;
    if (items.some((i) => i.scopeType === scope && i.id === picked)) return;
    setItems((cur) => [
      // "All" supersedes individually listed locations of the same kind
      ...(picked === ALL_LOCATIONS ? cur.filter((i) => i.scopeType !== scope) : cur),
      { scopeType: scope, id: picked, label },
    ]);
    setDirty(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where it is shown</CardTitle>
        <CardDescription>
          The most specific location wins: branch or department, then district, then bank-wide. Only one
          active questionnaire per location.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not assigned to any location yet.</p>
        ) : null}
        <ul className="flex flex-wrap gap-2">
          {items.map((a, i) => (
            <li
              key={`${a.scopeType}-${a.id ?? "all"}`}
              className="flex items-center gap-1 rounded-full border bg-muted/50 py-1 pl-3 pr-1 text-sm"
            >
              {a.label}
              {editable ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${a.label}`}
                  onClick={() => {
                    setItems((c) => c.filter((_, idx) => idx !== i));
                    setDirty(true);
                  }}
                >
                  <XIcon />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>

        {editable && options ? (
          <div className="flex flex-wrap items-end gap-2">
            <NativeSelect
              className="w-auto"
              aria-label="Location type"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as ScopeType);
                setTarget("");
              }}
            >
              {options.canAssignAll ? <option value="ALL">Entire bank</option> : null}
              {options.districts.length ? <option value="DISTRICT">District</option> : null}
              {options.branches.length ? <option value="BRANCH">Branch</option> : null}
              {options.departments.length ? <option value="DEPARTMENT">Department</option> : null}
            </NativeSelect>
            {scope !== "ALL" ? (
              <NativeSelect
                className="w-auto min-w-40"
                aria-label="Location"
                value={target || ALL_LOCATIONS}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value={ALL_LOCATIONS}>
                  {scope === "DISTRICT"
                    ? "All districts"
                    : scope === "BRANCH"
                      ? "All branches"
                      : "All departments"}
                </option>
                {list?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={add}>
              <PlusIcon /> Add
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!dirty || pending}
              onClick={() =>
                run(
                  () =>
                    setAssignmentsAction(
                      questionnaireId,
                      items.map((i) => ({ scopeType: i.scopeType, id: i.id })),
                    ),
                  () => setDirty(false),
                )
              }
            >
              {pending ? "Saving…" : "Save locations"}
            </Button>
          </div>
        ) : null}
        <FormError message={error} />
      </CardContent>
    </Card>
  );
}
