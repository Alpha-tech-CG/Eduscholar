-- Appuis de l'export des données personnelles (C-05).

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Acteurs : A et B, utilisateurs ; M, modératrice ; S, suspendu.
insert into auth.users (id, instance_id, aud, role, email) values
  ('a0000000-0000-0000-0000-0000000027f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'exp-a@test.invalid'),
  ('b0000000-0000-0000-0000-0000000027f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'exp-b@test.invalid'),
  ('d0000000-0000-0000-0000-0000000027f4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'exp-m@test.invalid'),
  ('e0000000-0000-0000-0000-0000000027f5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'exp-s@test.invalid');
update public.profiles
  set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now()
  where user_id::text like '%-0000000027f_';
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-0000000027f4', 'd0000000-0000-0000-0000-0000000027f4', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');
insert into public.platform_roles (user_id, role) values ('d0000000-0000-0000-0000-0000000027f4', 'moderator');
insert into private.account_status (user_id, status, changed_by)
values ('e0000000-0000-0000-0000-0000000027f5', 'suspended', 'd0000000-0000-0000-0000-0000000027f4');

insert into public.resources
  (id, type_code, title, authors, language_code, program_code, source_kind, source_name,
   official_url, access_status, editorial_status, last_verified_at, published_at)
values
  ('27f00000-0000-0000-0000-000000000001', 'article', 'Ressource signalée', array['Auteur Test'], 'fr', 'computer_science',
   'connector', 'test', 'https://exemple.invalid/r', 'open_access', 'published', now(), now());
insert into public.resource_reports (id, resource_id, reporter_id, reason, details) values
  ('27f00000-0000-0000-0000-0000000000a1', '27f00000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000027f1', 'broken_link', 'Signalement de A'),
  ('27f00000-0000-0000-0000-0000000000b1', '27f00000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000027f2', 'error', 'Signalement de B');

-- ---------------------------------------------------------------------------
-- Ses propres signalements, quel que soit le rôle
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-0000000027f1');
select results_eq(
  $$ select public.my_report_ids() $$,
  $$ values ('27f00000-0000-0000-0000-0000000000a1'::uuid) $$,
  'A obtient l''identifiant de son signalement, pas celui de B'
);
reset role;

select tests.login('d0000000-0000-0000-0000-0000000027f4', 'aal2');
select is(
  (select count(*) from public.resource_reports where id::text like '27f00000-0000-0000-0000-0000000000__'),
  2::bigint, 'La modératrice lit les deux signalements'
);
select is_empty(
  $$ select public.my_report_ids() $$,
  'Mais aucun n''est le sien : son export n''en contiendra pas'
);
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$ select public.my_report_ids() $$, '42501', null, 'Un visiteur n''appelle pas la fonction');
select throws_ok($$ select public.log_personal_data_export() $$, '42501', null, 'Ni ne trace d''export');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok($$ select public.log_personal_data_export() $$, '42501', null, 'Le rôle serveur ne trace pas d''export au nom d''un utilisateur');
reset role;

-- ---------------------------------------------------------------------------
-- Trace de l'export
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-0000000027f1');
select lives_ok($$ select public.log_personal_data_export() $$, 'A trace son export');
select results_eq(
  $$ select category, action, actor_id, subject_user_id, metadata
     from public.audit_logs where action = 'account.data_exported' $$,
  $$ values ('security', 'account.data_exported', 'a0000000-0000-0000-0000-0000000027f1'::uuid,
             'a0000000-0000-0000-0000-0000000027f1'::uuid, '{}'::jsonb) $$,
  'L''événement est lisible de A, sans contenu'
);
select throws_ok(
  $$ delete from public.audit_logs where action = 'account.data_exported' $$,
  '42501', null, 'A ne peut pas effacer la trace'
);
reset role;

select tests.login('b0000000-0000-0000-0000-0000000027f2');
select is_empty(
  $$ select 1 from public.audit_logs where action = 'account.data_exported' $$,
  'B ne lit pas la trace de l''export de A'
);
reset role;

select tests.login('d0000000-0000-0000-0000-0000000027f4', 'aal2');
select is_empty(
  $$ select 1 from public.audit_logs where action = 'account.data_exported' $$,
  'La modération non plus'
);
reset role;

select tests.login('e0000000-0000-0000-0000-0000000027f5');
select throws_ok(
  $$ select public.log_personal_data_export() $$, '42501', 'forbidden', 'Un compte suspendu n''exporte pas'
);
reset role;

-- Événements du compte : ceux de l'appelant seulement, sans auteur ni détail.
select tests.login('a0000000-0000-0000-0000-0000000027f1');
select cmp_ok(
  (select count(*) from public.my_account_events() where action = 'account.data_exported'), '>=', 1::bigint,
  'A retrouve la trace de son propre export'
);
select is(
  (select count(*) from public.my_account_events() e
   where not exists (
     select 1 from public.audit_logs a
     where a.subject_user_id = 'a0000000-0000-0000-0000-0000000027f1'
       and a.action = e.action and a.occurred_at = e.occurred_at)),
  0::bigint, 'Rien qui ne concerne un autre compte'
);
reset role;
select tests.login('b0000000-0000-0000-0000-0000000027f2');
select is(
  (select count(*) from public.my_account_events() where action = 'account.data_exported'),
  0::bigint, 'B n''y lit pas l''export de A'
);
reset role;

-- Projets supprimés en attente de purge : rendus à leur propriétaire seul.
insert into public.research_projects (id, owner_id, title, deleted_at) values
  ('27f00000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000027f1', 'Projet supprimé de A', now() - interval '2 days');
insert into public.project_sources (id, project_id, title) values
  ('27f00000-0000-0000-0000-0000000000d2', '27f00000-0000-0000-0000-0000000000d1', 'Source du projet supprimé');
insert into public.thesis_sections (project_id, position, title, body) values
  ('27f00000-0000-0000-0000-0000000000d1', 1, 'Section du projet supprimé', 'Texte encore à moi.');
select tests.login('a0000000-0000-0000-0000-0000000027f1');
select is(
  (select count(*) from public.research_projects where id = '27f00000-0000-0000-0000-0000000000d1'),
  0::bigint, 'Un projet supprimé n''est plus lisible par la voie ordinaire'
);
select is(
  (select count(*) from public.my_deleted_projects() p where p ->> 'title' = 'Projet supprimé de A'
     and p -> 'sources' -> 0 ->> 'title' = 'Source du projet supprimé'
     and p -> 'sections' -> 0 ->> 'body' = 'Texte encore à moi.'
     and not p ? 'owner_id'),
  1::bigint, 'Mais il figure dans la copie de son propriétaire, avec ses sources et son texte'
);
reset role;
select tests.login('b0000000-0000-0000-0000-0000000027f2');
select is((select count(*) from public.my_deleted_projects()), 0::bigint, 'Pas dans celle d''un autre');
reset role;
select tests.login('e0000000-0000-0000-0000-0000000027f5');
select is((select count(*) from public.my_deleted_projects()), 0::bigint, 'Un compte suspendu ne lit rien');
select is((select count(*) from public.my_account_events()), 0::bigint, 'Ni ses événements');
reset role;

-- Compte à second facteur en session aal1 : aucun droit.
select tests.login('d0000000-0000-0000-0000-0000000027f4', 'aal1');
select throws_ok(
  $$ select public.log_personal_data_export() $$, '42501', 'forbidden',
  'En aal1, un compte à second facteur n''exporte pas'
);
reset role;

select * from finish();
rollback;
