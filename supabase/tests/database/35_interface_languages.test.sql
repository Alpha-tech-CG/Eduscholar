-- Phase 5, F-04 : langues d'interface.

begin;

create extension if not exists pgtap with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select no_plan();

create schema if not exists tests;
create function tests.login(p_user uuid, p_aal text default 'aal1', p_totp_age integer default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object(
      'sub', p_user, 'role', 'authenticated', 'aal', p_aal,
      'amr', case when p_totp_age is null
        then jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint))
        else jsonb_build_array(
          jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - p_totp_age - 60),
          jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - p_totp_age))
      end
    )::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- U : utilisateur. P : administrateur de la plateforme.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000008101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'langue-u@test.invalid', now()),
  ('b0000000-0000-0000-0000-000000008102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'langue-p@test.invalid', now());
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values ('fa000000-0000-0000-0000-000000008102', 'b0000000-0000-0000-0000-000000008102', 'test', 'totp', 'verified', now() - interval '1 day', now(), 'x');
insert into public.platform_roles (user_id, role) values ('b0000000-0000-0000-0000-000000008102', 'platform_admin');

select results_eq(
  $$ select code from public.languages where is_interface order by code $$,
  $$ values ('en'), ('fr'), ('pt') $$,
  'Trois langues d''interface : français, anglais, portugais'
);

select tests.login('a0000000-0000-0000-0000-000000008101');
select lives_ok(
  $$ update public.profiles set preferred_locale = 'pt' where user_id = 'a0000000-0000-0000-0000-000000008101' $$,
  'Un utilisateur enregistre le portugais comme langue préférée'
);
select is(
  (select preferred_locale from public.profiles where user_id = 'a0000000-0000-0000-0000-000000008101'), 'pt',
  'Le choix est gardé'
);
select throws_ok(
  $$ update public.profiles set preferred_locale = 'ar' where user_id = 'a0000000-0000-0000-0000-000000008101' $$,
  '23514', null, 'Une langue qui n''est pas d''interface est refusée'
);
reset role;

-- Une langue d'interface ne se désactive pas.
select tests.login('b0000000-0000-0000-0000-000000008102', 'aal2', 30);
select throws_ok(
  $$ select public.admin_set_reference_active(kind => 'languages', code => 'pt', active => false) $$,
  'P0001', 'protected_reference', 'Le portugais, langue d''interface, ne se désactive pas'
);
reset role;

select * from finish();
rollback;
