create table if not exists public.faith_users (
  anonymous_user_id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.faith_events (
  id text primary key,
  anonymous_user_id text not null references public.faith_users (anonymous_user_id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_faith_events_user
  on public.faith_events (anonymous_user_id);

create index if not exists idx_faith_events_created_at
  on public.faith_events (created_at);

create table if not exists public.faith_consent_history (
  id text primary key,
  anonymous_user_id text not null references public.faith_users (anonymous_user_id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_faith_consent_user
  on public.faith_consent_history (anonymous_user_id);

create index if not exists idx_faith_consent_created_at
  on public.faith_consent_history (created_at);

create table if not exists public.faith_content_library (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.faith_users enable row level security;
alter table public.faith_events enable row level security;
alter table public.faith_consent_history enable row level security;
alter table public.faith_content_library enable row level security;

revoke all on table public.faith_users from anon, authenticated;
revoke all on table public.faith_events from anon, authenticated;
revoke all on table public.faith_consent_history from anon, authenticated;
revoke all on table public.faith_content_library from anon, authenticated;

grant all on table public.faith_users to service_role;
grant all on table public.faith_events to service_role;
grant all on table public.faith_consent_history to service_role;
grant all on table public.faith_content_library to service_role;
