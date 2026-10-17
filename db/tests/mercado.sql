-- Testes dos dados de mercado e do calendário. Roda depois de acesso.sql e aproveita
-- o esquema "teste": chefe (superadmin), admina, a1 ativos; a2 suspenso.
\set ON_ERROR_STOP on
set client_min_messages = notice;

grant usage on schema teste to wtaopt_coleta;
grant execute on all functions in schema teste to wtaopt_coleta;

-- ============ Coleta (worker) ============
set role wtaopt_coleta;
do $$ begin
  insert into fechamentos (dia, codigo, tipo_mercado, ultimo, melhor_compra, melhor_venda, negocios, quantidade, volume)
  values ('2026-10-16', 'PETR4', 10, 3847, 3846, 3848, 1000, 500000, 1923500000),
         ('2026-10-16', 'PETRK380', 70, 93, 92, 95, 50, 30000, 2790000);
  insert into series_opcoes (codigo, vencimento, ativo_objeto, tipo, strike, visto_primeiro, visto_ultimo)
  values ('PETRK380', '2026-11-20', 'PETR4', 'call', 3800, '2026-10-16', '2026-10-16');
  insert into taxas_juros (serie, dia, valor, fonte) values ('selic', '2026-10-16', 14.9, 'bcb-sgs-1178');
  insert into importacoes (fonte, referencia, situacao, registros, recusados, iniciada_em) values ('b3-cotahist', '2026-10-16', 'ok', 2, 0, now());
  insert into pulso_coleta (nome, versao) values ('coleta-1', '0.1.0');
  insert into calculos_opcoes (dia, codigo, vencimento, ativo_objeto, spot, premio, origem_premio, dias_uteis, selic, vol_implicita, preco_teorico, delta, gamma, theta, vega, rho)
  values ('2026-10-16', 'PETRK380', '2026-11-20', 'PETR4', 3847, 93.5, 'meio_do_livro', 24, 14.9, 0.32, 0.935, 0.55, 0.12, -0.02, 0.05, 0.01);
  insert into calculos_opcoes (dia, codigo, vencimento, motivo) values ('2026-10-16', 'PETRX300', '2026-11-20', 'sem_premio');
  perform teste.espera_erro($q$insert into calculos_opcoes (dia, codigo, vencimento) values ('2026-10-16', 'PETRX301', '2026-11-20')$q$, 'check', 'cálculo sem resultado precisa dizer o motivo');
  perform teste.confere((select count(*) from feriados) >= 14, 'coleta lê o calendário');
  perform teste.espera_erro($q$select * from users$q$, 'permission denied', 'coleta não lê usuários');
  perform teste.espera_erro($q$select * from favoritos$q$, 'permission denied', 'coleta não lê favoritos');
  perform teste.espera_erro($q$select * from cotacoes_ponte$q$, 'permission denied', 'coleta não lê dados da ponte MT5');
  perform teste.espera_erro($q$insert into feriados (dia, descricao) values ('2026-12-30', 'x')$q$, 'permission denied', 'coleta não altera o calendário');
  perform teste.espera_erro($q$delete from importacoes$q$, 'permission denied', 'coleta não apaga o histórico de importações');
  perform teste.espera_erro($q$insert into fechamentos (dia, codigo, tipo_mercado, ultimo, negocios, quantidade, volume) values ('2026-10-16', 'VALE3', 10, 0, 0, 0, 0)$q$, 'check', 'preço zero é recusado (ausente fica null)');
end $$;
reset role;

set role wtaopt_app;

-- ============ Sem usuário: nada ============
select set_config('app.user_id', '', false);
do $$ begin
  perform teste.confere((select count(*) from fechamentos) = 0, 'sem usuário não se lê fechamento');
  perform teste.confere((select count(*) from feriados) >= 14, 'o calendário é público (a api precisa dele antes do login)');
end $$;

-- ============ Usuário comum ============
select teste.entrar('a1@exemplo.test');
do $$ begin
  perform teste.confere((select ultimo from fechamentos where codigo = 'PETR4') = 3847, 'usuário lê fechamentos (dado público)');
  perform teste.confere((select strike from series_opcoes where codigo = 'PETRK380') = 3800, 'usuário lê séries de opções');
  perform teste.confere((select valor from taxas_juros where serie = 'selic') = 14.9, 'usuário lê a Selic');
  perform teste.confere((select vol_implicita from calculos_opcoes where codigo = 'PETRK380') = 0.32, 'usuário lê os cálculos das opções');
  perform teste.espera_erro($q$delete from calculos_opcoes$q$, 'permission denied', 'aplicação não apaga cálculos');
  perform teste.confere((select count(*) from feriados where dia = '2026-11-20') = 1, 'calendário de 2026 já vem com os feriados da B3');
  perform teste.confere((select abertura from sessoes_especiais where dia = '2026-02-18') = '13:00', 'quarta de Cinzas abre às 13h');
  perform teste.confere((select count(*) from importacoes) = 0, 'usuário não lê o diagnóstico');
  perform teste.espera_erro($q$insert into feriados (dia, descricao) values ('2026-12-30', 'x')$q$, 'row-level security', 'usuário não cria feriado');
  perform teste.espera_erro($q$insert into fechamentos (dia, codigo, tipo_mercado, negocios, quantidade, volume) values ('2026-10-16', 'VALE3', 10, 0, 0, 0)$q$, 'permission denied', 'aplicação não escreve fechamento');
  delete from feriados where dia = '2026-11-20';
  perform teste.confere(not found, 'usuário não apaga feriado');
end $$;

-- ============ Administrador da organização também não mexe no calendário ============
select teste.entrar('admina@exemplo.test');
do $$ begin
  perform teste.espera_erro($q$insert into feriados (dia, descricao) values ('2026-12-30', 'x')$q$, 'row-level security', 'admin não cria feriado');
  perform teste.confere((select count(*) from pulso_coleta) = 0, 'admin não lê o diagnóstico');
end $$;

-- ============ Superadministrador ============
select teste.entrar('chefe@exemplo.test');
do $$ begin
  insert into feriados (dia, descricao, criado_por) values ('2027-01-01', 'Confraternização Universal', app.uid());
  perform teste.confere((select count(*) from feriados where dia = '2027-01-01') = 1, 'superadmin cadastra feriado');
  delete from feriados where dia = '2027-01-01';
  perform teste.confere(found, 'superadmin remove feriado');
  perform teste.confere((select situacao from importacoes limit 1) = 'ok', 'superadmin lê importações');
  perform teste.confere((select count(*) from pulso_coleta) = 1, 'superadmin lê o pulso da coleta');
  perform teste.espera_erro($q$insert into sessoes_especiais (dia, abertura, fechamento, descricao) values ('2027-02-10', '17:00', '13:00', 'x')$q$, 'check', 'sessão especial com fechamento antes da abertura é recusada');
end $$;

-- ============ Conta suspensa ============
select teste.entrar('a2@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from fechamentos) + (select count(*) from series_opcoes) + (select count(*) from calculos_opcoes) = 0, 'conta suspensa não lê dados de mercado');
end $$;

reset role;
do $$ begin
  perform teste.confere(not exists (select 1 from pg_roles where rolname = 'wtaopt_coleta' and (rolbypassrls or rolsuper)), 'papel de coleta não ignora RLS');
  perform teste.confere(not exists (select 1 from pg_tables t join pg_class c on c.relname = t.tablename where t.schemaname = 'public' and not c.relrowsecurity), 'toda tabela continua com RLS ligada');
end $$;

\echo 'MERCADO: todos os testes passaram'
