-- D-09 (partie) : alerte de nouvelle connexion et compteurs d'événements.

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
create function tests.as_service()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;
grant usage on schema tests to authenticated, service_role;
grant execute on all functions in schema tests to authenticated, service_role;

-- A : utilisateur. B : autre utilisateur. F : utilisateur à second facteur. P : administrateur.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000006101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'appareil-a@test.invalid', now()),
  ('b0000000-0000-0000-0000-000000006102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'appareil-b@test.invalid', now()),
  ('f0000000-0000-0000-0000-000000006103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'appareil-f@test.invalid', now()),
  ('d0000000-0000-0000-0000-000000006104', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'appareil-p@test.invalid', now());
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('fa000000-0000-0000-0000-000000006103', 'f0000000-0000-0000-0000-000000006103', 'test', 'totp', 'verified', now() - interval '1 day', now(), 'x'),
  ('fa000000-0000-0000-0000-000000006104', 'd0000000-0000-0000-0000-000000006104', 'test', 'totp', 'verified', now() - interval '1 day', now(), 'x');
insert into public.platform_roles (user_id, role) values ('d0000000-0000-0000-0000-000000006104', 'platform_admin');

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['select', 'insert', 'update', 'delete']) p,
     unnest(array['public.known_devices', 'private.auth_event_counters']) t
   where has_table_privilege(r, t, p)),
  0::bigint, 'Ni les navigateurs connus ni les compteurs ne se lisent ou ne s''écrivent directement'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.proname in ('record_auth_event', 'register_sign_in_device')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  0::bigint, 'Ni le visiteur ni un utilisateur ne comptent d''événement ni n''enregistrent de navigateur'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.proname in ('my_known_devices', 'admin_auth_events')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'Ni le visiteur ni le rôle serveur n''appellent les fonctions du titulaire et de l''administration'
);

-- ---------------------------------------------------------------------------
-- Navigateurs connus
-- ---------------------------------------------------------------------------
select tests.as_service();
select is(public.register_sign_in_device('a0000000-0000-0000-0000-000000006101', 'abc'), false, 'Une empreinte mal formée : rien');
select is(public.register_sign_in_device(null, repeat('a', 64)), false, 'Sans compte : rien');
select is(public.register_sign_in_device(gen_random_uuid(), repeat('a', 64)), false, 'Un compte inconnu : rien');
select is(public.register_sign_in_device('a0000000-0000-0000-0000-000000006101', repeat('a', 64)), false, 'La première connexion d''un compte tout juste créé ne mérite pas d''avis');
select is(public.register_sign_in_device('a0000000-0000-0000-0000-000000006101', repeat('a', 64)), false, 'Le même navigateur, de nouveau : pas d''avis');
select is(public.register_sign_in_device('a0000000-0000-0000-0000-000000006101', repeat('b', 64)), true, 'Un navigateur nouveau pour un compte qui en connaît un : avis');
select is(public.register_sign_in_device('a0000000-0000-0000-0000-000000006101', repeat('b', 64)), false, 'Il est désormais connu');
select is(public.register_sign_in_device('b0000000-0000-0000-0000-000000006102', repeat('a', 64)), false, 'Le navigateur d''un autre compte ne dit rien de celui-ci');
reset role;
select is(
  (select count(*) from public.known_devices where user_id::text like '%-00000000610_'), 3::bigint,
  'Rien n''est retenu pour une empreinte mal formée ou un compte inconnu'
);

select tests.login('a0000000-0000-0000-0000-000000006101');
select is((select count(*) from public.my_known_devices()), 2::bigint, 'Le titulaire lit ses deux navigateurs : des dates seulement');
select throws_ok(
  $$ select public.register_sign_in_device('a0000000-0000-0000-0000-000000006101', repeat('c', 64)) $$, '42501', null,
  'Un utilisateur ne fait pas connaître un navigateur par lui-même, pas même le sien'
);
reset role;
select tests.login('b0000000-0000-0000-0000-000000006102');
select is((select count(*) from public.my_known_devices()), 1::bigint, 'Chacun ne lit que les siens');
reset role;

