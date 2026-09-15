"use client";

import { useActionState } from "react";
import { signUpAction } from "@/application/auth/actions";
import { IDLE_AUTH_FORM_STATE } from "@/application/auth/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(signUpAction, IDLE_AUTH_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status === "error" && state.message ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : null}
      {state.status === "success" && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      <Field label="Full name" htmlFor="fullName">
        <Input id="fullName" name="fullName" autoComplete="name" required maxLength={120} />
      </Field>

      <Field
        label="Registration number"
        htmlFor="registrationNumber"
        hint="Optional. Your matriculation or index number."
      >
        <Input id="registrationNumber" name="registrationNumber" maxLength={40} />
      </Field>

      <Field label="Email address" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        hint="At least 8 characters. Accounts are always created as students."
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </Field>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
