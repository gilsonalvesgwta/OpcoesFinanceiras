-- Testes das séries observadas pela ponte.
\set ON_ERROR_STOP on
set client_min_messages = notice;
set role wtaopt_app;
select teste.entrar('a1@exemplo.test');
do $$ begin
  insert into observados_ponte (user_id, codigo, ate) values (app.uid(), 'OBSVK100', now() + interval '10 minutes'), (app.uid(), 'OBSVK200', now() - interval '1 minute');
  perform teste.confere((select count(*) from observados_ponte) = 2, 'dono marca séries observadas');
end $$;
select teste.entrar('b1@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from observados_ponte) = 0, 'outro usuário não vê');
end $$;
reset role;
do $$
declare v_u uuid := (select id from users where email = 'a1@exemplo.test');
        v_hash bytea := decode(repeat('ab', 32), 'hex');
        v_lista text[];
begin
  insert into pontes_mt5 (user_id, nome, token_hash) values (v_u, 'obs', v_hash);
  v_lista := array(select app.simbolos_da_ponte(v_hash));
  perform teste.confere('OBSVK100' = any(v_lista), 'série observada entra na lista do robô');
  perform teste.confere(not ('OBSVK200' = any(v_lista)), 'observação vencida sai');
  delete from pontes_mt5 where token_hash = v_hash;
end $$;
\echo 'OBSERVADOS: todos os testes passaram'
