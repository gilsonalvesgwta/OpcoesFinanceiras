-- Lote vindo do robô: grava, e envio sem lote (robô antigo) não apaga o que já havia.
\set ON_ERROR_STOP on
set client_min_messages = notice;
do $$
declare v_u uuid := (select id from users where email = 'a1@exemplo.test');
        v_hash bytea := decode(repeat('cd', 32), 'hex');
begin
  insert into pontes_mt5 (user_id, nome, token_hash) values (v_u, 'lote', v_hash);
  perform app.receber_da_ponte(v_hash, '198.51.100.7', '1.3.0', '{}'::jsonb,
    '[{"codigo":"LOTEK100","ultimo":10,"bid":9,"ask":11,"fechamento_anterior":null,"volume":null,"instante":"2026-11-03T13:00:00Z","lote":1}]'::jsonb, null);
  perform teste.confere((select lote from cotacoes_ponte where codigo = 'LOTEK100') = 1, 'lote gravado');
  perform app.receber_da_ponte(v_hash, '198.51.100.7', '1.2.0', '{}'::jsonb,
    '[{"codigo":"LOTEK100","ultimo":12,"bid":11,"ask":13,"fechamento_anterior":null,"volume":null,"instante":"2026-11-03T13:00:05Z"}]'::jsonb, null);
  perform teste.confere((select lote from cotacoes_ponte where codigo = 'LOTEK100') = 1 and (select ultimo from cotacoes_ponte where codigo = 'LOTEK100') = 12, 'sem lote no envio: preço novo, lote mantido');
  delete from pontes_mt5 where token_hash = v_hash;
end $$;
\echo 'LOTE: todos os testes passaram'
