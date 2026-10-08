-- =============================================================================
-- D-09 (partie) : corrections de la revue de sécurité de l'alerte de connexion
-- =============================================================================
--   - l'enregistrement d'un navigateur n'est plus appelable par un utilisateur :
--     qui tenait seulement le mot de passe pouvait, par appel direct, faire
--     connaître son navigateur sans que personne n'envoie l'avis, faire oublier
--     ceux du titulaire, ou épuiser le quota pour rendre l'alerte muette. Le
--     serveur l'appelle désormais sous le rôle de service, pour le compte dont
--     le mot de passe vient d'être accepté ;
--   - un compte sans navigateur connu n'est plus tenu pour neuf : s'il existe
--     depuis plus d'une heure, la connexion prévient. C'est le cas d'un compte
--     resté six mois sans connexion, et de tout compte au jour du déploiement ;
--   - changer de mot de passe fait oublier les navigateurs connus : celui de
--     qui avait trouvé l'ancien ne passe plus pour familier ;
--   - trois avis au plus par jour et par compte : au-delà, le navigateur est
--     retenu sans courriel, pour que l'alerte ne serve pas à inonder une boîte ;
--   - deux connexions simultanées ne donnent plus deux avis.
--
-- Réversibilité : supprimer le déclencheur et sa fonction ; rétablir
-- `register_sign_in_device(text)` de la migration 006100.
-- =============================================================================

drop function public.register_sign_in_device(text);
drop function private.register_sign_in_device(text);

-- Rend vrai si le titulaire doit être prévenu.
create function private.register_sign_in_device(p_user_id uuid, p_device_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_known integer;
  v_settled boolean;
begin
  if p_user_id is null or p_device_hash is null or p_device_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  -- Compte créé ou confirmé depuis plus d'une heure : il n'en est plus à sa
  -- première connexion, même si aucun navigateur n'est retenu.
  select greatest(u.created_at, coalesce(u.email_confirmed_at, u.created_at)) < now() - interval '1 hour'
  into v_settled
  from auth.users u where u.id = p_user_id;
  if v_settled is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('known_devices:' || p_user_id::text, 0));
  update public.known_devices d set last_seen_at = now()
  where d.user_id = p_user_id and d.device_hash = p_device_hash;
  if found then
    return false;
  end if;

  select count(*) into v_known from public.known_devices d where d.user_id = p_user_id;
  insert into public.known_devices (user_id, device_hash) values (p_user_id, p_device_hash);
  -- Vingt navigateurs au plus : les moins récemment vus sont oubliés.
  delete from public.known_devices d
  where d.user_id = p_user_id and d.device_hash in (
    select o.device_hash from public.known_devices o
    where o.user_id = p_user_id
    order by o.last_seen_at desc, o.device_hash
    offset 20
  );

  if v_known = 0 and not v_settled then
    return false;
  end if;
  -- Trois avis par jour et par compte ; la clé du compteur est une empreinte.
  return public.consume_rate_limit(
    'sign-in-alert:' || encode(extensions.digest(p_user_id::text, 'sha256'), 'hex'), 3, 86400
  );
end
$$;

create function public.register_sign_in_device(p_user_id uuid, p_device_hash text) returns boolean
language sql security invoker set search_path = ''
as $$ select private.register_sign_in_device(p_user_id, p_device_hash); $$;

revoke all on function private.register_sign_in_device(uuid, text) from public, anon, authenticated;
revoke all on function public.register_sign_in_device(uuid, text) from public, anon, authenticated;
grant execute on function private.register_sign_in_device(uuid, text) to service_role;
grant execute on function public.register_sign_in_device(uuid, text) to service_role;

-- Changer de mot de passe fait oublier les navigateurs connus du compte, que
-- le changement passe par l'application ou par le service d'authentification.
create function private.forget_devices_on_password_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.known_devices d where d.user_id = new.id;
  return new;
end
$$;

revoke all on function private.forget_devices_on_password_change() from public, anon, authenticated, service_role;
grant execute on function private.forget_devices_on_password_change() to supabase_auth_admin;

create trigger users_forget_devices_on_password_change
  after update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function private.forget_devices_on_password_change();
