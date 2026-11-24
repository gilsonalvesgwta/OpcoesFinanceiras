-- WTA Options Intelligence — 0017: zerar a carteira do próprio usuário.
--
-- Apaga, só do dono (roda com os direitos de quem chama, sob RLS):
-- estratégias/posições (com execuções e rolagens), notas de corretagem importadas e os
-- avisos de posição (com os Telegram pendentes ligados a eles). Fica tudo o mais:
-- alertas de preço, favoritos, carteiras simuladas, chaves do MT5 e Telegram.

create function app.zerar_carteira() returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if app.eu() is null then raise exception 'sem_usuario' using errcode = 'P0001'; end if;
  select jsonb_build_object(
    'estrategias', (select count(*) from estrategias where user_id = app.eu()),
    'execucoes', (select count(*) from execucoes where user_id = app.eu()),
    'notas', (select count(*) from notas_corretagem where user_id = app.eu()),
    'eventos', (select count(*) from eventos_posicao where user_id = app.eu())
  ) into v;
  delete from eventos_posicao where user_id = app.eu();
  delete from notas_corretagem where user_id = app.eu();
  delete from estrategias where user_id = app.eu();
  return v;
end $$;

revoke execute on function app.zerar_carteira() from public;
grant execute on function app.zerar_carteira() to wtaopt_app;
