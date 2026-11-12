-- M5: API keys for a company's own CRM (client, 12 November 2026). The CRM calls our Callyzer-compatible API
-- (/api/v2.3/...) with `Authorization: Bearer <key>`. Only a SHA-256 hash of the key is stored; the key itself is
-- shown once, when an admin creates it. A key reads one company's calls and nothing else.

create table api_keys (
  id uuid not null default uuid() primary key,
  company_id int unsigned not null,
  name varchar(100) not null,
  -- The first characters of the key, so an admin can tell keys apart without the key being stored.
  key_prefix varchar(16) not null,
  key_hash char(64) not null,
  created_by uuid null,
  created_at datetime(3) not null default current_timestamp(3),
  last_used_at datetime(3) null,
  revoked_at datetime(3) null,
  unique key api_keys_hash (key_hash),
  key api_keys_company (company_id, created_at),
  constraint api_keys_company_fk foreign key (company_id) references companies (id)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
