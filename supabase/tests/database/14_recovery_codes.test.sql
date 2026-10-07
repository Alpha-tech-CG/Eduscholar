-- Codes de secours de la validation en deux étapes (D-17).

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

-- Session d'un utilisateur. `p_totp_age` : ancienneté, en secondes, de la
-- dernière présentation du second facteur ; null : jamais présenté.
create function tests.login(p_user uuid, p_aal text default 'aal1', p_totp_age integer default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object(
      'sub', p_user, 'role', 'authenticated', 'aal', p_aal,
      'amr', case when p_totp_age is null
        then jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint))
        else jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - p_totp_age))
      end
    )::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

create table tests.codes (owner text, code text);
grant all on tests.codes to authenticated;

-- Rachat d'un code sous la session aal1 d'un compte donné.
create function tests.redeem_as(p_user uuid, p_code text) returns boolean language plpgsql as $$
declare
  v_result boolean;
begin
  perform tests.login(p_user, 'aal1');
  select public.redeem_recovery_code(p_code) into v_result;
  return v_result;
end $$;

-- Acteurs : A et B ont un second facteur ; C n'en a pas ; S, avec facteur, est suspendu.
insert into auth.users (id, instance_id, aud, role, email) values
  ('a0000000-0000-0000-0000-000000003001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-a@test.invalid'),
  ('b0000000-0000-0000-0000-000000003002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-b@test.invalid'),
  ('c0000000-0000-0000-0000-000000003003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-c@test.invalid'),
  ('d0000000-0000-0000-0000-000000003004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-s@test.invalid');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-000000003001', 'a0000000-0000-0000-0000-000000003001', 'test', 'totp', 'verified', now(), now(), 'secret-de-test'),
  ('fa000000-0000-0000-0000-000000003002', 'b0000000-0000-0000-0000-000000003002', 'test', 'totp', 'verified', now(), now(), 'secret-de-test'),
  ('fa000000-0000-0000-0000-000000003004', 'd0000000-0000-0000-0000-000000003004', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');
insert into private.account_status (user_id, status, reason) values ('d0000000-0000-0000-0000-000000003004', 'suspended', 'Test');

-- ---------------------------------------------------------------------------
-- Génération
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000003001', 'aal1');
select throws_ok($$ select public.generate_recovery_codes() $$, '42501', 'forbidden', 'En aal1, pas de génération de codes');
reset role;

select tests.login('a0000000-0000-0000-0000-000000003001', 'aal2', 700);
select throws_ok(
  $$ select public.generate_recovery_codes() $$, '42501', 'recent_second_factor_required',
  'La génération exige un second facteur présenté récemment'
);
reset role;

select tests.login('c0000000-0000-0000-0000-000000003003', 'aal1');
select throws_ok($$ select public.generate_recovery_codes() $$, '42501', 'forbidden', 'Sans second facteur, pas de codes de secours');
select results_eq($$ select remaining from public.recovery_codes_status() $$, $$ values (0) $$, 'Aucun code pour ce compte');
reset role;

select tests.login('a0000000-0000-0000-0000-000000003001', 'aal2', 30);
insert into tests.codes select 'a', public.generate_recovery_codes();
select is((select count(*) from tests.codes where owner = 'a'), 10::bigint, 'Dix codes sont remis');
select is(
  (select count(*) from tests.codes where owner = 'a'
     and code ~ '^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$'),
  10::bigint, 'Chacun compte seize signes, sans signe ambigu'
);
select is((select count(distinct code) from tests.codes where owner = 'a'), 10::bigint, 'Ils sont tous différents');
select results_eq($$ select remaining from public.recovery_codes_status() $$, $$ values (10) $$, 'Dix codes sont utilisables');
select throws_ok(
  'select * from private.second_factor_recovery_codes', '42501', null, 'Un utilisateur ne lit pas la table des codes'
);
reset role;

select is(
  (select count(*) from private.second_factor_recovery_codes c
   where c.user_id = 'a0000000-0000-0000-0000-000000003001'
     and c.code_hash in (select code from tests.codes)),
  0::bigint, 'Les codes ne sont pas conservés en clair'
);
select is(
  (select count(*) from public.audit_logs
   where action = 'second_factor.recovery_codes_generated' and actor_id = 'a0000000-0000-0000-0000-000000003001'),
  1::bigint, 'La génération est inscrite au journal de sécurité'
);

-- Regénérer remplace les codes : les anciens ne valent plus.
select tests.login('a0000000-0000-0000-0000-000000003001', 'aal2', 30);
insert into tests.codes select 'a2', public.generate_recovery_codes();
select results_eq($$ select remaining from public.recovery_codes_status() $$, $$ values (10) $$, 'Toujours dix codes après régénération');
reset role;

-- ---------------------------------------------------------------------------
-- Usage, dans la session ouverte par le seul mot de passe
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000003001', 'aal1');
select is(
  public.redeem_recovery_code((select code from tests.codes where owner = 'a' limit 1)), false,
  'Un code de la série remplacée est refusé'
);
select is(public.redeem_recovery_code('AAAA-AAAA-AAAA-AAAA'), false, 'Un code inventé est refusé');
select is(public.redeem_recovery_code(''), false, 'Un code vide est refusé');
select is(public.redeem_recovery_code(null), false, 'Un code absent est refusé');
select is(
  public.redeem_recovery_code(lower(replace((select min(code) from tests.codes where owner = 'a2'), '-', ' '))), true,
  'Un code valable est accepté, quelles que soient la casse et la ponctuation'
);
select is(
  public.redeem_recovery_code((select min(code) from tests.codes where owner = 'a2')), false,
  'Le même code ne sert pas deux fois'
);
reset role;

select is(
  (select count(*) from public.audit_logs
   where action = 'second_factor.recovery_code_used' and actor_id = 'a0000000-0000-0000-0000-000000003001'),
  1::bigint, 'L''usage d''un code est inscrit au journal de sécurité'
);
select is(
  (select count(*) from private.second_factor_recovery_codes
   where user_id = 'a0000000-0000-0000-0000-000000003001' and used_at is null),
  9::bigint, 'Il reste neuf codes'
);

-- B ne peut pas utiliser un code de A.
select tests.login('b0000000-0000-0000-0000-000000003002', 'aal1');
select is(
  public.redeem_recovery_code((select max(code) from tests.codes where owner = 'a2')), false,
  'Le code d''un autre compte est refusé'
);

-- Cinq essais erronés par quart d'heure : au-delà, même un bon code est refusé.
select is(public.redeem_recovery_code('BBBB-BBBB-BBBB-BBBB'), false, 'Deuxième essai erroné');
select is(public.redeem_recovery_code('CCCC-CCCC-CCCC-CCCC'), false, 'Troisième');
select is(public.redeem_recovery_code('DDDD-DDDD-DDDD-DDDD'), false, 'Quatrième');
select is(public.redeem_recovery_code('EEEE-EEEE-EEEE-EEEE'), false, 'Cinquième');
select throws_ok(
  $$ select public.redeem_recovery_code('FFFF-FFFF-FFFF-FFFF') $$, null, 'rate_limited',
  'Au sixième essai, le compte est bloqué pour le quart d''heure'
);
select results_eq($$ select remaining from public.recovery_codes_status() $$, $$ values (0) $$, 'En aal1, le nombre de codes n''est pas révélé');
select throws_ok($$ select public.discard_recovery_codes() $$, '42501', 'forbidden', 'En aal1, pas d''abandon des codes : le compteur d''essais ne se remet pas à zéro ainsi');
reset role;
select is(
  (select count(*) from public.audit_logs
   where action = 'second_factor.recovery_code_blocked' and actor_id = 'b0000000-0000-0000-0000-000000003002'),
  1::bigint, 'Le blocage après cinq essais erronés est inscrit au journal de sécurité'
);
select is(
  (select failures from private.recovery_code_attempts where user_id = 'b0000000-0000-0000-0000-000000003002'),
  5, 'Le compteur est resté à cinq'
);

-- Le blocage se lève à la fin de la fenêtre.
update private.recovery_code_attempts set window_start = now() - interval '16 minutes'
  where user_id = 'b0000000-0000-0000-0000-000000003002';
select tests.login('b0000000-0000-0000-0000-000000003002', 'aal1');
select is(public.redeem_recovery_code('GGGG-GGGG-GGGG-GGGG'), false, 'Après la fenêtre, les essais reprennent');
reset role;

-- A, bloqué de son côté ? Non : les compteurs sont par compte.
select tests.login('a0000000-0000-0000-0000-000000003001', 'aal1');
select is(
  public.redeem_recovery_code((select max(code) from tests.codes where owner = 'a2')), true,
  'Les essais de B ne bloquent pas A'
);
reset role;

-- Une session qui a présenté le second facteur n'utilise pas de code de secours.
select tests.login('a0000000-0000-0000-0000-000000003001', 'aal2', 30);
select throws_ok(
  $$ select public.redeem_recovery_code((select code from tests.codes where owner = 'a2' order by code offset 3 limit 1)) $$,
  '42501', 'forbidden', 'En aal2, la désactivation passe par la voie normale'
);
select is(public.last_recovery_code_use() is not null, true, 'Le dernier usage d''un code est connu de son titulaire');
reset role;
select tests.login('b0000000-0000-0000-0000-000000003002', 'aal2', 30);
select is(public.last_recovery_code_use(), null, 'Et de lui seul');
reset role;

-- Second facteur remplacé : les codes de l'ancien ne valent plus.
select set_config('request.jwt.claims', '', true);
delete from auth.mfa_factors where id = 'fa000000-0000-0000-0000-000000003001';
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fb000000-0000-0000-0000-000000003001', 'a0000000-0000-0000-0000-000000003001', 'nouveau', 'totp', 'verified', now(), now(), 'secret-de-test');
select tests.login('a0000000-0000-0000-0000-000000003001', 'aal1');
select is(
  public.redeem_recovery_code((select code from tests.codes where owner = 'a2' order by code offset 4 limit 1)), false,
  'Un code généré pour un second facteur retiré est refusé'
);
reset role;
select tests.login('a0000000-0000-0000-0000-000000003001', 'aal2', 30);
select results_eq($$ select remaining from public.recovery_codes_status() $$, $$ values (0) $$, 'Aucun code ne vaut pour le nouveau facteur');
insert into tests.codes select 'a3', public.generate_recovery_codes();
select results_eq($$ select remaining from public.recovery_codes_status() $$, $$ values (10) $$, 'De nouveaux codes sont générés pour lui');
reset role;

-- Dernier super-administrateur effectif : pas de code de secours.
select set_config('request.jwt.claims', '', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('e0000000-0000-0000-0000-000000003005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-super@test.invalid');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-000000003005', 'e0000000-0000-0000-0000-000000003005', 'test', 'totp', 'verified', now(), now(), 'secret-de-test');
insert into public.platform_roles (user_id, role) values ('e0000000-0000-0000-0000-000000003005', 'super_admin');
-- Dans ce test, il est le seul effectif si aucun autre n'existe dans la base locale.
select case
  when private.effective_super_admin_count('e0000000-0000-0000-0000-000000003005') = 0 then
    throws_ok(
      $$ select tests.redeem_as('e0000000-0000-0000-0000-000000003005', 'AAAA-AAAA-AAAA-AAAA') $$,
      '42501', 'last_super_admin', 'Le dernier super-administrateur effectif n''utilise pas de code de secours'
    )
  else skip('Un autre super-administrateur effectif existe dans la base locale', 1)
end;

-- Administrateur d'organisation : un second facteur recréé après l'attribution du rôle ne le rend pas.
insert into public.organizations (id, slug, name, status, created_by) values
  ('30000000-0000-0000-0000-00000000c001', 'org-codes-secours', 'Organisation de test', 'verified', 'a0000000-0000-0000-0000-000000003001');
insert into public.organization_members (organization_id, user_id, role, invited_by, role_granted_at) values
  ('30000000-0000-0000-0000-00000000c001', 'a0000000-0000-0000-0000-000000003001', 'org_admin',
   'e0000000-0000-0000-0000-000000003005', now() - interval '1 hour');
select tests.login('a0000000-0000-0000-0000-000000003001', 'aal2', 30);
select ok(
  not private.has_org_role('30000000-0000-0000-0000-00000000c001', array['org_admin']),
  'Un second facteur postérieur à l''attribution ne rend pas le rôle d''administrateur d''organisation'
);
select is_empty($$ select private.my_org_ids(array['org_admin']) $$, 'Ni par la liste de ses organisations');
reset role;
select set_config('request.jwt.claims', '', true);
update public.organization_members set role_granted_at = now() + interval '1 second'
  where user_id = 'a0000000-0000-0000-0000-000000003001';
select tests.login('a0000000-0000-0000-0000-000000003001', 'aal2', 30);
select ok(
  private.has_org_role('30000000-0000-0000-0000-00000000c001', array['org_admin']),
  'Une fois le rôle réattribué après le nouveau facteur, il redevient effectif'
);
reset role;

-- ---------------------------------------------------------------------------
-- Qui ne peut pas
-- ---------------------------------------------------------------------------
select tests.login('c0000000-0000-0000-0000-000000003003', 'aal1');
select throws_ok($$ select public.redeem_recovery_code('AAAA-AAAA-AAAA-AAAA') $$, '42501', 'forbidden', 'Sans second facteur, rien à lever');
reset role;

select tests.login('d0000000-0000-0000-0000-000000003004', 'aal1');
select throws_ok($$ select public.redeem_recovery_code('AAAA-AAAA-AAAA-AAAA') $$, '42501', 'forbidden', 'Un compte suspendu n''utilise pas de code de secours');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$ select public.redeem_recovery_code('AAAA-AAAA-AAAA-AAAA') $$, '42501', null, 'Un visiteur n''appelle pas la fonction');
select throws_ok($$ select public.generate_recovery_codes() $$, '42501', null, 'Ni ne génère de codes');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok($$ select public.generate_recovery_codes() $$, '42501', null, 'Le rôle serveur ne génère pas de codes');
select throws_ok('select * from private.second_factor_recovery_codes', '42501', null, 'Ni ne lit la table');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Abandon des codes, suppression du compte
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000003001', 'aal2', 30);
select lives_ok($$ select public.discard_recovery_codes() $$, 'A abandonne ses codes');
select results_eq($$ select remaining from public.recovery_codes_status() $$, $$ values (0) $$, 'Il n''en reste aucun');
reset role;
select is(
  (select count(*) from public.audit_logs
   where action = 'second_factor.recovery_codes_discarded' and actor_id = 'a0000000-0000-0000-0000-000000003001'),
  1::bigint, 'L''abandon de codes est inscrit au journal de sécurité'
);

select tests.login('b0000000-0000-0000-0000-000000003002', 'aal2', 30);
insert into tests.codes select 'b', public.generate_recovery_codes();
reset role;
delete from auth.users where id = 'b0000000-0000-0000-0000-000000003002';
select is(
  (select count(*) from private.second_factor_recovery_codes where user_id = 'b0000000-0000-0000-0000-000000003002'),
  0::bigint, 'La suppression du compte efface ses codes'
);

select * from finish();
rollback;
