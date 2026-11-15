-- The retention sweep's place (krizaka-internal#3755): the accounts' bytes are checked a bounded batch of owners per run, so the next run
-- starts after the last owner of the previous one. One row, `true` being its only key. Never edited once applied: a change is a new file.
CREATE TABLE storage_sweep_cursor (
  only_row    boolean     PRIMARY KEY DEFAULT true CHECK (only_row),
  last_owner  uuid,
  swept_at    timestamptz NOT NULL DEFAULT now()
);
