-- WTA Options Intelligence — 0014: painel do dia do ativo.
--
-- O robô (1.4.0) manda abertura, máxima e mínima do dia de cada ativo (barra diária do
-- MT5). Para o gráfico do dia, guardamos o último preço de cada minuto das ações e ETFs
-- que passam pela ponte (só do dono, por RLS), por 10 dias.

alter table cotacoes_ponte
  add column abertura integer check (abertura > 0),
  add column maxima   integer check (maxima > 0),
  add column minima   integer check (minima > 0);

create table intradia_ponte (
  user_id uuid not null references users (id) on delete cascade,
  codigo  text not null check (codigo ~ '^[A-Z0-9]{4,16}$'),
  minuto  timestamptz not null,
  preco   integer not null check (preco > 0),
  primary key (user_id, codigo, minuto)
);
alter table intradia_ponte enable row level security;
grant select on intradia_ponte to wtaopt_app;
create policy intradia_dono on intradia_ponte for select to wtaopt_app using (user_id = app.eu());

create or replace function app.receber_da_ponte(
  p_token_hash bytea, p_ip inet, p_versao text, p_conta jsonb, p_cotacoes jsonb, p_posicoes jsonb
) returns table (gravadas integer, ignoradas integer, posicoes integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ponte uuid; v_user uuid; v_gravadas integer := 0; v_total integer; v_pos integer := null;
begin
  select t.ponte_id, t.user_id into v_ponte, v_user from app.ponte_por_token(p_token_hash) t;
  if v_ponte is null then raise exception 'ponte_invalida' using errcode = 'P0001'; end if;

  update pontes_mt5 set ultimo_contato_em = now(), ultimo_ip = p_ip, versao = left(p_versao, 40),
    conta_login = coalesce(left(p_conta ->> 'login', 40), conta_login),
    conta_servidor = coalesce(left(p_conta ->> 'servidor', 80), conta_servidor),
    conta_corretora = coalesce(left(p_conta ->> 'corretora', 120), conta_corretora)
  where id = v_ponte;

  v_total := coalesce(jsonb_array_length(p_cotacoes), 0);
  with novas as (
    select * from jsonb_to_recordset(coalesce(p_cotacoes, '[]'::jsonb))
      as c(codigo text, ultimo integer, bid integer, ask integer, fechamento_anterior integer, volume bigint, instante timestamptz, lote integer, abertura integer, maxima integer, minima integer)
  ), gravadas as (
    insert into cotacoes_ponte (user_id, codigo, ponte_id, ultimo, bid, ask, fechamento_anterior, volume, instante_fonte, recebido_em, lote, abertura, maxima, minima)
    select v_user, n.codigo, v_ponte, n.ultimo, n.bid, n.ask, n.fechamento_anterior, n.volume, n.instante, now(), n.lote, n.abertura, n.maxima, n.minima from novas n
    on conflict (user_id, codigo) do update set
      ponte_id = excluded.ponte_id, ultimo = excluded.ultimo, bid = excluded.bid, ask = excluded.ask,
      fechamento_anterior = excluded.fechamento_anterior, volume = excluded.volume,
      instante_fonte = excluded.instante_fonte, recebido_em = excluded.recebido_em,
      lote = coalesce(excluded.lote, cotacoes_ponte.lote),
      abertura = excluded.abertura, maxima = excluded.maxima, minima = excluded.minima
    where cotacoes_ponte.instante_fonte <= excluded.instante_fonte
    returning 1
  )
  select count(*) into v_gravadas from gravadas;

  -- Gráfico do dia: último preço de cada minuto das AÇÕES/ETFs (código XXXX + 1 ou 2
  -- dígitos; opções ficam de fora). Guardado por 10 dias.
  insert into intradia_ponte (user_id, codigo, minuto, preco)
  select distinct on (c.codigo, date_trunc('minute', c.instante)) v_user, c.codigo, date_trunc('minute', c.instante), c.ultimo
  from jsonb_to_recordset(coalesce(p_cotacoes, '[]'::jsonb)) as c(codigo text, ultimo integer, instante timestamptz)
  where c.codigo ~ '^[A-Z]{4}[0-9]{1,2}$' and c.ultimo is not null and c.ultimo > 0
  order by c.codigo, date_trunc('minute', c.instante), c.instante desc
  on conflict (user_id, codigo, minuto) do update set preco = excluded.preco;
  if random() < 0.002 then
    delete from intradia_ponte where user_id = v_user and minuto < now() - interval '10 days';
  end if;

  if p_posicoes is not null then
    delete from posicoes_ponte where user_id = v_user
      and codigo not in (select x ->> 'codigo' from jsonb_array_elements(p_posicoes) x);
    insert into posicoes_ponte (user_id, codigo, ponte_id, lado, quantidade, preco_medio, recebido_em)
    select v_user, p.codigo, v_ponte, p.lado, p.quantidade, p.preco_medio, now()
    from jsonb_to_recordset(p_posicoes) as p(codigo text, lado text, quantidade bigint, preco_medio numeric)
    on conflict (user_id, codigo) do update set
      ponte_id = excluded.ponte_id, lado = excluded.lado, quantidade = excluded.quantidade,
      preco_medio = excluded.preco_medio, recebido_em = excluded.recebido_em;
    v_pos := jsonb_array_length(p_posicoes);
  end if;

  return query select v_gravadas, v_total - v_gravadas, v_pos;
end $$;
