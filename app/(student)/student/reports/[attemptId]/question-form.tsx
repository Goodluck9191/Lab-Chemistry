"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { saveReportAnswersAction } from "@/application/attempts/actions";

/**
 * Report-question answers. Draft-only: the server refuses writes once the
 * attempt is submitted, and only declared question keys are stored.
 */
export function QuestionForm({
  attemptId,
  questions,
  errorSources,
  canWrite,
}: {
  attemptId: string;
  questions: Array<{ key: string; prompt: string; answer: string }>;
  errorSources: string;
  canWrite: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries([
      ...questions.map((question) => [question.key, question.answer]),
      ["_error_sources", errorSources],
    ]),
  );
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setProblem(null);
    startTransition(async () => {
      const outcome = await saveReportAnswersAction(attemptId, values);
      if (outcome.status === "ok") {
        setSaved(true);
      } else {
        setProblem(outcome.message);
      }
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-3">
      {questions.map((question, index) => (
        <Field key={question.key} label={`Q${index + 1}. ${question.prompt}`} htmlFor={`answer-${question.key}`}>
          <Textarea
            id={`answer-${question.key}`}
            value={values[question.key] ?? ""}
            disabled={!canWrite || pending}
            onChange={(event) => {
              setValues((current) => ({ ...current, [question.key]: event.target.value }));
              setSaved(false);
            }}
            placeholder="Write your answer in your own words."
          />
        </Field>
      ))}
      <Field label="Sources of error (optional)" htmlFor="answer-error-sources">
        <Textarea
          id="answer-error-sources"
          value={values._error_sources ?? ""}
          disabled={!canWrite || pending}
          onChange={(event) => {
            setValues((current) => ({ ...current, _error_sources: event.target.value }));
            setSaved(false);
          }}
          placeholder="e.g. KHP loss during transfer, burette reading error, endpoint overshoot…"
        />
      </Field>
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={handleSave} disabled={pending}>
            {pending ? "Saving…" : "Save answers"}
          </Button>
          {saved ? (
            <p className="text-xs text-muted" role="status">
              Answers saved.
            </p>
          ) : null}
          {problem ? <p className="text-xs text-danger">{problem}</p> : null}
        </div>
      ) : (
        <p className="text-xs text-muted">This attempt is submitted, so answers are read-only.</p>
      )}
    </div>
  );
}
