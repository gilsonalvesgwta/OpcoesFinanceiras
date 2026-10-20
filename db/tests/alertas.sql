-- Testes de alertas, avisos e Telegram. Roda depois de acesso.sql e aproveita o esquema
-- "teste": a1 e b1 ativos, a2 suspenso.
\set ON_ERROR_STOP on
set client_min_messages = notice;
grant usage on schema teste to wtaopt_coleta;
grant execute on all functions in schema teste to wtaopt_coleta;

set role wtaopt_app;

-- ============ Dono cria regra, evento e aviso ============
select teste.entrar('a1@exemplo.test');
do $$
declare v_regra uuid; v_evento bigint;
begin
  insert into regras_alerta (user_id, nome, codigo, condicao, rearme)
  values (app.uid(), 'Rompimento', 'PETR4', '{"tipo":"comparacao","campo":"ultimo","operador":"cruza_acima","valor":3850}', '{"tipo":"ao_desfazer"}')
  returning id into v_regra;
  insert into estados_alerta (regra_id, user_id, versao, estado) values (v_regra, app.uid(), 1, '{}');
  insert into eventos_alerta (regra_id, user_id, chave, codigo, descricao, instante, qualidade, fonte, valores)
  values (v_regra, app.uid(), v_regra || ':v1:1', 'PETR4', 'último preço cruzar para cima de R$ 38,50', now(), 'tempo_real', 'mt5', '{"ultimo":3852}')
  returning id into v_evento;
  insert into avisos (user_id, evento_id, canal, chave, texto) values (app.uid(), v_evento, 'telegram', 'aviso:' || v_regra || ':1', '<b>PETR4</b> teste');
  perform teste.confere((select count(*) from regras_alerta) = 1, 'usuário cria a própria regra');
  perform teste.espera_erro(format($q$insert into eventos_alerta (regra_id, user_id, chave, codigo, descricao, instante, qualidade, fonte, valores) values (%L, app.uid(), %L, 'PETR4', 'x', now(), 'tempo_real', 'mt5', '{}')$q$, v_regra, v_regra || ':v1:1'), 'unique', 'mesmo disparo não gera dois eventos');
  perform teste.espera_erro($q$insert into avisos (user_id, canal, chave, texto, situacao) values (app.uid(), 'telegram', 'k2', 'x', 'enviado')$q$, 'row-level security', 'aplicação não marca aviso como enviado');
  perform teste.espera_erro($q$update avisos set situacao = 'enviado'$q$, 'permission denied', 'aplicação não altera avisos');
  perform teste.espera_erro(format($q$insert into regras_alerta (user_id, nome, codigo, condicao, rearme) values (%L, 'x', 'VALE3', '{}', '{}')$q$, teste.id('b1@exemplo.test')), 'row-level security', 'ninguém cria regra em nome de outro');
  perform teste.espera_erro($q$insert into regras_alerta (user_id, nome, codigo, condicao, rearme, janela_inicio) values (app.uid(), 'x', 'VALE3', '{}', '{}', '10:00')$q$, 'check', 'janela precisa de início e fim');
  insert into codigos_telegram (codigo_hash, user_id, expira_em) values ('\xa1a1', app.uid(), now() + interval '15 minutes');
  perform teste.espera_erro($q$select * from codigos_telegram$q$, 'permission denied', 'código de vínculo não é legível');
end $$;

-- ============ Outro usuário e admin não veem nada ============
select teste.entrar('b1@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from regras_alerta) + (select count(*) from eventos_alerta) + (select count(*) from avisos) + (select count(*) from estados_alerta) = 0, 'outro usuário não vê regras, eventos, avisos nem estado alheios');
  update regras_alerta set ativa = false;
  perform teste.confere(not found, 'outro usuário não desliga regra alheia');
end $$;
select teste.entrar('admina@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from regras_alerta) + (select count(*) from avisos) = 0, 'admin da organização não vê alertas dos usuários');
end $$;

-- ============ Worker: vínculo, comandos e envio ============
reset role;
set role wtaopt_coleta;
do $$
declare r record;
begin
  perform teste.espera_erro($q$select * from avisos$q$, 'permission denied', 'worker não lê a tabela de avisos');
  perform teste.espera_erro($q$select * from vinculos_telegram$q$, 'permission denied', 'worker não lê os vínculos');
  perform teste.confere(not app.vincular_telegram('\xdead', 111, 'x'), 'código desconhecido não vincula');
  perform teste.confere(app.vincular_telegram('\xa1a1', 555, 'gilson'), 'código válido vincula o chat à conta');
  perform teste.confere(not app.vincular_telegram('\xa1a1', 556, 'outro'), 'código só vale uma vez');
  select * into r from app.avisos_para_enviar(10);
  perform teste.confere(r.chat_id = 555 and r.texto = '<b>PETR4</b> teste' and not r.silenciado and r.tentativas = 1, 'worker recebe o aviso com o chat de destino');
  perform teste.confere((select count(*) from app.avisos_para_enviar(10)) = 0, 'aviso reservado não sai em dobro');
  perform app.marcar_aviso(r.id, 'enviado');
  select * into r from app.comando_telegram(555, 'silenciar', 60);
  perform teste.confere(r.ok and r.silencio_ate > now() + interval '59 minutes' and r.regras_ativas = 1, 'silenciar por 60 minutos');
  select * into r from app.comando_telegram(999, 'status');
  perform teste.confere(not r.ok, 'chat não vinculado não comanda nada');
  perform teste.espera_erro($q$select app.marcar_aviso(1, 'qualquer')$q$, 'situacao_invalida', 'situação inválida é recusada');
end $$;
reset role;

set role wtaopt_app;
select teste.entrar('a1@exemplo.test');
do $$ begin
  perform teste.confere((select situacao from avisos limit 1) = 'enviado', 'dono vê o aviso enviado');
  perform teste.confere((select silencio_ate from vinculos_telegram) is not null, 'dono vê o silêncio');
  perform teste.espera_erro($q$select chat_id from vinculos_telegram$q$, 'permission denied', 'nem o dono lê o chat_id pela aplicação');
  delete from vinculos_telegram;
  perform teste.confere(found, 'dono desvincula o Telegram');
end $$;

-- ============ Conta suspensa: worker não vincula nem envia ============
reset role;
insert into codigos_telegram (codigo_hash, user_id, expira_em) values ('\xa2a2', teste.id('a2@exemplo.test'), now() + interval '15 minutes');
set role wtaopt_coleta;
do $$ begin
  perform teste.confere(not app.vincular_telegram('\xa2a2', 777, 'x'), 'conta suspensa não vincula Telegram');
end $$;
reset role;
do $$ begin
  perform teste.confere(not has_function_privilege('public', 'app.avisos_para_enviar(integer)', 'execute'), 'public não executa funções de envio');
  perform teste.confere(not exists (select 1 from pg_tables t join pg_class c on c.relname = t.tablename where t.schemaname = 'public' and not c.relrowsecurity), 'toda tabela continua com RLS ligada');
end $$;

\echo 'ALERTAS: todos os testes passaram'
