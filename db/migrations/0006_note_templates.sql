-- After-call pop-up (client, 12 November 2026): ready-made notes per company. The employee types "/" or taps one to
-- insert it into the comment. A company's admin manages them in the panel's Settings page.

create table note_templates (
  id uuid not null default uuid() primary key,
  company_id int unsigned not null,
  text varchar(200) not null,
  sort_order int not null default 0,
  active tinyint(1) not null default 1,
  created_at datetime(3) not null default current_timestamp(3),
  unique key note_templates_text (company_id, text),
  constraint note_templates_company_fk foreign key (company_id) references companies (id)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

insert into note_templates (company_id, text, sort_order)
select co.id, d.text, d.sort_order
from companies co
cross join (
  select 'Not reachable' as text, 1 as sort_order union all
  select 'Asked to call back later', 2 union all
  select 'Interested, sending details on WhatsApp', 3 union all
  select 'Site visit planned', 4 union all
  select 'Not interested', 5 union all
  select 'Wrong number', 6
) d;
