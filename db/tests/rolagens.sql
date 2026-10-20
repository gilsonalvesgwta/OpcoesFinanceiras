-- Testes de rolagens. Roda depois de posicoes.sql: a1 já tem a estratégia "Venda coberta".
\set ON_ERROR_STOP on
set client_min_messages = notice;
set role wtaopt_app;

select teste.entrar('a1@exemplo.test');
do $$
declare v_e uuid := (select id from estrategias where nome = 'Venda coberta');
        v_outra uuid;
        v_r uuid;
begin
  insert into rolagens (user_id, estrategia_id, instante, resumo) values (app.uid(), v_e, now(), '{"fluxo": {"liquido": -4000}}') returning id into v_r;
  insert into execucoes (user_id, estrategia_id, rolagem_id, codigo, tipo, strike, vencimento, lado, quantidade, preco, instante)
  values (app.uid(), v_e, v_r, 'PETRK380', 'call', 3800, '2026-11-20', 'compra', 100, 140, now()),
         (app.uid(), v_e, v_r, 'PETRL400', 'call', 4000, '2026-12-18', 'venda', 100, 100, now());
  perform teste.confere((select count(*) from execucoes where rolagem_id = v_r) = 2, 'execuções ligadas à rolagem');
  insert into estrategias (user_id, nome, ativo_objeto) values (app.uid(), 'Outra', 'VALE3') returning id into v_outra;
  perform teste.espera_erro(format($q$insert into execucoes (user_id, estrategia_id, rolagem_id, codigo, tipo, lado, quantidade, preco, instante) values (app.uid(), %L, %L, 'VALE3', 'ativo', 'compra', 1, 1, now())$q$, v_outra, v_r), 'rolagem_de_outra_estrategia', 'execução não entra em rolagem de outra estratégia');
  delete from rolagens where id = v_r;
  perform teste.confere((select count(*) from execucoes where codigo in ('PETRK380', 'PETRL400') and lado = 'compra' and preco = 140) = 0, 'desfazer a rolagem apaga só as execuções dela');
  perform teste.confere((select count(*) from execucoes) = 2, 'as execuções de antes continuam');
  insert into rolagens (user_id, estrategia_id, instante) values (app.uid(), v_e, now());
end $$;

select teste.entrar('b1@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from rolagens) = 0, 'outro usuário não vê rolagens alheias');
end $$;
reset role;
do $$
declare v_e uuid := (select id from estrategias where nome = 'Venda coberta');
begin
  set local role wtaopt_app;
  perform teste.entrar('b1@exemplo.test');
  perform teste.espera_erro(format($q$insert into rolagens (user_id, estrategia_id, instante) values (app.uid(), %L, now())$q$, v_e), 'row-level security', 'ninguém cria rolagem na estratégia de outro');
end $$;
reset role;

\echo 'ROLAGENS: todos os testes passaram'
