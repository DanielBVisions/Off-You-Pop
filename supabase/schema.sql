-- Off You Pop — data model
--
-- Mirrors docs/tech-spec.md §4 exactly (field names snake_case per SQL
-- convention; the API layer maps to/from the camelCase names used in
-- docs/api-contract.md and the plugin's payloads).
--
-- Everything lives in its own `off_you_pop` schema, not `public` — so this
-- is safe to run against an existing Supabase project that already has
-- other tables/apps in it (no free project slot needed just for this).
-- Idempotent guards (`if not exists` / `drop ... if exists`) make it safe
-- to re-run.
--
-- ONE-TIME MANUAL STEP after running this: in the Supabase dashboard, go
-- to Settings → API → "Exposed schemas" and add `off_you_pop` to the list
-- (PostgREST only serves `public` by default). Without this, every API
-- call will 404/406 against a schema PostgREST doesn't know to look in.

create extension if not exists pgcrypto; -- gen_random_uuid()

create schema if not exists off_you_pop;
set search_path to off_you_pop, public;

-- ---------------------------------------------------------------------------
-- team_members — dashboard users. id matches auth.users(id); Supabase Auth
-- owns credentials, this table just carries the Viewer/Admin role (tech
-- spec §3.5). No self-signup: an admin inserts a row (with a matching
-- auth.users account) for each teammate.
-- ---------------------------------------------------------------------------

create table if not exists team_members (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  name text not null,
  role text not null default 'viewer' check (role in ('viewer', 'admin')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- signoff_records
-- ---------------------------------------------------------------------------

create table if not exists signoff_records (
  id uuid primary key default gen_random_uuid(),
  project_name text not null,
  client_name text not null,
  scope_label text not null,
  scope_type text not null check (scope_type in ('single_frame', 'multi_frame', 'flow', 'branding')),
  figma_file_key text, -- needed for the branding-export Figma API call; not in the original tech spec table, added when wiring up that flow
  status text not null default 'sent'
    check (status in ('sent', 'partially_viewed', 'partially_signed', 'signed', 'locked', 'cancelled')),
  requires_all_recipients boolean not null default true,
  follows_signoff_id uuid references signoff_records (id),
  superseded_by uuid references signoff_records (id),
  notes text not null default '',
  created_at timestamptz not null default now(),
  created_by text not null,
  archived_at timestamptz
);

create index if not exists signoff_records_client_name_idx on signoff_records (client_name);
create index if not exists signoff_records_status_idx on signoff_records (status);
create index if not exists signoff_records_follows_idx on signoff_records (follows_signoff_id);

-- Locking (brief: "Locking... Once a record reaches 'signed,' it is
-- immutable. Further changes need a brand-new SignoffRecord... not an
-- edit.") Enforced here, not just in application code, because the audit
-- trail's evidentiary value depends on this holding even if a future code
-- path forgets to check it.
create or replace function signoff_records_enforce_locking() returns trigger as $$
begin
  if old.status in ('signed', 'locked') then
    if new.project_name is distinct from old.project_name
      or new.client_name is distinct from old.client_name
      or new.scope_label is distinct from old.scope_label
      or new.scope_type is distinct from old.scope_type
      or new.figma_file_key is distinct from old.figma_file_key
      or new.requires_all_recipients is distinct from old.requires_all_recipients
      or new.follows_signoff_id is distinct from old.follows_signoff_id
      or new.notes is distinct from old.notes
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
    then
      raise exception 'signoff_records: record % is signed and locked — create a new record (follows_signoff_id) instead of editing it', old.id;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists signoff_records_locking on signoff_records;
create trigger signoff_records_locking
  before update on signoff_records
  for each row execute function signoff_records_enforce_locking();

-- ---------------------------------------------------------------------------
-- frame_snapshots
-- ---------------------------------------------------------------------------

create table if not exists frame_snapshots (
  id uuid primary key default gen_random_uuid(),
  signoff_id uuid not null references signoff_records (id) on delete cascade,
  figma_frame_key text not null,
  figma_node_name text not null default '',
  snapshot_url text not null,
  sequence_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists frame_snapshots_signoff_idx on frame_snapshots (signoff_id, sequence_order);

-- ---------------------------------------------------------------------------
-- contacts — reusable across sign-offs, scoped to the whole team's account
-- (one Supabase project = one team, per the brief), keyed by email.
-- ---------------------------------------------------------------------------

-- email is stored lowercased by the API layer (never trust client casing)
-- so a plain column-level unique constraint is enough — and, unlike an
-- expression index on lower(email), it's something PostgREST's
-- ?on_conflict=email upsert can actually target.
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  client_name text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists contacts_search_idx on contacts (lower(name), lower(client_name));

-- ---------------------------------------------------------------------------
-- recipients — one row per email on a record; copies name/email at time of
-- sending so editing a Contact later never rewrites past records.
-- ---------------------------------------------------------------------------

create table if not exists recipients (
  id uuid primary key default gen_random_uuid(),
  signoff_id uuid not null references signoff_records (id) on delete cascade,
  contact_id uuid references contacts (id),
  email text not null,
  name text not null,
  status text not null default 'sent' check (status in ('sent', 'viewed', 'signed')),
  first_viewed_at timestamptz,
  signed_at timestamptz
);

create index if not exists recipients_signoff_idx on recipients (signoff_id);
create index if not exists recipients_email_idx on recipients (lower(email));

-- ---------------------------------------------------------------------------
-- event_log — append-only. "created" and "resent"/"archived" are
-- record-level (recipient_id null); "viewed"/"signed"/"certificate_downloaded"
-- are per-recipient.
-- ---------------------------------------------------------------------------

create table if not exists event_log (
  id uuid primary key default gen_random_uuid(),
  signoff_id uuid not null references signoff_records (id) on delete cascade,
  recipient_id uuid references recipients (id),
  event_type text not null check (
    event_type in ('created', 'viewed', 'signed', 'resent', 'archived', 'certificate_downloaded', 'export_triggered')
  ),
  occurred_at timestamptz not null default now(),
  ip_address text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists event_log_signoff_idx on event_log (signoff_id, occurred_at);

-- Append-only: block updates and deletes so the audit trail can't be
-- quietly edited after the fact.
create or replace function event_log_block_mutation() returns trigger as $$
begin
  raise exception 'event_log is append-only';
end;
$$ language plpgsql;

drop trigger if exists event_log_no_update on event_log;
create trigger event_log_no_update before update on event_log
  for each row execute function event_log_block_mutation();

drop trigger if exists event_log_no_delete on event_log;
create trigger event_log_no_delete before delete on event_log
  for each row execute function event_log_block_mutation();

-- ---------------------------------------------------------------------------
-- certificates — one per recipient sign-off, rendered on demand by the API
-- (no stored PDF). record_hash lets anyone verify a downloaded PDF's
-- content matches what's on file.
-- ---------------------------------------------------------------------------

create table if not exists certificates (
  id uuid primary key default gen_random_uuid(),
  signoff_id uuid not null references signoff_records (id) on delete cascade,
  recipient_id uuid not null references recipients (id) on delete cascade,
  signer_name text not null,
  signer_email text not null,
  signed_at timestamptz not null,
  ip_address text not null,
  approval_text text not null,
  snapshot_ids uuid[] not null default '{}',
  record_hash text not null,
  created_at timestamptz not null default now(),
  unique (recipient_id)
);

create index if not exists certificates_signoff_idx on certificates (signoff_id);

-- ---------------------------------------------------------------------------
-- branding_exports — only for scope_type = 'branding', only created after
-- sign-off (the API never inserts this row before the sign event fires).
-- ---------------------------------------------------------------------------

create table if not exists branding_exports (
  id uuid primary key default gen_random_uuid(),
  signoff_id uuid not null unique references signoff_records (id) on delete cascade,
  triggered_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'processing', 'complete', 'failed')),
  zip_url text,
  guidelines_pdf_url text,
  error_message text
);

-- ---------------------------------------------------------------------------
-- RLS — everything is locked down by default. The API only ever talks to
-- Supabase with the service_role key (server-side, never shipped to a
-- browser or the plugin), which bypasses RLS entirely by design in
-- Supabase — so these tables having no permissive policies is deliberate
-- defence-in-depth, not a bug: even if the anon/authenticated key ever
-- leaked client-side, PostgREST would return nothing.
-- ---------------------------------------------------------------------------

alter table team_members enable row level security;
alter table signoff_records enable row level security;
alter table frame_snapshots enable row level security;
alter table contacts enable row level security;
alter table recipients enable row level security;
alter table event_log enable row level security;
alter table certificates enable row level security;
alter table branding_exports enable row level security;
