-- M2: teams, managers, excluded numbers, and daily stats structure.

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table team_members (
  team_id uuid not null references teams (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete cascade,
  primary key (team_id, employee_id)
);

create table team_managers (
  team_id uuid not null references teams (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  primary key (team_id, user_id)
);

create table excluded_numbers (
  number text primary key,
  label text,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now()
);

create table jobs (
  id bigint generated always as identity primary key,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  attempts int not null default 0,
  last_error text,
  done_at timestamptz
);

create table daily_employee_stats (
  employee_id uuid not null references employees (id) on delete cascade,
  day date not null,
  calls_total int not null default 0,
  calls_incoming int not null default 0,
  calls_outgoing int not null default 0,
  calls_missed int not null default 0,
  calls_rejected int not null default 0,
  connected_calls int not null default 0,
  talk_seconds int not null default 0,
  unique_numbers int not null default 0,
  first_call_at timestamptz,
  last_call_at timestamptz,
  active_seconds int not null default 0,
  idle_seconds int not null default 0,
  computed_at timestamptz not null default now(),
  primary key (employee_id, day)
);

create index jobs_run_at on jobs (run_at);
create index jobs_done on jobs (done_at);
create index daily_employee_stats_day on daily_employee_stats (day);
