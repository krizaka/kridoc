"use client";

import { KrizakaQueryProvider } from "@krizaka/query";
import type { ReactNode } from "react";

/** The client state of the account screens: @krizaka/query's provider (the mutations of the forms). */
export function AccountProviders({ children }: Readonly<{ children: ReactNode }>) {
  return <KrizakaQueryProvider>{children}</KrizakaQueryProvider>;
}
