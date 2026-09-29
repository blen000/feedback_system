import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/admin/form-bits";
import type { FeedbackFilters } from "@/lib/validation/feedback";

export interface FilterOptions {
  districts: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  questionnaires: { id: string; title: string }[];
}
export interface AnswerFilterQuestion {
  ref: string;
  text: string;
  options: { value: string; label: string }[];
}

const L = ({ children }: { children: React.ReactNode }) => (
  <span className="mb-1 block text-xs font-medium text-muted-foreground">{children}</span>
);

/**
 * Plain GET form: filters live in the URL (shareable, bookmarkable) and work without client JS.
 * Choose a questionnaire and apply to reveal the answer filter for its choice questions.
 */
export function FilterBar({
  action,
  filters,
  options,
  answerQuestions,
  show = { search: true, rating: true, answer: true },
}: {
  action: string;
  filters: Partial<FeedbackFilters>;
  options: FilterOptions;
  answerQuestions?: AnswerFilterQuestion[];
  show?: { search?: boolean; rating?: boolean; answer?: boolean };
}) {
  const selectedQ = answerQuestions?.find((q) => q.ref === filters.questionRef);
  return (
    <form
      method="GET"
      action={action}
      className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {show.search ? (
        <label>
          <L>Search comments</L>
          <Input name="q" defaultValue={filters.q} placeholder="Text in answers…" maxLength={100} />
        </label>
      ) : null}
      <label>
        <L>From</L>
        <Input type="date" name="from" defaultValue={filters.from} />
      </label>
      <label>
        <L>To</L>
        <Input type="date" name="to" defaultValue={filters.to} />
      </label>
      <label>
        <L>Questionnaire</L>
        <NativeSelect name="questionnaireId" defaultValue={filters.questionnaireId ?? ""}>
          <option value="">All</option>
          {options.questionnaires.map((q) => (
            <option key={q.id} value={q.id}>
              {q.title}
            </option>
          ))}
        </NativeSelect>
      </label>
      {options.districts.length > 0 ? (
        <label>
          <L>District</L>
          <NativeSelect name="districtId" defaultValue={filters.districtId ?? ""}>
            <option value="">All</option>
            {options.districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </label>
      ) : null}
      <label>
        <L>Branch</L>
        <NativeSelect name="branchId" defaultValue={filters.branchId ?? ""}>
          <option value="">All</option>
          {options.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </NativeSelect>
      </label>
      {show.rating ? (
        <>
          <label>
            <L>Sentiment</L>
            <NativeSelect name="sentiment" defaultValue={filters.sentiment ?? ""}>
              <option value="">Any</option>
              <option value="POSITIVE">Positive</option>
              <option value="NEUTRAL">Neutral</option>
              <option value="NEGATIVE">Negative</option>
            </NativeSelect>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label>
              <L>Min rating</L>
              <Input
                type="number"
                name="minRating"
                min={1}
                max={5}
                step="0.5"
                defaultValue={filters.minRating}
              />
            </label>
            <label>
              <L>Max rating</L>
              <Input
                type="number"
                name="maxRating"
                min={1}
                max={5}
                step="0.5"
                defaultValue={filters.maxRating}
              />
            </label>
          </div>
        </>
      ) : null}
      {show.answer && answerQuestions && answerQuestions.length > 0 ? (
        <>
          <label>
            <L>Question</L>
            <NativeSelect name="questionRef" defaultValue={filters.questionRef ?? ""}>
              <option value="">—</option>
              {answerQuestions.map((q) => (
                <option key={q.ref} value={q.ref}>
                  {q.text}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            <L>Answer</L>
            <NativeSelect name="answer" defaultValue={filters.answer ?? ""}>
              <option value="">—</option>
              {(selectedQ?.options ?? answerQuestions.flatMap((q) => q.options)).map((o, i) => (
                <option key={`${o.value}-${i}`} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </label>
        </>
      ) : null}
      {show.search ? (
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            name="followUp"
            value="1"
            defaultChecked={!!filters.followUp}
            className="size-4"
          />
          Follow-up requested
        </label>
      ) : null}
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit">Apply filters</Button>
        <Button type="button" variant="outline" render={<Link href={action} />}>
          Reset
        </Button>
      </div>
    </form>
  );
}

/** Serializes filters (without the page) into a query string for links and exports. */
export function filtersToQuery(f: Partial<FeedbackFilters>, extra: Record<string, string> = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, page: undefined, ...extra })) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  return sp.toString();
}
