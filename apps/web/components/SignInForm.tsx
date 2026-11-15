"use client";

import { isKrizakaApiError, krizakaFetch, useMutation } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { createKrizakaForm } from "@krizaka/ui/form";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

const signIn = createKrizakaForm({
  schema: z.object({ email: z.string().trim().min(1).email(), password: z.string().min(1) }),
  defaultValues: { email: "", password: "" },
});

export interface SignInLabels {
  title: string;
  email: string;
  password: string;
  submit: string;
  failed: string;
}

/** E-mail and password on @krizaka/ui's form; the server sets the session cookie and answers the refusal in the visitor's language. */
export function SignInForm({ labels, locale, next }: Readonly<{ labels: SignInLabels; locale: string; next: string }>) {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const request = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      krizakaFetch("/api/auth/sign-in", { method: "POST", json: body }),
    onSuccess: () => {
      router.replace(next);
      router.refresh();
    },
  });
  const form = signIn.useForm({
    i18n: { locale },
    onSubmit: async (values) => {
      setProblem(null);
      try {
        await request.mutateAsync(values);
      } catch (error) {
        setProblem(isKrizakaApiError(error) && error.detail ? error.detail : labels.failed);
      }
    },
  });
  return (
    <form.Form aria-label={labels.title} className="flex flex-col gap-4">
      <form.TextField name="email" label={labels.email} type="email" autoComplete="username" />
      <form.TextField name="password" label={labels.password} type="password" autoComplete="current-password" />
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      <form.Submit size="lg" className="w-full">
        {labels.submit}
      </form.Submit>
    </form.Form>
  );
}
