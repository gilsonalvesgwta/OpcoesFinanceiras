-- WTA Options Intelligence — 0002: ponte com o MetaTrader 5 da corretora.
--
-- Um robô (Expert Advisor) dentro do MT5 do usuário envia cotações e posições
-- com uma chave própria da ponte. A chave pertence a um usuário; tudo o que
-- chega por ela é dado DESSE usuário e só ele vê (cotações da conta da
-- corretora são para uso pessoal: não podem aparecer para outras contas).
-- A ponte nunca envia ordens: só leitura.

create table pontes_mt5 (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users (id) on delete cascade,
  nome              text not null default 'MetaTrader 5' check (length(nome) between 1 and 60),
  token_hash        bytea not null unique,
  criada_em         timestamptz not null default now(),
  revogada_em       timestamptz,
  ultimo_contato_em timestamptz,
  ultimo_ip         inet,
  versao            text check (length(versao) <= 40),
  conta_login       text check (length(conta_login) <= 40),
  conta_servidor    text check (length(conta_servidor) <= 80),
  conta_corretora   text check (length(conta_corretora) <= 120)
);
create index pontes_mt5_usuario on pontes_mt5 (user_id) where revogada_em is null;

-- Última cotação de cada ativo, por usuário (uma linha por código).
create table cotacoes_ponte (
  user_id              uuid not null references users (id) on delete cascade,
  codigo               text not null check (codigo ~ '^[A-Z0-9]{4,16}$'),
  ponte_id             uuid not null references pontes_mt5 (id) on delete cascade,
  ultimo               integer check (ultimo >= 0),          -- centavos; null = sem negócio
  bid                  integer check (bid >= 0),
  ask                  integer check (ask >= 0),
  fechamento_anterior  integer check (fechamento_anterior >= 0),
  volume               bigint check (volume >= 0),
  instante_fonte       timestamptz not null,                  -- hora da última mudança no servidor da corretora (UTC)
  recebido_em          timestamptz not null default now(),
  primary key (user_id, codigo)
);

-- Posições abertas na conta da corretora, como o MT5 as mostra (substituídas a cada envio).
create table posicoes_ponte (
  user_id      uuid not null references users (id) on delete cascade,
  codigo       text not null check (codigo ~ '^[A-Z0-9]{4,16}$'),
  ponte_id     uuid not null references pontes_mt5 (id) on delete cascade,
  lado         text not null check (lado in ('compra', 'venda')),
  quantidade   bigint not null check (quantidade > 0),
  preco_medio  numeric(20, 4) not null check (preco_medio >= 0),  -- centavos, com fração
  recebido_em  timestamptz not null default now(),
  primary key (user_id, codigo)
);

alter table pontes_mt5     enable row level security;
alter table cotacoes_ponte enable row level security;
alter table posicoes_ponte enable row level security;

-- Só o dono vê e administra as próprias pontes; o hash da chave não é legível.
grant select (id, user_id, nome, criada_em, revogada_em, ultimo_contato_em, ultimo_ip, versao, conta_login, conta_servidor, conta_corretora)
  on pontes_mt5 to wtaopt_app;
grant insert (user_id, nome, token_hash) on pontes_mt5 to wtaopt_app;
grant update (revogada_em, nome) on pontes_mt5 to wtaopt_app;
create policy pontes_ver on pontes_mt5 for select to wtaopt_app using (user_id = app.eu());
create policy pontes_criar on pontes_mt5 for insert to wtaopt_app with check (user_id = app.eu());
create policy pontes_alterar on pontes_mt5 for update to wtaopt_app using (user_id = app.eu()) with check (user_id = app.eu());

-- Cotações e posições: leitura só do dono; escrita só pela função da ponte.
grant select on cotacoes_ponte, posicoes_ponte to wtaopt_app;
create policy cotacoes_ponte_dono on cotacoes_ponte for select to wtaopt_app using (user_id = app.eu());
create policy posicoes_ponte_dono on posicoes_ponte for select to wtaopt_app using (user_id = app.eu());

-- Ponte válida pela chave: não revogada e com dono ativo. Devolve o dono.
create function app.ponte_por_token(p_token_hash bytea)
returns table (ponte_id uuid, user_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.user_id from pontes_mt5 p join users u on u.id = p.user_id
  where p.token_hash = p_token_hash and p.revogada_em is null and u.situacao = 'ativo';
$$;

-- Códigos que a ponte deve acompanhar: os favoritos do dono e o que ele tem posição.
create function app.simbolos_da_ponte(p_token_hash bytea)
returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  with dono as (select user_id from app.ponte_por_token(p_token_hash))
  select codigo from favoritos where user_id = (select user_id from dono)
  union
  select codigo from posicoes_ponte where user_id = (select user_id from dono)
  order by 1;
$$;

-- Recebe um lote da ponte. Os valores já chegam validados e convertidos pela api;
-- aqui só se confere a chave e se grava. Cotação mais antiga que a guardada é ignorada
-- (chegada fora de ordem não volta o preço para trás).
-- p_cotacoes: [{codigo, ultimo, bid, ask, fechamento_anterior, volume, instante}]
-- p_posicoes: null = não mexe; [] = conta sem posições; [{codigo, lado, quantidade, preco_medio}]
create function app.receber_da_ponte(
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
      as c(codigo text, ultimo integer, bid integer, ask integer, fechamento_anterior integer, volume bigint, instante timestamptz)
  ), gravadas as (
    insert into cotacoes_ponte (user_id, codigo, ponte_id, ultimo, bid, ask, fechamento_anterior, volume, instante_fonte, recebido_em)
    select v_user, n.codigo, v_ponte, n.ultimo, n.bid, n.ask, n.fechamento_anterior, n.volume, n.instante, now() from novas n
    on conflict (user_id, codigo) do update set
      ponte_id = excluded.ponte_id, ultimo = excluded.ultimo, bid = excluded.bid, ask = excluded.ask,
      fechamento_anterior = excluded.fechamento_anterior, volume = excluded.volume,
      instante_fonte = excluded.instante_fonte, recebido_em = excluded.recebido_em
    where cotacoes_ponte.instante_fonte <= excluded.instante_fonte
    returning 1
  )
  select count(*) into v_gravadas from gravadas;

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

revoke execute on function app.ponte_por_token(bytea), app.simbolos_da_ponte(bytea),
  app.receber_da_ponte(bytea, inet, text, jsonb, jsonb, jsonb) from public;
grant execute on function app.ponte_por_token(bytea), app.simbolos_da_ponte(bytea),
  app.receber_da_ponte(bytea, inet, text, jsonb, jsonb, jsonb) to wtaopt_app;
