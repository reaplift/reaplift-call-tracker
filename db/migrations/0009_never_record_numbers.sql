-- M12 (client, 12 November 2026; built 13 November on the owner's go-ahead): numbers whose calls are never recorded
-- or kept, for example a director or a family member who calls an employee's company SIM. The phone drops these
-- calls before anything is stored for upload, as it does personal-SIM calls, and the server refuses any that still
-- arrive. Only the super admin manages the list. Phones get each number's SHA-256 hash, never the number.
-- Unlike excluded_numbers (stored, left out of reports), these calls are not stored at all.

create table never_record_numbers (
  company_id int unsigned not null,
  number varchar(32) not null,
  label varchar(100) null,
  created_by uuid null,
  created_at datetime(3) not null default current_timestamp(3),
  primary key (company_id, number),
  constraint never_record_numbers_company_fk foreign key (company_id) references companies (id)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
