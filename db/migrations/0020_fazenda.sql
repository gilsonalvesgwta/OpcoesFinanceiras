-- WTA Options Intelligence — 0020: Vaca (Fazenda).
--
-- Cada "vaca" é uma estrutura de venda de call e put de BOVA11 (ou outro ativo) rolada
-- semana a semana / mês a mês para "ordenhar" prêmio. As operações da vaca vêm da planilha
-- antiga (importada uma vez), das notas/extrato (execuções distribuídas sozinhas pelo
-- tamanho da perna, ou à mão) ou de lançamentos manuais. Tudo é do dono (RLS).

create table vacas (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  nome         text not null check (length(trim(nome)) between 1 and 40),
  ativo_objeto text not null default 'BOVA11' check (ativo_objeto ~ '^[A-Z0-9]{4,12}$'),
  data_inicio  date not null,
  margem       bigint not null default 0 check (margem >= 0),          -- centavos (garantia reservada)
  quantidade   integer check (quantidade > 0),                          -- tamanho da perna (distribuição automática)
  distancia    numeric(4,3) not null default 0.100 check (distancia > 0 and distancia < 1), -- alerta de strike distante
  situacao     text not null default 'ativa' check (situacao in ('ativa', 'encerrada')),
  observacao   text check (length(observacao) <= 500),
  criada_em    timestamptz not null default now(),
  unique (user_id, nome)
);

create table vaca_operacoes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  vaca_id      uuid not null references vacas (id) on delete cascade,
  execucao_id  uuid unique references execucoes (id) on delete cascade,
  data         date not null,
  lado         text not null check (lado in ('compra', 'venda')),
  tipo         text not null check (tipo in ('call', 'put', 'ativo')),
  prazo        text check (prazo in ('CURTA', 'LONGA')),
  quantidade   integer not null check (quantidade > 0),
  ticker       text not null check (length(ticker) between 1 and 16),
  strike       bigint check (strike > 0),
  vencimento   date,
  preco        numeric(16,4) not null check (preco >= 0),   -- centavos por unidade (preço médio pode ter fração)
  custos       bigint not null default 0 check (custos >= 0),
  em_custodia  boolean,                                       -- da planilha; nulo = calculado
  origem       text not null check (origem in ('planilha', 'nota', 'manual')),
  criada_em    timestamptz not null default now()
);
create index vaca_operacoes_vaca on vaca_operacoes (vaca_id, data);

alter table vacas enable row level security;
alter table vaca_operacoes enable row level security;
grant select, insert, update, delete on vacas, vaca_operacoes to wtaopt_app;
create policy vacas_dono on vacas for all to wtaopt_app using (user_id = app.eu()) with check (user_id = app.eu());
create policy vaca_operacoes_dono on vaca_operacoes for all to wtaopt_app using (user_id = app.eu()) with check (
  user_id = app.eu() and exists (select 1 from vacas v where v.id = vaca_id and v.user_id = app.eu())
);
