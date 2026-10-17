-- WTA Options Intelligence — 0003: dados de mercado gratuitos e calendário.
--
-- Fontes (decisão de 16/10/2026: só gratuitas no início):
--   B3, arquivo diário COTAHIST: fechamento de todas as ações e opções;
--   Banco Central (SGS 1178): Selic anualizada, premissa do modelo de preço.
-- São dados públicos: qualquer conta ativa lê. Só o papel de coleta (worker)
-- escreve, e ele não alcança nenhuma tabela de usuários.
-- Calendário: feriados e sessões especiais editáveis pelo superadministrador.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'wtaopt_coleta') then
    create role wtaopt_coleta nologin nobypassrls;
  end if;
end $$;
grant usage on schema public to wtaopt_coleta;

-- ---------------------------------------------------------------------------
-- Calendário
-- ---------------------------------------------------------------------------

create table feriados (
  dia         date primary key,
  descricao   text not null check (length(trim(descricao)) between 1 and 120),
  criado_por  uuid references users (id) on delete set null,
  criado_em   timestamptz not null default now()
);

create table sessoes_especiais (
  dia         date primary key,
  abertura    time not null,
  fechamento  time not null check (fechamento > abertura),
  descricao   text not null check (length(trim(descricao)) between 1 and 120),
  criado_por  uuid references users (id) on delete set null,
  criado_em   timestamptz not null default now()
);

-- Calendário oficial de 2026 publicado pela B3 (conferido em 17/10/2026).
-- 9 de julho tem pregão normal; 18/02 (Cinzas) abre às 13h.
insert into feriados (dia, descricao) values
  ('2026-01-01', 'Confraternização Universal'),
  ('2026-02-16', 'Carnaval'),
  ('2026-02-17', 'Carnaval'),
  ('2026-04-03', 'Sexta-feira Santa'),
  ('2026-04-21', 'Tiradentes'),
  ('2026-05-01', 'Dia do Trabalho'),
  ('2026-06-04', 'Corpus Christi'),
  ('2026-09-07', 'Independência do Brasil'),
  ('2026-10-12', 'Nossa Senhora Aparecida'),
  ('2026-11-02', 'Finados'),
  ('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2026-12-24', 'Véspera de Natal'),
  ('2026-12-25', 'Natal'),
  ('2026-12-31', 'Último dia do ano');
insert into sessoes_especiais (dia, abertura, fechamento, descricao) values
  ('2026-02-18', '13:00', '17:00', 'Quarta-feira de Cinzas');

-- ---------------------------------------------------------------------------
-- Mercado
-- ---------------------------------------------------------------------------

-- Fechamento de cada instrumento em cada pregão, como o COTAHIST traz.
-- Preços em centavos; ausente fica null (zero no arquivo = sem negócio/sem oferta).
create table fechamentos (
  dia            date not null,
  codigo         text not null check (codigo ~ '^[A-Z0-9]{4,12}$'),
  tipo_mercado   smallint not null,
  especificacao  text,
  abertura       bigint check (abertura > 0),
  maxima         bigint check (maxima > 0),
  minima         bigint check (minima > 0),
  media          bigint check (media > 0),
  ultimo         bigint check (ultimo > 0),
  melhor_compra  bigint check (melhor_compra > 0),
  melhor_venda   bigint check (melhor_venda > 0),
  negocios       integer not null check (negocios >= 0),
  quantidade     bigint not null check (quantidade >= 0),
  volume         bigint not null check (volume >= 0), -- centavos
  primary key (dia, codigo)
);
create index fechamentos_codigo on fechamentos (codigo, dia desc);

-- Séries de opções. O mesmo código volta a ser usado em outros anos: a chave inclui o vencimento.
create table series_opcoes (
  codigo         text not null check (codigo ~ '^[A-Z0-9]{4,12}$'),
  vencimento     date not null,
  ativo_objeto   text, -- null quando não deu para identificar com segurança
  tipo           text not null check (tipo in ('call', 'put')),
  strike         bigint not null check (strike > 0), -- centavos
  isin           text,
  estilo         text check (estilo in ('americana', 'europeia')), -- o COTAHIST não informa
  visto_primeiro date not null,
  visto_ultimo   date not null,
  primary key (codigo, vencimento)
);
create index series_opcoes_objeto on series_opcoes (ativo_objeto, vencimento);

