-- Sanity checks for schema.sql business rules. Run against the local test
-- DB; expects two intentional ERROR lines (locking + append-only guards).
\set ON_ERROR_STOP off
set search_path to off_you_pop, public;

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001');
insert into team_members (id, email, name, role)
  values ('00000000-0000-0000-0000-000000000001', 'dan@example.com', 'Dan', 'admin');

insert into signoff_records (id, project_name, client_name, scope_label, scope_type, created_by)
  values ('10000000-0000-0000-0000-000000000001', 'Acme Redesign', 'Acme Ltd', 'Homepage only', 'single_frame', 'Dan');

insert into recipients (id, signoff_id, email, name)
  values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'jo@acme.com', 'Jo Client');

insert into event_log (signoff_id, recipient_id, event_type, ip_address)
  values ('10000000-0000-0000-0000-000000000001', null, 'created', null);

-- Sign it: this is the state transition the API will perform.
update recipients set status = 'signed', signed_at = now() where id = '20000000-0000-0000-0000-000000000001';
update signoff_records set status = 'signed' where id = '10000000-0000-0000-0000-000000000001';

insert into event_log (signoff_id, recipient_id, event_type, ip_address)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'signed', '203.0.113.5');

\echo '--- expect ERROR: signed record is locked ---'
update signoff_records set project_name = 'Renamed' where id = '10000000-0000-0000-0000-000000000001';

\echo '--- expect OK: archived_at is allowed even after signed ---'
update signoff_records set archived_at = now() where id = '10000000-0000-0000-0000-000000000001';

\echo '--- expect ERROR: event_log is append-only ---'
update event_log set event_type = 'viewed' where signoff_id = '10000000-0000-0000-0000-000000000001' and event_type = 'created';

\echo '--- final state ---'
select id, status, archived_at is not null as archived from signoff_records;
select event_type, recipient_id is not null as has_recipient from event_log order by occurred_at;
