CREATE TABLE IF NOT EXISTS sources (
  id text PRIMARY KEY, name text NOT NULL,
  terms_reference text NOT NULL, permitted_use text NOT NULL,
  enabled boolean NOT NULL DEFAULT true, review_by date NOT NULL
);
CREATE TABLE IF NOT EXISTS imports (
  id uuid PRIMARY KEY, source_id text NOT NULL REFERENCES sources(id),
  digest text NOT NULL, received integer NOT NULL, accepted integer NOT NULL DEFAULT 0,
  rejected integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id, digest)
);
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY, source_id text NOT NULL REFERENCES sources(id),
  external_id text NOT NULL, company text NOT NULL, segment text NOT NULL,
  city text NOT NULL, region text NOT NULL, budget integer CHECK (budget >= 0),
  note text NOT NULL, stage text NOT NULL DEFAULT 'new' CHECK(stage IN ('new','shortlisted','review','archived')),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id, external_id)
);
CREATE INDEX IF NOT EXISTS leads_filter ON leads(stage, segment, region, company, id);
CREATE TABLE IF NOT EXISTS rejects (
  import_id uuid NOT NULL REFERENCES imports(id), record_number integer NOT NULL, reason text NOT NULL,
  PRIMARY KEY(import_id, record_number)
);
CREATE TABLE IF NOT EXISTS audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES leads(id), action text NOT NULL,
  detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_lead ON audit(lead_id, id DESC);
