"use client";

import { isKrizakaApiError, krizakaFetch, useMutation } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { createKrizakaForm } from "@krizaka/ui/form";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

const WHOLE = /^\d{1,6}$/;
const whole = z.string().trim().regex(WHOLE);

const storageForm = createKrizakaForm({
  schema: z.object({
    maxMb: whole,
    signedUrlSeconds: whole,
    retentionDays: whole,
    quotaMb: whole,
    quotaObjects: whole,
    scanTimeoutSeconds: whole,
    octetStream: z.boolean(),
    pdf: z.boolean(),
    png: z.boolean(),
    jpeg: z.boolean(),
    webp: z.boolean(),
    text: z.boolean(),
  }),
  defaultValues: {
    maxMb: "",
    signedUrlSeconds: "",
    retentionDays: "",
    quotaMb: "",
    quotaObjects: "",
    scanTimeoutSeconds: "",
    octetStream: false,
    pdf: false,
    png: false,
    jpeg: false,
    webp: false,
    text: false,
  },
});

/** The form's checkboxes and the content types they stand for: the types are identifiers, the only words are the labels' catalogue. */
const TYPE_FIELDS = {
  octetStream: "application/octet-stream",
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  text: "text/plain",
} as const;

export interface Bounds {
  min: number;
  max: number;
}

export interface StorageSettingsFormProps {
  locale: string;
  labels: {
    title: string;
    maxMb: { label: string; hint: string };
    signedUrlSeconds: { label: string; hint: string };
    retentionDays: { label: string; hint: string };
    quotaMb: { label: string; hint: string };
    quotaObjects: { label: string; hint: string };
    scanTimeoutSeconds: { label: string; hint: string };
    types: { legend: string; hint: string };
    save: string;
    saved: string;
    failed: string;
  };
  /** The values now, and the bounds the server enforces (drawn from the registry by the page). */
  current: {
    maxMb: number;
    signedUrlSeconds: number;
    retentionDays: number;
    quotaMb: number;
    quotaObjects: number;
    scanTimeoutSeconds: number;
    types: readonly string[];
  };
}

const DEFAULTS_OF = (current: StorageSettingsFormProps["current"]) => ({
  maxMb: String(current.maxMb),
  signedUrlSeconds: String(current.signedUrlSeconds),
  retentionDays: String(current.retentionDays),
  quotaMb: String(current.quotaMb),
  quotaObjects: String(current.quotaObjects),
  scanTimeoutSeconds: String(current.scanTimeoutSeconds),
  ...Object.fromEntries(Object.entries(TYPE_FIELDS).map(([field, type]) => [field, current.types.includes(type)])),
});

/** The form's values as the settings API takes them: the numbers as numbers, the ticked boxes as the accepted types. */
function changesOf(values: Record<string, unknown>): Record<string, unknown> {
  const types = Object.entries(TYPE_FIELDS)
    .filter(([field]) => values[field])
    .map(([, type]) => type);
  return {
    "storage.maxMb": Number(values.maxMb),
    "storage.signedUrlSeconds": Number(values.signedUrlSeconds),
    "storage.retentionDays": Number(values.retentionDays),
    "storage.quotaMb": Number(values.quotaMb),
    "storage.quotaObjects": Number(values.quotaObjects),
    "storage.scanTimeoutSeconds": Number(values.scanTimeoutSeconds),
    "storage.allowedTypes": types,
  };
}

const NUMBER_FIELDS = [
  "maxMb",
  "signedUrlSeconds",
  "retentionDays",
  "quotaMb",
  "quotaObjects",
  "scanTimeoutSeconds",
] as const;

/** The administrator's storage settings on @krizaka/ui's form. The server checks the bounds and answers a refusal in the visitor's language. */
export function StorageSettingsForm({ locale, labels, current }: Readonly<StorageSettingsFormProps>) {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const request = useMutation({
    mutationFn: (changes: Record<string, unknown>) =>
      krizakaFetch("/api/admin/storage-settings", { method: "PUT", json: { changes } }),
    onSuccess: () => router.refresh(),
  });
  const form = storageForm.useForm({
    i18n: { locale },
    defaultValues: DEFAULTS_OF(current) as never,
    onSubmit: async (values) => {
      setProblem(null);
      setSaved(false);
      try {
        await request.mutateAsync(changesOf(values));
        setSaved(true);
      } catch (error) {
        setProblem(isKrizakaApiError(error) && error.detail ? error.detail : labels.failed);
      }
    },
  });
  return (
    <form.Form aria-label={labels.title} className="flex flex-col gap-4">
      {NUMBER_FIELDS.map((field) => (
        <form.TextField
          key={field}
          name={field}
          label={labels[field].label}
          hint={labels[field].hint}
          inputMode="numeric"
        />
      ))}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-fg">{labels.types.legend}</legend>
        {Object.entries(TYPE_FIELDS).map(([field, type]) => (
          <form.Checkbox key={field} name={field as keyof typeof TYPE_FIELDS} label={type} />
        ))}
        <p className="text-sm text-fg-muted">{labels.types.hint}</p>
      </fieldset>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      {saved ? <Alert tone="success">{labels.saved}</Alert> : null}
      <form.Submit size="lg">{labels.save}</form.Submit>
    </form.Form>
  );
}
