-- calls_test: the database `pnpm test:int` drops and rebuilds (CLAUDE.md: tests get their own database).
create database if not exists calls_test character set utf8mb4 collate utf8mb4_unicode_ci;
grant all privileges on calls_test.* to 'calls'@'%';
