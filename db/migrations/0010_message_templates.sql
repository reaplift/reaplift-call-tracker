-- M10 (client, 12 and 13 November 2026): WhatsApp message templates. A company's admins write fixed messages with
-- blanks ({{name}}, {{employee_name}}, {{company_name}}, {{follow_up_date}} and any custom blank). After a call the
-- employee picks one, fills what the app doesn't know, checks it, and WhatsApp opens with the text; the employee
-- presses WhatsApp's own send button. message_sends records that WhatsApp was opened with that text (Callit can't
-- see whether it was delivered). New companies start with no templates (question W6, default).

create table message_templates (
  id uuid not null default uuid() primary key,
  company_id int unsigned not null,
  title varchar(100) not null,
  body text not null,
  sort_order int not null default 0,
  active tinyint(1) not null default 1,
  created_by uuid null,
  created_at datetime(3) not null default current_timestamp(3),
  updated_at datetime(3) not null default current_timestamp(3),
  unique key message_templates_title (company_id, title),
  unique key message_templates_company_id (company_id, id),
  constraint message_templates_company_fk foreign key (company_id) references companies (id)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table message_sends (
  id bigint unsigned not null auto_increment primary key,
  company_id int unsigned not null,
  employee_id uuid not null,
  device_id uuid not null,
  device_send_id varchar(64) not null,
  template_id uuid null,
  number varchar(32) not null,
  call_id bigint unsigned null,
  body text not null,
  app varchar(30) not null,
  opened_at datetime(3) not null,
  synced_at datetime(3) not null default current_timestamp(3),
  unique key message_sends_device (device_id, device_send_id),
  key message_sends_company_call (company_id, call_id),
  key message_sends_company_opened (company_id, opened_at),
  constraint message_sends_app check (app in ('whatsapp', 'whatsapp_business')),
  constraint message_sends_employee_fk foreign key (company_id, employee_id) references employees (company_id, id),
  constraint message_sends_device_fk foreign key (company_id, device_id) references devices (company_id, id)
  -- call_id has no foreign key: deleting a never-record number's calls also deletes its sends (M12).
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
