-- WTA Options Intelligence — 0011: carteiras simuladas.
--
-- Montagens feitas no Simulador e guardadas para acompanhar com o preço real, sem
-- nenhuma ligação com as posições reais (tabelas próprias). Cada operação simulada é uma
-- execução fictícia: montar, ajustar e rolar viram execuções novas; nada é editado.
-- Tudo do dono (RLS).

create table simulacoes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  nome          text not null check (length(trim(nome)) between 1 and 80),
  ativo_objeto  text not null check (ativo_objeto ~ '^[A-Z0-9]{4,12}$'),
  observacao    text check (length(observacao) <= 1000),
  situacao      text not null default 'aberta' check (situacao in ('aberta', 'encerrada')),
  criada_em     timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index simulacoes_dono on simulacoes (user_id, situacao, atualizada_em desc);

create table execucoes_simuladas (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  simulacao_id  uuid not null references simulacoes (id) on delete cascade,
  codigo        text not null check (codigo ~ '^[A-Z0-9]{4,12}$'),
  tipo          text not null check (tipo in ('call', 'put', 'ativo')),
  strike        bigint check (strike > 0),
  vencimento    date,
  multiplicador integer not null default 1 check (multiplicador between 1 and 10000),
  lado          text not null check (lado in ('compra', 'venda')),
  quantidade    integer not null check (quantidade > 0),
  preco         bigint not null check (preco >= 0),
  custos        bigint not null default 0 check (custos >= 0),
  vol           double precision check (vol > 0 and vol < 5), -- volatilidade usada na montagem (referência)
  instante      timestamptz not null,
  observacao    text check (length(observacao) <= 300),
  criada_em     timestamptz not null default now(),
  check ((tipo = 'ativo') = (strike is null and vencimento is null))
);
create index execucoes_simuladas_simulacao on execucoes_simuladas (simulacao_id, instante);

alter table simulacoes          enable row level security;
alter table execucoes_simuladas enable row level security;
grant select, insert, update, delete on simulacoes, execucoes_simuladas to wtaopt_app;
create policy simulacoes_dono on simulacoes for all to wtaopt_app using (user_id = app.eu()) with check (user_id = app.eu());
create policy execucoes_simuladas_dono on execucoes_simuladas for all to wtaopt_app using (user_id = app.eu()) with check (
  user_id = app.eu() and exists (select 1 from simulacoes s where s.id = simulacao_id and s.user_id = app.eu())
);
