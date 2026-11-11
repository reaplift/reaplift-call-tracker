-- M4 task 4.5 (owner, 11 November 2026): the after-call form. Each company has its own list of call outcomes;
-- a call gets an outcome, a comment (calls.note, from M1) and an optional follow-up date, written by the phone.

create table call_outcomes (
  id uuid not null default uuid() primary key,
  company_id int unsigned not null,
  label varchar(60) not null,
  sort_order int not null default 0,
  active tinyint(1) not null default 1,
  created_at datetime(3) not null default current_timestamp(3),
  unique key call_outcomes_label (company_id, label),
  unique key call_outcomes_company_id (company_id, id),
  constraint call_outcomes_company_fk foreign key (company_id) references companies (id)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

-- Every company starts with the same six; a company's admin can rename, add and switch them off.
insert into call_outcomes (company_id, label, sort_order)
select co.id, d.label, d.sort_order
from companies co
cross join (
  select 'Interested' as label, 1 as sort_order union all
  select 'Call back later', 2 union all
  select 'Not interested', 3 union all
  select 'No answer / busy', 4 union all
  select 'Wrong number', 5 union all
  select 'Other', 6
) d;

alter table calls
  add column outcome_id uuid null after note,
  add column follow_up_at datetime(3) null after outcome_id,
  add column commented_at datetime(3) null after follow_up_at,
  add key calls_company_commented (company_id, commented_at),
  add constraint calls_outcome_fk foreign key (company_id, outcome_id) references call_outcomes (company_id, id);
