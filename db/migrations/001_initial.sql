-- gap-radar initial schema
-- Run via: Supabase Dashboard > SQL Editor, or `supabase db push`

create extension if not exists "uuid-ossp";

-- -------------------------------------------------------
-- runs: each execution of the `discover` command
-- -------------------------------------------------------
create table if not exists runs (
  id           uuid primary key default uuid_generate_v4(),
  niche        text not null,
  location     text not null,
  profile      text not null check (profile in ('a', 'b')),
  max_results  integer not null default 50,
  min_rating   numeric(3,1) not null default 4.0,
  discovered   integer not null default 0,
  filtered     integer not null default 0,
  created_new  integer not null default 0,
  updated_existing integer not null default 0,
  status       text not null default 'running' check (status in ('running', 'completed', 'failed')),
  error        text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

-- -------------------------------------------------------
-- leads: one row per Place (dedupe by place_id)
-- -------------------------------------------------------
create table if not exists leads (
  id                      uuid primary key default uuid_generate_v4(),
  place_id                text not null unique,
  name                    text not null,
  formatted_address       text,
  rating                  numeric(3,1),
  user_rating_count       integer,
  website_uri             text,
  phone                   text,
  business_status         text,
  -- scoring (populated later in phase 3)
  score                   numeric(5,2),
  tags                    text[] not null default '{}',
  notes                   text,
  -- state machine
  state                   text not null default 'discovered'
                            check (state in ('discovered','contacted','qualified','disqualified')),
  -- discovery metadata (overwritten on re-discovery, but score/tags/notes are not)
  first_seen_run_id       uuid references runs(id),
  last_seen_run_id        uuid references runs(id),
  discovery_profile       text,
  -- raw snapshot from Places API (useful for debugging)
  raw_place_data          jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- keep updated_at fresh automatically
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leads_updated_at
  before update on leads
  for each row execute function set_updated_at();

-- indexes
create index if not exists leads_state_idx         on leads(state);
create index if not exists leads_rating_idx        on leads(rating desc);
create index if not exists leads_score_idx         on leads(score desc nulls last);
create index if not exists leads_last_run_idx      on leads(last_seen_run_id);
