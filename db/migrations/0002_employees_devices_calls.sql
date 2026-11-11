-- M1, rewritten for MariaDB with companies in P1: panel logins, employees, paired phones and their company-SIM calls.

create table users (
  id uuid not null default uuid() primary key,
  -- Null only for a super admin (ReapLift), who belongs to no company.
  company_id int unsigned null,
  email varchar(254) not null,
  name varchar(200) not null,
  role varchar(20) not null,
  password_hash varchar(255) not null,
  disabled_at datetime(3) null,
  failed_login_count int null,
  login_locked_at datetime(3) null,
  last_login_at datetime(3) null,
  created_at datetime(3) not null default current_timestamp(3),
  unique key users_email (email),
  unique key users_company_id (company_id, id),
  constraint users_role check (role in ('super_admin', 'admin', 'manager')),
  constraint users_company_by_role check ((role = 'super_admin') = (company_id is null)),
  constraint users_company_fk foreign key (company_id) references companies (id)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table auth_sessions (
  id uuid not null default uuid() primary key,
  user_id uuid not null,
  token_hash char(64) not null,
  created_at datetime(3) not null,
  last_seen_at datetime(3) not null,
  expires_at datetime(3) not null,
  revoked_at datetime(3) null,
  user_agent varchar(500) null,
  ip_address varchar(64) null,
  -- A super admin's chosen company for this login (P1); null for everyone else, whose company is fixed.
  selected_company_id int unsigned null,
  unique key auth_sessions_token (token_hash),
  key auth_sessions_user (user_id),
  constraint auth_sessions_user_fk foreign key (user_id) references users (id) on delete cascade
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table audit_logs (
  id bigint unsigned not null auto_increment primary key,
  -- Null for a super admin's or the system's own actions.
  company_id int unsigned null,
  user_id uuid null,
  device_id uuid null,
  action varchar(100) not null,
  target_type varchar(50) null,
  target_id varchar(100) null,
  details json null,
  created_at datetime(3) not null default current_timestamp(3),
  key audit_logs_company_created (company_id, created_at),
  key audit_logs_created (created_at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table employees (
  id uuid not null default uuid() primary key,
  company_id int unsigned not null,
  name varchar(200) not null,
  emp_code varchar(50) null,
  company_number varchar(20) not null,
  crm_employee_id varchar(100) null,
  status varchar(10) not null default 'active',
  created_at datetime(3) not null default current_timestamp(3),
  left_at datetime(3) null,
  -- A company SIM number belongs to one active employee in one company (D11); someone who left frees it.
  -- MariaDB has no partial indexes, so a generated column holds the number only while active.
  active_number varchar(20) as (if(status = 'active', company_number, null)) stored,
  unique key employees_active_number (active_number),
  unique key employees_emp_code (company_id, emp_code),
  unique key employees_crm (company_id, crm_employee_id),
  unique key employees_company_id (company_id, id),
  key employees_company_status (company_id, status, name),
  constraint employees_status check (status in ('active', 'left')),
  constraint employees_company_fk foreign key (company_id) references companies (id)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table pairing_codes (
  id uuid not null default uuid() primary key,
  company_id int unsigned not null,
  employee_id uuid not null,
  -- 6 digits, so codes repeat over time; only a live (unused, unexpired) code must be unique, checked on create.
  code_hash char(64) not null,
  expires_at datetime(3) not null,
  used_at datetime(3) null,
  created_by uuid null,
  created_at datetime(3) not null default current_timestamp(3),
  key pairing_codes_code (code_hash),
  constraint pairing_codes_employee_fk foreign key (company_id, employee_id) references employees (company_id, id)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table devices (
  id uuid not null default uuid() primary key,
  company_id int unsigned not null,
  employee_id uuid not null,
  token_hash char(64) not null,
  brand varchar(100) null,
  model varchar(100) null,
  android_version varchar(20) null,
  sdk_int int null,
  app_version varchar(50) null,
  default_dialer varchar(200) null,
  sim_slot int null,
  sim_carrier varchar(100) null,
  phone_account_id varchar(200) null,
  consent_at datetime(3) not null,
  consent_version varchar(50) not null,
  paired_at datetime(3) not null,
  revoked_at datetime(3) null,
  last_sync_at datetime(3) null,
  last_checkin_at datetime(3) null,
  -- At most one live phone per employee: pairing a new one revokes the old one.
  live_employee_id uuid as (if(revoked_at is null, employee_id, null)) stored,
  unique key devices_token (token_hash),
  unique key devices_one_live (live_employee_id),
  unique key devices_company_id (company_id, id),
  key devices_employee (employee_id),
  constraint devices_employee_fk foreign key (company_id, employee_id) references employees (company_id, id)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table calls (
  id bigint unsigned not null auto_increment primary key,
  company_id int unsigned not null,
  employee_id uuid not null,
  device_id uuid not null,
  device_call_id varchar(64) not null,
  number varchar(32) not null,
  number_kind varchar(10) not null,
  contact_name varchar(200) null,
  type varchar(10) not null,
  started_at datetime(3) not null,
  talk_seconds int not null,
  ring_seconds int null,
  ended_at datetime(3) null,
  note text null,
  synced_at datetime(3) not null default current_timestamp(3),
  updated_at datetime(3) not null default current_timestamp(3),
  unique key calls_device_call (device_id, device_call_id),
  key calls_company_started (company_id, started_at),
  key calls_company_employee_started (company_id, employee_id, started_at),
  key calls_company_number_started (company_id, number, started_at),
  key calls_synced (synced_at),
  constraint calls_number_kind check (number_kind in ('mobile', 'other', 'private')),
  constraint calls_type check (type in ('incoming', 'outgoing', 'missed', 'rejected')),
  constraint calls_talk check (talk_seconds >= 0),
  constraint calls_ring check (ring_seconds >= 0),
  constraint calls_employee_fk foreign key (company_id, employee_id) references employees (company_id, id),
  constraint calls_device_fk foreign key (company_id, device_id) references devices (company_id, id)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
