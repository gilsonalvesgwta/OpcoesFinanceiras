-- Testes da inteligência operacional. Roda depois de posicoes.sql e rolagens.sql.
\set ON_ERROR_STOP on
set client_min_messages = notice;

set role wtaopt_app;
select teste.entrar('a1@exemplo.test');
do $$ begin
  insert into preferencias_avisos (user_id, preferencias) values (app.uid(), '{"sugestoes": true}');
  perform teste.confere((select count(*) from preferencias_avisos) = 1, 'dono grava as preferências');
end $$;
select teste.entrar('b1@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from preferencias_avisos) = 0, 'outro usuário não vê preferências alheias');
end $$;
reset role;

-- O worker só enxerga o que as funções entregam.
set role wtaopt_coleta;
do $$
declare v_user uuid; v_est uuid; v_n int;
begin
  perform teste.espera_erro('select count(*) from estrategias', 'permission denied', 'worker não lê estratégias direto');
  perform teste.espera_erro('select count(*) from preferencias_avisos', 'permission denied', 'nem preferências');
  select count(*) into v_n from app.posicoes_para_avisos();
  perform teste.confere(v_n >= 1, 'worker recebe as estratégias abertas pela função');
  select user_id, estrategia_id into v_user, v_est from app.posicoes_para_avisos() where nome = 'Venda coberta';
  perform teste.confere((select preferencias->>'sugestoes' from app.posicoes_para_avisos() where estrategia_id = v_est) = 'true', 'com as preferências do dono');
  perform teste.confere((select jsonb_array_length(execucoes) from app.posicoes_para_avisos() where estrategia_id = v_est) = 2, 'e as execuções');
  perform teste.confere(app.registrar_evento_posicao(v_user, v_est, 'vencimento', 'PETRK380', 'venc:x:5', 'PETRK380 vence em 5 pregões', 'texto', '{}', true), 'evento novo');
  perform teste.confere(not app.registrar_evento_posicao(v_user, v_est, 'vencimento', 'PETRK380', 'venc:x:5', 'de novo', 'texto', '{}', true), 'mesma chave não repete');
end $$;
reset role;
do $$
declare v_b uuid := (select id from users where situacao = 'ativo' and email <> 'a1@exemplo.test' limit 1);
        v_est uuid := (select id from estrategias where nome = 'Venda coberta');
begin
  perform teste.confere((select count(*) from avisos where chave like 'posicao:%') = 1, 'um aviso do Telegram para o evento');
  set local role wtaopt_coleta;
  perform teste.espera_erro(format('select app.registrar_evento_posicao(%L, %L, ''risco_strike'', ''PETRK380'', ''r'', ''t'', ''x'', ''{}'', false)', v_b, v_est), 'estrategia_de_outro_usuario', 'evento não cai na estratégia de outro');
end $$;
reset role;

set role wtaopt_app;
select teste.entrar('a1@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from eventos_posicao) = 1, 'dono vê o evento');
  update eventos_posicao set lido_em = now();
  perform teste.confere((select count(*) from eventos_posicao where lido_em is not null) = 1, 'e marca como lido');
  perform teste.espera_erro('update eventos_posicao set texto = ''outro''', 'permission denied', 'mas não altera o texto');
end $$;
select teste.entrar('b1@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from eventos_posicao) = 0, 'outro usuário não vê eventos alheios');
end $$;
reset role;

\echo 'INTELIGENCIA: todos os testes passaram'
