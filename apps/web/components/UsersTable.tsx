"use client";

import { Badge } from "@krizaka/ui/badge";
import { DataTable, type DataTableColumn } from "@krizaka/ui/data-table";
import { useMemo } from "react";

import type { AccountSummary } from "@/lib/auth/account-directory";

export interface UsersLabels {
  caption: string;
  email: string;
  role: string;
  status: string;
  documents: string;
  created: string;
  roles: Record<string, string>;
  states: Record<string, string>;
}

function usersColumns(labels: UsersLabels): DataTableColumn<AccountSummary>[] {
  return [
    { id: "email", header: labels.email, sortable: true, card: "title", value: (u) => u.email },
    {
      id: "role",
      header: labels.role,
      value: (u) => u.role,
      cell: (u) => <Badge tone={u.role === "ADMIN" ? "accent" : "neutral"}>{labels.roles[u.role]}</Badge>,
    },
    {
      id: "status",
      header: labels.status,
      value: (u) => u.status,
      cell: (u) => <Badge tone={u.status === "ACTIVE" ? "success" : "danger"}>{labels.states[u.status]}</Badge>,
    },
    { id: "documents", header: labels.documents, sortable: true, align: "end", value: (u) => u.documents },
    {
      id: "createdAt",
      header: labels.created,
      sortable: true,
      align: "end",
      value: (u) => u.createdAt,
      cell: (u) => u.createdAt.slice(0, 10),
    },
  ];
}

/** The accounts, read only: who, which role, active or locked, how many documents, since when. */
export function UsersTable({ users, labels }: Readonly<{ users: AccountSummary[]; labels: UsersLabels }>) {
  const columns = useMemo(() => usersColumns(labels), [labels]);
  return (
    <DataTable
      caption={labels.caption}
      rows={users}
      columns={columns}
      getRowId={(u) => u.id}
      rowLabel={(u) => u.email}
      defaultSort={{ column: "createdAt", direction: "descending" }}
    />
  );
}
