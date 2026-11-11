-- P1 (D10, D11): MariaDB 11.8. Replaces the PostgreSQL 0001, allowed once because nothing was deployed
-- (tracker decision log, 11 November 2026). The migration runner creates schema_migrations itself.
--
-- Conventions for every table (data-model-and-api.md):
--   times are datetime(3) in UTC (every connection sets time_zone = '+00:00');
--   ids are uuid with default uuid(), or bigint unsigned auto_increment for high-volume tables;
--   company data carries company_id, and links between company rows use composite foreign keys
--   (company_id, x_id), so the database itself refuses a link across two companies.

-- A client company. id is the CRM's company number (set by hand, not auto-numbered), so both systems agree.
create table companies (
  id int unsigned not null primary key,
  name varchar(200) not null,
  status varchar(20) not null default 'active',
  created_at datetime(3) not null default current_timestamp(3),
  constraint companies_status check (status in ('active', 'suspended'))
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
