-- Painel do dia: abertura/máxima/mínima do robô e o preço de cada minuto (só ações/ETFs).
\set ON_ERROR_STOP on
set client_min_messages = notice;
do $$
declare v_u uuid := (select id from users where email = 'a1@exemplo.test');
        v_hash bytea := decode(repeat('ef', 32), 'hex');
begin
  insert into pontes_mt5 (user_id, nome, token_hash) values (v_u, 'painel', v_hash);
  perform app.receber_da_ponte(v_hash, '198.51.100.8', '1.4.0', '{}'::jsonb,
    '[{"codigo":"PNLA11","ultimo":16262,"bid":16261,"ask":16263,"fechamento_anterior":16540,"volume":1000,"instante":"2026-11-03T13:54:10Z","lote":1,"abertura":16300,"maxima":16389,"minima":16281}]'::jsonb, null);
  perform app.receber_da_ponte(v_hash, '198.51.100.8', '1.4.0', '{}'::jsonb, '[
    {"codigo":"PNLA11","ultimo":16250,"bid":16249,"ask":16251,"fechamento_anterior":16540,"volume":1100,"instante":"2026-11-03T13:54:40Z","lote":1,"abertura":16300,"maxima":16389,"minima":16250},
    {"codigo":"PNLAK157","ultimo":808,"bid":800,"ask":808,"fechamento_anterior":null,"volume":10,"instante":"2026-11-03T13:54:40Z"}
  ]'::jsonb, null);
  perform teste.confere((select abertura from cotacoes_ponte where codigo = 'PNLA11') = 16300, 'abertura gravada');
  perform teste.confere((select count(*) from intradia_ponte where codigo = 'PNLA11') = 1, 'um ponto por minuto');
  perform teste.confere((select preco from intradia_ponte where codigo = 'PNLA11') = 16250, 'fica o último preço do minuto');
  perform teste.confere((select count(*) from intradia_ponte where codigo = 'PNLAK157') = 0, 'opção não entra no gráfico');
end $$;
set role wtaopt_app;
select teste.entrar('b1@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from intradia_ponte where codigo = 'PNLA11') = 0, 'outro usuário não vê o gráfico do dono');
end $$;
reset role;
delete from pontes_mt5 where token_hash = decode(repeat('ef', 32), 'hex');
delete from intradia_ponte where codigo = 'PNLA11';
\echo 'PAINEL: todos os testes passaram'
