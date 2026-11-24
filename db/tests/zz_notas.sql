-- Notas de corretagem: só do dono, sem duplicar, e apagar a nota apaga as execuções dela.
\set ON_ERROR_STOP on
set client_min_messages = notice;
set role wtaopt_app;
select teste.entrar('a1@exemplo.test');
do $$
declare v_nota uuid; v_est uuid;
begin
  insert into notas_corretagem (user_id, corretora, numero, data_pregao, custo_total, conferida)
  values (app.eu(), 'BTG Pactual CTVM S.A.', '36040964', '2026-11-19', 41, true) returning id into v_nota;
  insert into estrategias (user_id, nome, ativo_objeto) values (app.eu(), 'Carteira NOTA3', 'NOTA3') returning id into v_est;
  insert into execucoes (user_id, estrategia_id, codigo, tipo, lado, quantidade, preco, custos, instante, origem, nota_id)
  values (app.eu(), v_est, 'NOTA3', 'ativo', 'compra', 100, 1412, 41, '2026-11-19T13:00:00Z', 'nota_corretagem', v_nota);
  begin
    insert into notas_corretagem (user_id, corretora, numero, data_pregao, custo_total, conferida)
    values (app.eu(), 'BTG Pactual CTVM S.A.', '36040964', '2026-11-19', 41, true);
    raise exception 'duplicou a nota';
  exception when unique_violation then null;
  end;
  delete from notas_corretagem where id = v_nota;
  perform teste.confere((select count(*) from execucoes where estrategia_id = v_est) = 0, 'apagar a nota apaga as execuções dela');
  delete from estrategias where id = v_est;
  insert into notas_corretagem (user_id, corretora, numero, data_pregao, custo_total, conferida)
  values (app.eu(), 'BTG Pactual CTVM S.A.', '1', '2026-11-19', 0, true);
end $$;
select teste.entrar('b1@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from notas_corretagem) = 0, 'outro usuário não vê as notas');
end $$;
reset role;
delete from notas_corretagem where numero = '1';
\echo 'NOTAS: todos os testes passaram'
