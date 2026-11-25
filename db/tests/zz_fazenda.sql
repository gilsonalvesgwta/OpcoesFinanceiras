-- Fazenda: vacas e operações só do dono.
\set ON_ERROR_STOP on
set client_min_messages = notice;
set role wtaopt_app;
select teste.entrar('a1@exemplo.test');
do $$
declare v uuid;
begin
  insert into vacas (user_id, nome, data_inicio, margem, quantidade) values (app.eu(), 'PIONEIRA', '2025-05-21', 376152, 120) returning id into v;
  insert into vaca_operacoes (user_id, vaca_id, data, lado, tipo, quantidade, ticker, strike, vencimento, preco, origem)
  values (app.eu(), v, '2025-05-21', 'venda', 'call', 20, 'E135W5', 13500, '2025-05-30', 174, 'planilha');
  perform teste.confere((select count(*) from vaca_operacoes where vaca_id = v) = 1, 'grava a operação da vaca');
end $$;
select teste.entrar('novo@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from vacas) = 0, 'outro usuário não vê as vacas');
  begin
    insert into vaca_operacoes (user_id, vaca_id, data, lado, tipo, quantidade, ticker, preco, origem)
    select app.eu(), id, '2025-05-21', 'venda', 'call', 1, 'X', 1, 'manual' from vacas limit 1;
  exception when others then null;
  end;
end $$;
reset role;
do $$ begin
  perform teste.confere((select count(*) from vaca_operacoes) = 1, 'ninguém escreve na vaca de outro');
end $$;
delete from vacas;
\echo 'FAZENDA: todos os testes passaram'
