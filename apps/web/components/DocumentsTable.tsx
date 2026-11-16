"use client";

import { DataTable, type DataTableColumn } from "@krizaka/ui/data-table";
import { useMemo } from "react";

import type { DocumentView } from "@/lib/storage/document-service";

export interface DocumentsLabels {
  caption: string;
  title: string;
  type: string;
  size: string;
  added: string;
  kilobytes: string;
}

const KB = 1024;

/** The signed-in person's documents on @krizaka/ui's table: newest first, sortable. */
export function DocumentsTable({
  documents,
  labels,
}: Readonly<{ documents: DocumentView[]; labels: DocumentsLabels }>) {
  const columns = useMemo<DataTableColumn<DocumentView>[]>(
    () => [
      { id: "title", header: labels.title, sortable: true, card: "title", value: (d) => d.title },
      { id: "mediaType", header: labels.type, value: (d) => d.mediaType },
      {
        id: "size",
        header: labels.size,
        align: "end",
        sortable: true,
        value: (d) => d.sizeBytes,
        cell: (d) => `${Math.max(1, Math.round(d.sizeBytes / KB))} ${labels.kilobytes}`,
      },
      {
        id: "createdAt",
        header: labels.added,
        align: "end",
        sortable: true,
        value: (d) => d.createdAt,
        cell: (d) => d.createdAt.slice(0, 10),
      },
    ],
    [labels],
  );
  return (
    <DataTable
      caption={labels.caption}
      rows={documents}
      columns={columns}
      getRowId={(d) => d.id}
      rowLabel={(d) => d.title}
      defaultSort={{ column: "createdAt", direction: "descending" }}
    />
  );
}
