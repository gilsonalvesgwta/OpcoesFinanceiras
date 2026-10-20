-- WTA Options Intelligence — 0007: posições (estratégias e execuções).
--
-- A posição nunca é editada direto: ela é a consequência das execuções registradas
-- (abrir, encerrar em parte, rolar). Tudo é do dono (RLS); nem admin lê.

create table estrategias (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  nome          text not null check (length(trim(nome)) between 1 and 80),
  ativo_objeto  text not null check (ativo_objeto ~ '^[A-Z0-9]{4,12}$'),
  observacao    text check (length(observacao) <= 1000),
  situacao      text not null default 'aberta' check (situacao in ('aberta', 'encerrada')),
  criada_em     timestamptz not null default now(),
  encerrada_em  timestamptz
);
create index estrategias_dono on estrategias (user_id, situacao, criada_em desc);

create table execucoes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  estrategia_id uuid not null references estrategias (id) on delete cascade,
  codigo        text not null check (codigo ~ '^[A-Z0-9]{4,12}$'),
  tipo          text not null check (tipo in ('call', 'put', 'ativo')),
  strike        bigint check (strike > 0),            -- centavos
  vencimento    date,
  multiplicador integer not null default 1 check (multiplicador between 1 and 10000),
  lado          text not null check (lado in ('compra', 'venda')),
  quantidade    integer not null check (quantidade > 0),
  preco         bigint not null check (preco >= 0),  -- centavos por unidade
  custos        bigint not null default 0 check (custos >= 0), -- centavos, total da execução
  instante      timestamptz not null,
  origem        text not null default 'manual' check (origem in ('manual', 'importada_mt5')),
  observacao    text check (length(observacao) <= 300),
  criada_em     timestamptz not null default now(),
  check ((tipo = 'ativo') = (strike is null and vencimento is null))
);
create index execucoes_estrategia on execucoes (estrategia_id, instante);

alter table estrategias enable row level security;
alter table execucoes   enable row level security;
grant select, insert, update, delete on estrategias, execucoes to wtaopt_app;
create policy estrategias_dono on estrategias for all to wtaopt_app using (user_id = app.eu()) with check (user_id = app.eu());
create policy execucoes_dono on execucoes for all to wtaopt_app using (user_id = app.eu()) with check (
  user_id = app.eu() and exists (select 1 from estrategias e where e.id = estrategia_id and e.user_id = app.eu())
);