-- Un compte ancien sans navigateur connu — resté six mois sans connexion, ou
-- antérieur à cette alerte — n'en est pas à sa première connexion : il prévient.
update auth.users set created_at = now() - interval '2 days', email_confirmed_at = now() - interval '2 days'
where id in ('a0000000-0000-0000-0000-000000006101', 'f0000000-0000-0000-0000-000000006103');
select tests.as_service();
select is(public.register_sign_in_device('f0000000-0000-0000-0000-000000006103', repeat('c', 64)), true, 'Un compte ancien sans navigateur connu prévient');
select is(public.register_sign_in_device('f0000000-0000-0000-0000-000000006103', repeat('d', 64)), true, 'Un deuxième navigateur aussi');
select is(public.register_sign_in_device('f0000000-0000-0000-0000-000000006103', repeat('e', 64)), true, 'Un troisième aussi');
select is(public.register_sign_in_device('f0000000-0000-0000-0000-000000006103', repeat('1', 64)), false, 'Au-delà de trois avis par jour, plus de courriel');
reset role;
select is(
  (select count(*) from public.known_devices where user_id = 'f0000000-0000-0000-0000-000000006103'), 4::bigint,
  'Le navigateur est retenu quand même'
);
-- Compte à second facteur, session au seul mot de passe : la liste attend le second facteur.
select tests.login('f0000000-0000-0000-0000-000000006103');
select is((select count(*) from public.my_known_devices()), 0::bigint, 'La liste, elle, attend le second facteur');
reset role;

-- Changer de mot de passe fait oublier les navigateurs connus.
update auth.users set encrypted_password = 'nouvelle-empreinte' where id = 'a0000000-0000-0000-0000-000000006101';
select is(
  (select count(*) from public.known_devices where user_id = 'a0000000-0000-0000-0000-000000006101'), 0::bigint,
  'Après un changement de mot de passe, plus aucun navigateur n''est tenu pour connu'
);
select tests.as_service();
select is(public.register_sign_in_device('a0000000-0000-0000-0000-000000006101', repeat('b', 64)), true, 'Un navigateur auparavant connu prévient de nouveau');
reset role;
update auth.users set raw_user_meta_data = '{}'::jsonb where id = 'a0000000-0000-0000-0000-000000006101';
select is(
  (select count(*) from public.known_devices where user_id = 'a0000000-0000-0000-0000-000000006101'), 1::bigint,
  'Une autre modification du compte n''oublie rien'
);

-- Vingt navigateurs au plus : les moins récemment vus sont oubliés.
insert into public.known_devices (user_id, device_hash, last_seen_at)
select 'a0000000-0000-0000-0000-000000006101', md5(i::text) || md5(i::text), now() - make_interval(days => i)
from generate_series(1, 25) i;
select tests.as_service();
select is(public.register_sign_in_device('a0000000-0000-0000-0000-000000006101', repeat('e', 64)), true, 'Un navigateur de plus');
reset role;
select is(
  (select count(*) from public.known_devices where user_id = 'a0000000-0000-0000-0000-000000006101'),
  20::bigint, 'Le compte n''en garde que vingt'
);
select is(
  (select count(*) from public.known_devices
   where user_id = 'a0000000-0000-0000-0000-000000006101' and device_hash in (repeat('e', 64), repeat('b', 64))),
  2::bigint, 'Le nouveau et celui vu à l''instant sont gardés'
);
select is(
  (select count(*) from public.known_devices
   where user_id = 'a0000000-0000-0000-0000-000000006101' and last_seen_at < now() - interval '19 days'),
  0::bigint, 'Ce sont les moins récemment vus qui partent'
);

