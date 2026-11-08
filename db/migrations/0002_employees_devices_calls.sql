-- M1: admin logins, employees, paired phones and their company-SIM calls.

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  role text not null check (role in ('admin', 'manager')),
  password_hash text not null,
  disabled_at timestamptz,
  failed_login_count int,
  login_locked_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create table auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  token_hash text not null unique,
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  ip_address text
);
create index auth_sessions_user on auth_sessions (user_id);

create table audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references users (id),
  device_id uuid,
  action text not null,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created on audit_logs (created_at);

create table employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emp_code text unique,
  company_number text not null,
  crm_employee_id text unique,
  status text not null default 'active' check (status in ('active', 'left')),
  created_at timestamptz not null default now(),
  left_at timestamptz
);
-- One active employee per company number; someone who left frees it.
create unique index employees_active_number on employees (company_number) where status = 'active';

create table pairing_codes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees (id),
  -- 6 digits, so codes repeat over time; only a live (unused, unexpired) code must be unique, checked on create.
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index pairing_codes_employee on pairing_codes (employee_id);
create index pairing_codes_live on pairing_codes (code_hash) where used_at is null;

create table devices (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees (id),
  token_hash text not null unique,
  brand text,
  model text,
  android_version text,
  sdk_int int,
  app_version text,
  default_dialer text,
  sim_slot int,
  sim_carrier text,
  phone_account_id text,
  consent_at timestamptz not null,
  consent_version text not null,
  paired_at timestamptz not null,
  revoked_at timestamptz,
  last_sync_at timestamptz,
  last_checkin_at timestamptz
);
-- At most one live phone per employee: pairing a new one revokes the old one.
create unique index devices_one_live on devices (employee_id) where revoked_at is null;

create table calls (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id),
  device_id uuid not null references devices (id),
  device_call_id text not null,
  number text not null,
  number_kind text not null check (number_kind in ('mobile', 'other', 'private')),
  contact_name text,
  type text not null check (type in ('incoming', 'outgoing', 'missed', 'rejected')),
  started_at timestamptz not null,
  talk_seconds int not null check (talk_seconds >= 0),
  ring_seconds int check (ring_seconds >= 0),
  ended_at timestamptz,
  note text,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, device_call_id)
);
create index calls_employee_started on calls (employee_id, started_at);
create index calls_number_started on calls (number, started_at);
create index calls_started on calls (started_at);
create index calls_synced on calls (synced_at);
