-- Corrige `take_rate_limit`: el límite y la ventana ya no los elige quien llama.
--
-- En la versión anterior (migración app_data) recibía `p_limit` y `p_window_seconds` como
-- parámetros. Como la función es ejecutable por `authenticated` vía /rest/v1/rpc, un usuario podía
-- llamarla directamente con una ventana de 1 segundo y reiniciar su propio contador, saltándose
-- límites como "30 búsquedas por minuto". Ahora la política de cada clave vive acá, en la base.
-- Llamarla a mano solo sirve para gastar la cuota propia.

drop function public.take_rate_limit(text, int, int);

create or replace function public.take_rate_limit(p_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int;
  v_window int;
  v_count int;
begin
  if v_uid is null then
    return false;
  end if;

  -- Política por clave: `v_limit` usos por ventana de `v_window` segundos.
  case p_key
    when 'refresh_quotes' then v_limit := 1;  v_window := 300;   -- "Actualizar ahora": 1 cada 5 min (spec §7.2)
    when 'search_symbols' then v_limit := 30; v_window := 60;
    when 'import_csv'     then v_limit := 20; v_window := 3600;
    else
      raise exception 'clave de límite desconocida' using errcode = '22023';
  end case;

  insert into public.rate_limits as r (user_id, key, window_start, count)
  values (v_uid, p_key, now(), 1)
  on conflict (user_id, key) do update
    set window_start = case
          when r.window_start <= now() - make_interval(secs => v_window) then now()
          else r.window_start
        end,
        count = case
          when r.window_start <= now() - make_interval(secs => v_window) then 1
          else r.count + 1
        end
  returning r.count into v_count;

  return v_count <= v_limit;
end;
$$;

revoke execute on function public.take_rate_limit(text) from public, anon, authenticated;
grant execute on function public.take_rate_limit(text) to authenticated;
