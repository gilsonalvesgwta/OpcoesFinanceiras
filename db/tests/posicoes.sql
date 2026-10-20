-- Testes de posições. Roda depois de acesso.sql: a1 e b1 ativos.
\set ON_ERROR_STOP on
set client_min_messages = notice;
set role wtaopt_app;

select teste.entrar('a1@exemplo.test');
do $$
declare v_e uuid;
begin
  insert into estrategias (user_id, nome, ativo_objeto) values (app.uid(), 'Venda coberta', 'PETR4') returning id into v_e;
  insert into execucoes (user_id, estrategia_id, codigo, tipo, lado, quantidade, preco, instante) values (app.uid(), v_e, 'PETR4', 'ativo', 'compra', 100, 3655, now());
  insert into execucoes (user_id, estrategia_id, codigo, tipo, strike, vencimento, lado, quantidade, preco, custos, instante)
  values (app.uid(), v_e, 'PETRK380', 'call', 3800, '2026-11-20', 'venda', 100, 72, 150, now());
  perform teste.confere((select count(*) from execucoes) = 2, 'dono registra execuções');
  perform teste.espera_erro(format($q$insert into execucoes (user_id, estrategia_id, codigo, tipo, lado, quantidade, preco, instante) values (app.uid(), %L, 'PETRK380', 'call', 'compra', 1, 1, now())$q$, v_e), 'check', 'opção sem strike e vencimento é recusada');
  perform teste.espera_erro(format($q$insert into execucoes (user_id, estrategia_id, codigo, tipo, strike, vencimento, lado, quantidade, preco, instante) values (app.uid(), %L, 'PETR4', 'ativo', 100, '2026-11-20', 'compra', 1, 1, now())$q$, v_e), 'check', 'ação com strike é recusada');
  perform teste.espera_erro(format($q$insert into execucoes (user_id, estrategia_id, codigo, tipo, lado, quantidade, preco, instante) values (app.uid(), %L, 'PETR4', 'ativo', 'compra', 0, 1, now())$q$, v_e), 'check', 'quantidade zero é recusada');
end $$;

select teste.entrar('b1@exemplo.test');
do $$
declare v_alheia uuid := (select id from estrategias limit 1);
begin
  perform teste.confere((select count(*) from estrategias) + (select count(*) from execucoes) = 0, 'outro usuário não vê posições alheias');
  perform teste.confere(v_alheia is null, 'nem o id');
end $$;
reset role;
do $$
declare v_e uuid := (select id from estrategias limit 1);
begin
  set local role wtaopt_app;
  perform teste.entrar('b1@exemplo.test');
  perform teste.espera_erro(format($q$insert into execucoes (user_id, estrategia_id, codigo, tipo, lado, quantidade, preco, instante) values (app.uid(), %L, 'PETR4', 'ativo', 'compra', 1, 1, now())$q$, v_e), 'row-level security', 'ninguém registra execução na estratégia de outro');
end $$;
reset role;

set role wtaopt_app;
select teste.entrar('admina@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from estrategias) = 0, 'admin da organização não vê posições dos usuários');
end $$;
reset role;

\echo 'POSICOES: todos os testes passaram'
