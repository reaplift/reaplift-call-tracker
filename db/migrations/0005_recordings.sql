-- M6: call recordings. The phone's own dialer records; the app finds the file for a company-SIM call and uploads it
-- straight to object storage (Cloudflare R2, D6) with a short-lived link from the server. Audio never passes
-- through the server. One row per call: uploaded, waiting for its upload, or missing.
-- Retention (D4, owner 11 November 2026): R2's lifecycle rule deletes objects 365 days after upload; these rows stay,
-- and the server answers 410 RECORDING_EXPIRED for an older one.

alter table calls add unique key calls_company_id (company_id, id);

create table recordings (
  id uuid not null default uuid() primary key,
  company_id int unsigned not null,
  call_id bigint unsigned not null,
  status varchar(20) not null,
  object_key varchar(300) null,
  size_bytes bigint unsigned null,
  audio_seconds int null,
  mime_type varchar(100) null,
  match_score int null,
  reported_at datetime(3) not null default current_timestamp(3),
  uploaded_at datetime(3) null,
  deleted_at datetime(3) null,
  unique key recordings_call (call_id),
  key recordings_company_status (company_id, status),
  constraint recordings_status check (status in ('pending_upload', 'uploaded', 'missing')),
  constraint recordings_call_fk foreign key (company_id, call_id) references calls (company_id, id)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