create table taxas_juros (
  serie   text not null check (serie in ('selic')),
  dia     date not null,
  valor   numeric(10, 6) not null, -- % ao ano
  fonte   text not null,
  primary key (serie, dia)
);

-- Registro de cada tentativa de coleta (diagnóstico).
create table importacoes (
  id           bigint generated always as identity primary key,
  fonte        text not null check (fonte in ('b3-cotahist', 'bcb-selic')),
  referencia   date, -- pregão do arquivo; null para a Selic
  situacao     text not null check (situacao in ('ok', 'sem_arquivo', 'erro')),
  registros    integer,
  recusados    integer,
  detalhe      text check (length(detalhe) <= 500),
  iniciada_em  timestamptz not null,
  terminada_em timestamptz not null default now()
);
create index importacoes_recentes on importacoes (fonte, referencia, terminada_em desc);

-- Pulso do worker (um registro por processo de coleta).
create table pulso_coleta (
  nome         text primary key,
  versao       text,
  visto_em     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Permissões e regras por linha
-- ---------------------------------------------------------------------------

alter table feriados          enable row level security;
alter table sessoes_especiais enable row level security;
alter table fechamentos       enable row level security;
alter table series_opcoes     enable row level security;
alter table taxas_juros       enable row level security;
alter table importacoes       enable row level security;
alter table pulso_coleta      enable row level security;

-- Calendário: público (a api precisa dele antes de saber quem é o usuário); só o superadministrador altera.
grant select, insert, update, delete on feriados, sessoes_especiais to wtaopt_app;
create policy feriados_ler on feriados for select to wtaopt_app using (true);
create policy feriados_criar on feriados for insert to wtaopt_app with check (app.papel() = 'superadmin');
create policy feriados_alterar on feriados for update to wtaopt_app using (app.papel() = 'superadmin') with check (app.papel() = 'superadmin');
create policy feriados_apagar on feriados for delete to wtaopt_app using (app.papel() = 'superadmin');
create policy sessoes_ler on sessoes_especiais for select to wtaopt_app using (true);
create policy sessoes_criar on sessoes_especiais for insert to wtaopt_app with check (app.papel() = 'superadmin');
create policy sessoes_alterar on sessoes_especiais for update to wtaopt_app using (app.papel() = 'superadmin') with check (app.papel() = 'superadmin');
create policy sessoes_apagar on sessoes_especiais for delete to wtaopt_app using (app.papel() = 'superadmin');

-- Mercado: toda conta ativa lê; a aplicação não escreve.
grant select on fechamentos, series_opcoes, taxas_juros to wtaopt_app;
create policy fechamentos_ler on fechamentos for select to wtaopt_app using (app.eu() is not null);
create policy series_ler on series_opcoes for select to wtaopt_app using (app.eu() is not null);
create policy taxas_ler on taxas_juros for select to wtaopt_app using (app.eu() is not null);

-- Diagnóstico: só o superadministrador lê.
grant select on importacoes, pulso_coleta to wtaopt_app;
create policy importacoes_ler on importacoes for select to wtaopt_app using (app.papel() = 'superadmin');
create policy pulso_ler on pulso_coleta for select to wtaopt_app using (app.papel() = 'superadmin');

-- Coleta: lê o calendário, escreve só dados de mercado e o próprio registro.
grant select on feriados, sessoes_especiais to wtaopt_coleta;
grant select, insert, update on fechamentos, series_opcoes, taxas_juros, pulso_coleta to wtaopt_coleta;
grant select, insert on importacoes to wtaopt_coleta;
create policy coleta_feriados on feriados for select to wtaopt_coleta using (true);
create policy coleta_sessoes on sessoes_especiais for select to wtaopt_coleta using (true);
create policy coleta_fechamentos on fechamentos for all to wtaopt_coleta using (true) with check (true);
create policy coleta_series on series_opcoes for all to wtaopt_coleta using (true) with check (true);
create policy coleta_taxas on taxas_juros for all to wtaopt_coleta using (true) with check (true);
create policy coleta_importacoes on importacoes for all to wtaopt_coleta using (true) with check (true);
create policy coleta_pulso on pulso_coleta for all to wtaopt_coleta using (true) with check (true);
grant usage on all sequences in schema public to wtaopt_coleta;
