import type { ReactNode } from "react";

import { AccountProviders } from "@/components/AccountProviders";

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AccountProviders>{children}</AccountProviders>;
}
