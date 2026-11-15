-- Kridoc's own database (krizaka-internal#3717): the metadata of a stored document and its owner link, nothing else.
-- The file bytes are not here (object storage); the users are not here yet: `owner_id` is the id of an account of slice C
-- (krizaka-internal#3718), whose migration adds the foreign key. Never edited once applied: a change is a new dated file.
CREATE TABLE document (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid        NOT NULL,
  title       text        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  media_type  text        NOT NULL CHECK (length(media_type) BETWEEN 3 AND 127),
  size_bytes  bigint      NOT NULL CHECK (size_bytes >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The one read of the product: the owner's documents, newest first.
CREATE INDEX document_owner_created_idx ON document (owner_id, created_at DESC, id);
