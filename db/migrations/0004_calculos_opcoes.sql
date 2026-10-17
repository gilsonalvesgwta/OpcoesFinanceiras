-- WTA Options Intelligence — 0004: volatilidade implícita e gregas do fechamento.
--
-- Calculadas pelo worker a partir do COTAHIST e da Selic (cálculo do sistema, não
-- dado observado). Cada linha guarda o prêmio usado e de onde ele veio, para a
-- interface mostrar junto das premissas. Quando não dá para calcular, a linha
-- existe com o motivo e os números ficam null (nunca zero).

create table calculos_opcoes (
  dia            date not null,
  codigo         text not null check (codigo ~ '^[A-Z0-9]{4,12}$'),
  vencimento     date not null,
  ativo_objeto   text,
  spot           bigint check (spot > 0),            -- centavos
  premio         numeric(14, 2) check (premio > 0),   -- centavos (meio do livro pode ter meio centavo)
  origem_premio  text check (origem_premio in ('meio_do_livro', 'ultimo_negocio')),
  dias_uteis     integer,
  selic          numeric(10, 6),                      -- % ao ano usada
  vol_implicita  double precision,
  preco_teorico  double precision,                    -- reais
  delta          double precision,
  gamma          double precision,
  theta          double precision,                    -- reais por dia útil
  vega           double precision,                    -- reais por 1 ponto de volatilidade
  rho            double precision,                    -- reais por 1 ponto de juros
  motivo         text check (motivo in ('vencida', 'vence_no_dia', 'sem_premio', 'sem_ativo_objeto', 'sem_selic',
                                        'abaixo_do_valor_intrinseco', 'acima_do_limite', 'nao_convergiu')),
  calculado_em   timestamptz not null default now(),
  primary key (dia, codigo),
  check ((motivo is null) = (vol_implicita is not null))
);
create index calculos_opcoes_objeto on calculos_opcoes (ativo_objeto, dia desc, vencimento);

alter table calculos_opcoes enable row level security;
grant select on calculos_opcoes to wtaopt_app;
create policy calculos_ler on calculos_opcoes for select to wtaopt_app using (app.eu() is not null);
grant select, insert, update, delete on calculos_opcoes to wtaopt_coleta;
create policy coleta_calculos on calculos_opcoes for all to wtaopt_coleta using (true) with check (true);
