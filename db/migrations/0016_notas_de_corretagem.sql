-- WTA Options Intelligence — 0016: notas de corretagem importadas.
--
-- O PDF não é guardado: só o que dele se aproveita (corretora, número, data, custos e os
-- negócios, que viram execuções com o custo exato rateado). CPF, endereço e conta que
-- aparecem na nota não são gravados. A mesma nota (corretora + número + data) não entra
-- duas vezes para o mesmo usuário. Apagar a nota apaga as execuções que vieram dela.

create table notas_corretagem (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  corretora    text not null check (length(corretora) between 1 and 120),
  numero       text not null check (numero ~ '^[0-9]{1,12}$'),
  data_pregao  date not null,
  custos       jsonb not null default '{}'::jsonb,
  custo_total  bigint not null check (custo_total >= 0),
  irrf         bigint not null default 0 check (irrf >= 0),
  liquido      bigint,
  conferida    boolean not null,
  importada_em timestamptz not null default now(),
  unique (user_id, corretora, numero, data_pregao)
);
alter table notas_corretagem enable row level security;
grant select, insert, delete on notas_corretagem to wtaopt_app;
create policy notas_dono on notas_corretagem for all to wtaopt_app using (user_id = app.eu()) with check (user_id = app.eu());

alter table execucoes add column nota_id uuid references notas_corretagem (id) on delete cascade;
create index execucoes_nota on execucoes (nota_id) where nota_id is not null;
alter table execucoes drop constraint execucoes_origem_check;
alter table execucoes add constraint execucoes_origem_check check (origem in ('manual', 'importada_mt5', 'nota_corretagem', 'posicao_inicial'));
