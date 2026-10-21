-- Testes das carteiras simuladas.
\set ON_ERROR_STOP on
set client_min_messages = notice;
set role wtaopt_app;

select teste.entrar('a1@exemplo.test');
do $$
declare v_s uuid;
begin
  insert into simulacoes (user_id, nome, ativo_objeto) values (app.uid(), 'Trava simulada', 'PETR4') returning id into v_s;
  insert into execucoes_simuladas (user_id, simulacao_id, codigo, tipo, strike, vencimento, lado, quantidade, preco, vol, instante)
  values (app.uid(), v_s, 'PETRK380', 'call', 3800, '2026-11-23', 'compra', 100, 120, 0.3, now());
  perform teste.confere((select count(*) from execucoes_simuladas) = 1, 'dono simula');
  perform teste.confere((select count(*) from execucoes) = (select count(*) from execucoes), 'tabelas separadas das posições reais');
  perform teste.espera_erro(format($q$insert into execucoes_simuladas (user_id, simulacao_id, codigo, tipo, lado, quantidade, preco, instante) values (app.uid(), %L, 'PETRK380', 'call', 'compra', 1, 1, now())$q$, v_s), 'check', 'opção sem strike é recusada');
  perform teste.espera_erro(format($q$insert into execucoes_simuladas (user_id, simulacao_id, codigo, tipo, strike, vencimento, lado, quantidade, preco, vol, instante) values (app.uid(), %L, 'PETRK380', 'call', 3800, '2026-11-23', 'compra', 1, 1, 9, now())$q$, v_s), 'check', 'volatilidade absurda é recusada');
end $$;

select teste.entrar('b1@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from simulacoes) + (select count(*) from execucoes_simuladas) = 0, 'outro usuário não vê simulações alheias');
end $$;
reset role;
do $$
declare v_s uuid := (select id from simulacoes where nome = 'Trava simulada');
begin
  set local role wtaopt_app;
  perform teste.entrar('a2@exemplo.test');
  perform teste.espera_erro(format($q$insert into execucoes_simuladas (user_id, simulacao_id, codigo, tipo, lado, quantidade, preco, instante) values (app.uid(), %L, 'PETR4', 'ativo', 'compra', 1, 1, now())$q$, v_s), 'row-level security', 'ninguém opera na simulação de outro');
end $$;
reset role;

\echo 'SIMULACOES: todos os testes passaram'
