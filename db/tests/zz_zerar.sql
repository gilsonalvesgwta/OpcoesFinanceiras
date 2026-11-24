-- Zerar a carteira: apaga posições, execuções, notas e avisos de posição só do dono.
\set ON_ERROR_STOP on
set client_min_messages = notice;
set role wtaopt_app;
select teste.entrar('novo@exemplo.test');
do $$
declare v_est uuid;
begin
  insert into estrategias (user_id, nome, ativo_objeto) values (app.eu(), 'Fica B', 'FICA3') returning id into v_est;
  insert into execucoes (user_id, estrategia_id, codigo, tipo, lado, quantidade, preco, instante)
  values (app.eu(), v_est, 'FICA3', 'ativo', 'compra', 100, 1000, '2026-11-19T13:00:00Z');
end $$;
select teste.entrar('a1@exemplo.test');
do $$
declare v_est uuid; v_nota uuid; r jsonb;
begin
  insert into notas_corretagem (user_id, corretora, numero, data_pregao, custo_total, conferida)
  values (app.eu(), 'BTG Pactual CTVM S.A.', '777', '2026-11-19', 41, true) returning id into v_nota;
  insert into estrategias (user_id, nome, ativo_objeto) values (app.eu(), 'Zera A', 'ZERA3') returning id into v_est;
  insert into execucoes (user_id, estrategia_id, codigo, tipo, lado, quantidade, preco, instante, origem, nota_id)
  values (app.eu(), v_est, 'ZERA3', 'ativo', 'compra', 100, 1000, '2026-11-19T13:00:00Z', 'nota_corretagem', v_nota);
  insert into estrategias (user_id, nome, ativo_objeto) values (app.eu(), 'Zera manual', 'ZERA3');
  r := app.zerar_carteira();
  perform teste.confere((r->>'estrategias')::int >= 2 and (r->>'notas')::int >= 1, 'zerar devolve o que apagou');
  perform teste.confere((select count(*) from estrategias) = 0, 'zerar apaga as estratégias do dono');
  perform teste.confere((select count(*) from execucoes) = 0, 'zerar apaga as execuções do dono');
  perform teste.confere((select count(*) from notas_corretagem) = 0, 'zerar apaga as notas do dono');
end $$;
reset role;
do $$ begin
  perform teste.confere((select count(*) from estrategias where nome = 'Fica B') = 1, 'zerar não mexe na carteira de outro usuário');
  perform teste.confere((select count(*) from execucoes where codigo = 'FICA3') = 1, 'zerar não mexe nas execuções de outro usuário');
end $$;
-- avisos de posição (com Telegram pendente) também saem
insert into eventos_posicao (user_id, tipo, codigo, chave, titulo, texto)
select id, 'vencimento', 'ZERAK100', 'teste:zerar', 't', 't' from users where email = 'a1@exemplo.test';
insert into avisos (user_id, evento_posicao_id, canal, chave, texto)
select user_id, id, 'telegram', 'posicao:teste-zerar', 't' from eventos_posicao where chave = 'teste:zerar';
set role wtaopt_app;
select teste.entrar('a1@exemplo.test');
select app.zerar_carteira();
reset role;
do $$ begin
  perform teste.confere((select count(*) from eventos_posicao where chave = 'teste:zerar') = 0, 'zerar apaga os avisos de posição');
  perform teste.confere((select count(*) from avisos where chave = 'posicao:teste-zerar') = 0, 'zerar apaga o Telegram pendente da posição');
end $$;
delete from execucoes where codigo = 'FICA3';
delete from estrategias where nome = 'Fica B';
\echo 'ZERAR: todos os testes passaram'