-- ---------------------------------------------------------------------------
-- Compteurs
-- ---------------------------------------------------------------------------
delete from private.auth_event_counters;
select tests.as_service();
select lives_ok($$ select public.record_auth_event('failed:sign-in') $$, 'Le serveur compte un échec');
select public.record_auth_event('failed:sign-in');
select public.record_auth_event('limited:password-reset');
select lives_ok($$ select public.record_auth_event('n''importe quoi') $$, 'Une nature inconnue est ignorée, sans erreur');
select lives_ok($$ select public.record_auth_event('failed:quelqu.un@test.invalid') $$, 'Une adresse ne passe pas pour une nature');
reset role;
select results_eq(
  $$ select kind, total from private.auth_event_counters order by kind $$,
  $$ values ('failed:sign-in', 2), ('limited:password-reset', 1) $$,
  'Deux natures, comptées par heure : rien d''autre n''est gardé'
);

select tests.login('a0000000-0000-0000-0000-000000006101');
select throws_ok($$ select * from private.admin_auth_events() $$, '42501', null, 'Un utilisateur ne lit pas les compteurs');
select throws_ok($$ select public.record_auth_event('failed:sign-in') $$, '42501', null, 'Ni n''en écrit');
reset role;
select tests.login('d0000000-0000-0000-0000-000000006104', 'aal1');
select throws_ok($$ select * from private.admin_auth_events() $$, '42501', null, 'Un administrateur sans second facteur présenté non plus');
reset role;
select tests.login('d0000000-0000-0000-0000-000000006104', 'aal2', 30);
select results_eq(
  $$ select day, kind, total from public.admin_auth_events() $$,
  $$ values ((now() at time zone 'UTC')::date, 'failed:sign-in', 2::bigint),
            ((now() at time zone 'UTC')::date, 'limited:password-reset', 1::bigint) $$,
  'L''administrateur lit les nombres du jour'
);
reset role;
-- Au-delà de sept jours : hors de l'écran.
update private.auth_event_counters set hour = hour - interval '8 days' where kind = 'limited:password-reset';
select tests.login('d0000000-0000-0000-0000-000000006104', 'aal2', 30);
select is((select count(*) from public.admin_auth_events()), 1::bigint, 'Seuls les sept derniers jours sont rendus');
reset role;

-- ---------------------------------------------------------------------------
-- Conservation
-- ---------------------------------------------------------------------------
update private.auth_event_counters set hour = hour - interval '90 days' where kind = 'limited:password-reset';
update public.known_devices set last_seen_at = now() - interval '181 days'
where user_id = 'b0000000-0000-0000-0000-000000006102';
select tests.login('a0000000-0000-0000-0000-000000006101');
select throws_ok($$ select private.purge_auth_traces() $$, '42501', null, 'Un utilisateur ne lance pas la purge');
reset role;
select cmp_ok(private.purge_auth_traces(), '>=', 2, 'La purge efface compteurs de trois mois et navigateurs non revus depuis six');
select is(
  (select count(*) from public.known_devices where user_id = 'b0000000-0000-0000-0000-000000006102'), 0::bigint,
  'Le navigateur non revu est oublié'
);
select is((select count(*) from private.auth_event_counters), 1::bigint, 'Le compteur récent reste');
select is(
  (select count(*) from cron.job where jobname = 'eduscholar-auth-traces-purge' and active and username = 'postgres'),
  1::bigint, 'Elle est planifiée chaque nuit'
);

-- Suppression du compte : ses navigateurs partent avec lui.
select set_config('request.jwt.claims', '', true);
select lives_ok($$ delete from auth.users where id = 'a0000000-0000-0000-0000-000000006101' $$, 'Le titulaire supprime son compte');
select is(
  (select count(*) from public.known_devices where user_id = 'a0000000-0000-0000-0000-000000006101'), 0::bigint,
  'Ses navigateurs connus partent avec son compte'
);

select * from finish();
rollback;
