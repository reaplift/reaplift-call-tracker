-- M2, rewritten for MariaDB with companies in P1: teams, managers, excluded numbers, jobs and daily stats.

create table teams (
  id uuid not null default uuid() primary key,
  company_id int unsigned not null,
  name varchar(100) not null,
  created_at datetime(3) not null default current_timestamp(3),
  unique key teams_name (company_id, name),
  unique key teams_company_id (company_id, id),
  constraint teams_company_fk foreign key (company_id) references companies (id)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

-- Both links carry company_id, so a team and an employee or manager from different companies cannot be joined.
create table team_members (
  company_id int unsigned not null,
  team_id uuid not null,
  employee_id uuid not null,
  primary key (team_id, employee_id),
  key team_members_employee (employee_id),
  constraint team_members_team_fk foreign key (company_id, team_id) references teams (company_id, id) on delete cascade,
  constraint team_members_employee_fk foreign key (company_id, employee_id) references employees (company_id, id) on delete cascade
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table team_managers (
  company_id int unsigned not null,
  team_id uuid not null,
  user_id uuid not null,
  primary key (team_id, user_id),
  key team_managers_user (user_id),
  constraint team_managers_team_fk foreign key (company_id, team_id) references teams (company_id, id) on delete cascade,
  constraint team_managers_user_fk foreign key (company_id, user_id) references users (company_id, id) on delete cascade
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table excluded_numbers (
  company_id int unsigned not null,
  number varchar(32) not null,
  label varchar(200) null,
  created_by uuid not null,
  created_at datetime(3) not null default current_timestamp(3),
  primary key (company_id, number),
  constraint excluded_numbers_company_fk foreign key (company_id) references companies (id),
  constraint excluded_numbers_user_fk foreign key (created_by) references users (id)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table jobs (
  id bigint unsigned not null auto_increment primary key,
  -- Null for a job that is not about one company.
  company_id int unsigned null,
  kind varchar(50) not null,
  payload json not null default '{}',
  run_at datetime(3) not null default current_timestamp(3),
  locked_at datetime(3) null,
  attempts int not null default 0,
  last_error text null,
  done_at datetime(3) null,
  key jobs_run_at (run_at),
  key jobs_done (done_at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table daily_employee_stats (
  company_id int unsigned not null,
  employee_id uuid not null,
  day date not null,
  calls_total int not null default 0,
  calls_incoming int not null default 0,
  calls_outgoing int not null default 0,
  calls_missed int not null default 0,
  calls_rejected int not null default 0,
  connected_calls int not null default 0,
  talk_seconds int not null default 0,
  unique_numbers int not null default 0,
  first_call_at datetime(3) null,
  last_call_at datetime(3) null,
  active_seconds int not null default 0,
  idle_seconds int not null default 0,
  computed_at datetime(3) not null default current_timestamp(3),
  primary key (employee_id, day),
  key daily_employee_stats_company_day (company_id, day),
  constraint daily_employee_stats_employee_fk foreign key (company_id, employee_id) references employees (company_id, id) on delete cascade
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
