-- Sin contraseñas: el único ingreso es el código de 6 dígitos del correo.
--
-- Supabase Auth no tiene una opción para apagar la contraseña sin apagar también el correo, y su
-- API es pública con la clave publicable: cualquiera puede llamar a /auth/v1/signup con una
-- contraseña, y quien tenga un token de acceso puede ponerle una con `updateUser({ password })`
-- y entrar después por /auth/v1/token?grant_type=password, fuera del límite de intentos de la
-- app (`take_login_attempt`). Además, Supabase les pone una contraseña al azar a los usuarios que
-- crea el ingreso por código.
--
-- Este trigger borra el hash cada vez que Auth lo escribe. Sin hash, Auth rechaza siempre el
-- ingreso con contraseña (`User.Authenticate` devuelve falso si está vacío): el alta o el cambio
-- "funcionan", pero la contraseña no sirve para nada. NULL es lo mismo que guarda Auth para un
-- usuario sin contraseña.

create function public.strip_user_password()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.encrypted_password := null;
  return new;
end;
$$;

-- Solo lo dispara Auth al escribir auth.users: no debe quedar expuesta como RPC.
revoke execute on function public.strip_user_password() from public, anon, authenticated;

create trigger strip_user_password
  before insert or update of encrypted_password on auth.users
  for each row execute function public.strip_user_password();

-- Las contraseñas que ya existen (las que Supabase sorteó al crear cada usuario por código): el
-- trigger de arriba las vacía.
update auth.users set encrypted_password = null where encrypted_password is not null;
