"use client";

import { krizakaFetch, useMutation } from "@krizaka/query";
import { Button } from "@krizaka/ui/button";
import { useRouter } from "next/navigation";

/** Ends the session on the server (the cookie is cleared there), then goes to the sign-in. */
export function SignOutButton({ label, locale }: Readonly<{ label: string; locale: string }>) {
  const router = useRouter();
  const request = useMutation({
    mutationFn: () => krizakaFetch("/api/auth/sign-out", { method: "POST" }),
    onSuccess: () => {
      router.replace(`/${locale}/sign-in`);
      router.refresh();
    },
  });
  return (
    <Button variant="outline" onClick={() => request.mutate()} disabled={request.isPending}>
      {label}
    </Button>
  );
}
