-- WTA Options Intelligence — 0010: cotações de ações pela brapi (plano gratuito).
--
-- Plano B para o preço das ações durante o pregão quando a ponte MT5 não está ligada:
-- cerca de 30 minutos de atraso, só ações. É dado de mercado (todos os usuários leem,
-- como o fechamento da B3); quem grava é o worker (wtaopt_coleta). A cota do mês é
-- contada aqui para não passar das 15 mil consultas do plano gratuito.

create table cotacoes_brapi (
  codigo                text primary key check (codigo ~ '^[A-Z0-9]{4,12}$'),
  ultimo                bigint not null check (ultimo > 0),       -- centavos
  fechamento_anterior   bigint check (fechamento_anterior > 0),
  volume                bigint check (volume >= 0),
  instante_fonte        timestamptz not null,                     -- hora do último negócio (com o atraso da brapi)
  recebido_em           timestamptz not null default now(),
  alertas_avaliados_em  timestamptz                               -- última vez que a api avaliou alertas com esta cotação
);

create table uso_brapi (
  mes           text primary key check (mes ~ '^\d{4}-\d{2}$'),
  consultas     integer not null default 0,
  ultima_falha  text check (length(ultima_falha) <= 300),
  atualizado_em timestamptz not null default now()
);

alter table cotacoes_brapi enable row level security;
alter table uso_brapi      enable row level security;
grant select on cotacoes_brapi, uso_brapi to wtaopt_app;
create policy cotacoes_brapi_ler on cotacoes_brapi for select to wtaopt_app using (app.eu() is not null);
create policy uso_brapi_ler on uso_brapi for select to wtaopt_app using (app.eu() is not null);
grant select, insert, update on cotacoes_brapi, uso_brapi to wtaopt_coleta;
create policy coleta_cotacoes_brapi on cotacoes_brapi for all to wtaopt_coleta using (true) with check (true);
create policy coleta_uso_brapi on uso_brapi for all to wtaopt_coleta using (true) with check (true);

-- Para o worker: que ações consultar, por ordem de importância (alertas que aceitam
-- dado periódico, depois ativos das estratégias abertas, depois favoritos). Só ações
-- (4 letras + dígitos), só de usuários ativos. Não revela de quem é cada código.
create function app.codigos_para_brapi()
returns table (codigo text, prioridade integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select codigo, min(prioridade)::int from (
    select r.codigo, 1 as prioridade from regras_alerta r join users u on u.id = r.user_id and u.situacao = 'ativo'
      where r.ativa and r.aceitar_periodica
    union all
    select e.ativo_objeto, 2 from estrategias e join users u on u.id = e.user_id and u.situacao = 'ativo' where e.situacao = 'aberta'
    union all
    select f.codigo, 3 from favoritos f join users u on u.id = f.user_id and u.situacao = 'ativo'
  ) x
  where codigo ~ '^[A-Z]{4}[0-9]{1,2}$'
  group by codigo
  order by 2, 1
$$;

-- Para a api: cotações da brapi ainda não avaliadas nos alertas, com os donos das regras
-- que aceitam dado periódico. Marca como avaliadas na mesma chamada.
create function app.brapi_para_alertas()
returns table (codigo text, ultimo bigint, fechamento_anterior bigint, volume bigint, instante_fonte timestamptz, usuarios uuid[])
language sql volatile security definer set search_path = public, pg_temp as $$
  with pendentes as (
    update cotacoes_brapi q set alertas_avaliados_em = q.recebido_em
    where q.alertas_avaliados_em is null or q.alertas_avaliados_em < q.recebido_em
    returning q.codigo, q.ultimo, q.fechamento_anterior, q.volume, q.instante_fonte
  )
  select p.codigo, p.ultimo, p.fechamento_anterior, p.volume, p.instante_fonte,
         array(select distinct r.user_id from regras_alerta r join users u on u.id = r.user_id and u.situacao = 'ativo'
               where r.codigo = p.codigo and r.ativa and r.aceitar_periodica)
  from pendentes p
$$;

revoke execute on function app.codigos_para_brapi(), app.brapi_para_alertas() from public;
grant execute on function app.codigos_para_brapi() to wtaopt_coleta;
grant execute on function app.brapi_para_alertas() to wtaopt_app;

alter table importacoes drop constraint importacoes_fonte_check;
alter table importacoes add constraint importacoes_fonte_check check (fonte in ('b3-cotahist', 'b3-cotahist-mensal', 'bcb-selic', 'brapi'));
