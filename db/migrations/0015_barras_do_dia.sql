-- WTA Options Intelligence — 0015: histórico de minutos vindo do robô (1.5.0).
--
-- O robô manda os minutos já fechados (barras M1 do MT5) de ações e ETFs: na primeira vez
-- os últimos dias, depois só os novos. Assim o gráfico do dia começa na abertura do
-- pregão, mesmo que o robô tenha sido ligado depois. Gravado em intradia_ponte (só do dono).
-- p_barras: [{codigo, minuto, preco}]

create function app.receber_barras_da_ponte(p_token_hash bytea, p_barras jsonb)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_n integer;
begin
  select t.user_id into v_user from app.ponte_por_token(p_token_hash) t;
  if v_user is null then raise exception 'ponte_invalida' using errcode = 'P0001'; end if;
  with novas as (
    select distinct on (b.codigo, date_trunc('minute', b.minuto)) b.codigo, date_trunc('minute', b.minuto) as minuto, b.preco
    from jsonb_to_recordset(coalesce(p_barras, '[]'::jsonb)) as b(codigo text, minuto timestamptz, preco integer)
    where b.codigo ~ '^[A-Z]{4}[0-9]{1,2}$' and b.preco > 0
    order by b.codigo, date_trunc('minute', b.minuto), b.minuto desc
  ), gravadas as (
    insert into intradia_ponte (user_id, codigo, minuto, preco)
    select v_user, codigo, minuto, preco from novas
    on conflict (user_id, codigo, minuto) do update set preco = excluded.preco
    returning 1
  )
  select count(*) into v_n from gravadas;
  return v_n;
end $$;

revoke execute on function app.receber_barras_da_ponte(bytea, jsonb) from public;
grant execute on function app.receber_barras_da_ponte(bytea, jsonb) to wtaopt_app;
