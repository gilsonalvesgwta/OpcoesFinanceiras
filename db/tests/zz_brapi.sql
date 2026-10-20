-- Testes da brapi (cotações de ações com atraso, gravadas pelo worker).
\set ON_ERROR_STOP on
set client_min_messages = notice;

set role wtaopt_coleta;
do $$ begin
  insert into cotacoes_brapi (codigo, ultimo, fechamento_anterior, volume, instante_fonte) values ('PETR4', 3812, 3790, 1000, now() - interval '30 minutes');
  insert into uso_brapi (mes, consultas) values ('2026-10', 1);
  perform teste.confere((select count(*) from app.codigos_para_brapi() where codigo = 'PETR4') <= 1, 'worker recebe a lista de ações sem saber de quem são');
  perform teste.confere(not exists (select 1 from app.codigos_para_brapi() where codigo !~ '^[A-Z]{4}[0-9]{1,2}$'), 'só ações (opções ficam de fora)');
  perform teste.espera_erro('select * from app.brapi_para_alertas()', 'permission denied', 'worker não avalia alertas');
  perform teste.espera_erro('select count(*) from regras_alerta', 'permission denied', 'nem lê regras');
end $$;
reset role;

set role wtaopt_app;
select teste.entrar('a1@exemplo.test');
do $$ begin
  perform teste.confere((select ultimo from cotacoes_brapi where codigo = 'PETR4') = 3812, 'usuário lê a cotação da brapi');
  perform teste.espera_erro('update cotacoes_brapi set ultimo = 1', 'permission denied', 'mas não altera');
  perform teste.confere((select count(*) from app.brapi_para_alertas() where codigo = 'PETR4') = 1, 'api recebe a cotação nova para os alertas');
  perform teste.confere((select count(*) from app.brapi_para_alertas()) = 0, 'e só uma vez');
  perform teste.espera_erro('select * from app.codigos_para_brapi()', 'permission denied', 'a api não usa a lista do worker');
end $$;
reset role;

\echo 'BRAPI: todos os testes passaram'
