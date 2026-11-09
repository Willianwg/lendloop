"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useId, useState } from "react";
import {
  charCount,
  TOOL_DESCRIPTION_MAX,
  TOOL_NAME_MAX,
  type ToolTextErrors,
  validateToolText,
} from "@/app/(app)/tools/_lib/tool-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORIES, CONDITIONS, type Category, type Condition } from "@/convex/lib/constants";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

export type ToolFormValues = { name: string; category: Category; condition: Condition; description: string };

export type ToolFormProps = {
  initial?: Partial<ToolFormValues>;
  submitLabel: string;
  pendingLabel: string;
  cancelHref: string;
  /** Saves the values; a thrown Convex error is shown inline above the buttons. */
  onSubmit: (values: ToolFormValues) => Promise<void>;
};

/**
 * The listing form for /tools/new and /tools/[id]/edit. Limits match the server (trimmed,
 * counted in characters), with live counters; the server still validates everything.
 */
export function ToolForm({ initial, submitLabel, pendingLabel, cancelHref, onSubmit }: ToolFormProps) {
  const id = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState<Category | "">(initial?.category ?? "");
  const [condition, setCondition] = useState<Condition>(initial?.condition ?? "good");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [touched, setTouched] = useState({ name: false, description: false, category: false });
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const textErrors: ToolTextErrors = validateToolText({ name, description });
  const categoryError = category ? undefined : "Pick a category.";
  const show = {
    name: (touched.name || submitted) && textErrors.name,
    description: (touched.description || submitted) && textErrors.description,
    category: (touched.category || submitted) && categoryError,
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (textErrors.name || textErrors.description || !category || saving) return;
    setSaving(true);
    try {
      await onSubmit({ name: name.trim(), category, condition, description: description.trim() });
    } catch (err) {
      setServerError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-6">
      <Field
        id={`${id}-name`}
        label="Name"
        hint="What neighbors would search for, e.g. “Cordless drill with two batteries”."
        error={show.name || undefined}
        counter={<Counter value={name} max={TOOL_NAME_MAX} />}
      >
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, name: true }))}
          aria-invalid={Boolean(show.name)}
          aria-describedby={`${id}-name-hint ${id}-name-error`}
          autoComplete="off"
          className="h-11 text-base md:h-10 md:text-sm"
        />
      </Field>

      <Field id={`${id}-category`} label="Category" error={show.category || undefined}>
        <Select
          value={category}
          onValueChange={(v) => {
            setCategory(v as Category);
            setTouched((t) => ({ ...t, category: true }));
          }}
        >
          <SelectTrigger
            id={`${id}-category`}
            aria-invalid={Boolean(show.category)}
            aria-describedby={`${id}-category-error`}
            className="h-11 w-full text-base data-[size=default]:h-11 md:w-64 md:text-sm md:data-[size=default]:h-10"
          >
            <SelectValue placeholder="Choose a category" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Condition</legend>
        <div className="grid grid-cols-4 gap-2 sm:flex">
          {CONDITIONS.map((c) => (
            <label
              key={c.value}
              className={cn(
                "relative flex h-11 cursor-pointer items-center justify-center rounded-lg border bg-card px-4 text-sm font-medium transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50 md:h-10",
                condition === c.value
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
            >
              <input
                type="radio"
                name={`${id}-condition`}
                value={c.value}
                checked={condition === c.value}
                onChange={() => setCondition(c.value)}
                className="sr-only"
              />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>

      <Field
        id={`${id}-description`}
        label="Description"
        hint="Anything a borrower should know: what's included, quirks, where to pick it up."
        error={show.description || undefined}
        counter={<Counter value={description} max={TOOL_DESCRIPTION_MAX} />}
      >
        <Textarea
          id={`${id}-description`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, description: true }))}
          aria-invalid={Boolean(show.description)}
          aria-describedby={`${id}-description-hint ${id}-description-error`}
          rows={4}
          className="min-h-28 text-base md:text-sm"
        />
      </Field>

      {serverError ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <p>{serverError}</p>
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="ghost" size="lg" className="h-11 md:h-10">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        <Button type="submit" size="lg" disabled={saving} className="h-11 px-5 md:h-10">
          {saving ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  counter,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  counter?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {counter}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  const count = charCount(value);
  const over = count > max;
  return (
    <span className={cn("text-xs tabular-nums", over ? "font-medium text-destructive" : "text-muted-foreground")}>
      {count}/{max}
    </span>
  );
}
