-- Kridoc's own users and sessions (krizaka-internal#3718): each product keeps its own accounts, never another product's store.
-- `session` is the shape of @krizaka/auth's sessions table (the cookie holds a random token, the table only its keyed hash).
-- Never edited once applied: a change is a new dated file.
CREATE TABLE account (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text        NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  password_hash    text        NOT NULL,
  locale           text        NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'en')),
  role             text        NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  -- LOCKED: sign-in is refused and live sessions stop opening, until an administrator sets ACTIVE again.
  status           text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED')),
  failed_sign_ins  integer     NOT NULL DEFAULT 0 CHECK (failed_sign_ins >= 0),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE session (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  token_hash  text        NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ip          text,
  user_agent  text
);
CREATE INDEX session_account_idx ON session (account_id);

-- The owner link the document migration left open: a document belongs to an account and goes with it.
ALTER TABLE document ADD CONSTRAINT document_owner_fk FOREIGN KEY (owner_id) REFERENCES account (id) ON DELETE CASCADE;
