-- Testes da ponte com o MetaTrader 5. Roda depois de acesso.sql, no mesmo banco,
-- e aproveita o que ele deixou: o esquema "teste", A1 ativo com favoritos
-- PETR4 e VALE3, A2 suspenso, B1 ativo em outra organização.
\set ON_ERROR_STOP on
set client_min_messages = notice;

set role wtaopt_app;

-- ============ Dono cria a ponte ============
select teste.entrar('a1@exemplo.test');
do $$ begin
  insert into pontes_mt5 (user_id, nome, token_hash) values (app.uid(), 'Genial na VPS', '\xa101');
  perform teste.confere((select count(*) from pontes_mt5) = 1, 'usuário cria a própria ponte');
  perform teste.espera_erro($q$select token_hash from pontes_mt5$q$, 'permission denied', 'hash da chave da ponte não é legível');
  perform teste.espera_erro(format($q$insert into pontes_mt5 (user_id, token_hash) values (%L, '\xa1ff')$q$, teste.id('b1@exemplo.test')),
    'row-level security', 'ninguém cria ponte em nome de outro');
  perform teste.espera_erro($q$update pontes_mt5 set ultimo_contato_em = now()$q$, 'permission denied', 'aplicação não falsifica o último contato');
  perform teste.espera_erro($q$insert into cotacoes_ponte (user_id, codigo, ponte_id, instante_fonte) select app.uid(), 'PETR4', id, now() from pontes_mt5$q$,
    'permission denied', 'cotação só entra pela função da ponte');
end $$;

-- B1 também tem uma ponte (para provar o isolamento).
select teste.entrar('b1@exemplo.test');
insert into pontes_mt5 (user_id, token_hash) values (app.uid(), '\xb101');
insert into favoritos (user_id, codigo) values (app.uid(), 'ITUB4');

-- ============ O robô envia (sem usuário identificado, só com a chave) ============
select set_config('app.user_id', '', false);
do $$
declare r record;
begin
  perform teste.confere(array(select app.simbolos_da_ponte('\xa101')) = array['PETR4', 'VALE3'], 'ponte recebe a lista dos favoritos do dono');
  perform teste.confere(array(select app.simbolos_da_ponte('\xb101')) = array['ITUB4'], 'cada ponte só recebe os ativos do próprio dono');
  perform teste.confere((select count(*) from app.simbolos_da_ponte('\xdead')) = 0, 'chave desconhecida não recebe lista');

  select * into r from app.receber_da_ponte('\xa101', '203.0.113.7', '1.0.0',
    '{"login":"123456","servidor":"Genial-Demo","corretora":"Genial Investimentos"}',
    '[{"codigo":"PETR4","ultimo":3812,"bid":3811,"ask":3813,"fechamento_anterior":3790,"volume":1500,"instante":"2026-10-16T14:00:00Z"},
      {"codigo":"VALE3","ultimo":null,"bid":6100,"ask":6105,"fechamento_anterior":6080,"volume":0,"instante":"2026-10-16T14:00:01Z"}]',
    '[{"codigo":"PETR4","lado":"compra","quantidade":300,"preco_medio":3655.5},
      {"codigo":"PETRK380","lado":"venda","quantidade":300,"preco_medio":72}]');
  perform teste.confere(r.gravadas = 2 and r.ignoradas = 0 and r.posicoes = 2, 'lote do robô é gravado');
  perform teste.espera_erro($q$select app.receber_da_ponte('\xdead', null, 'x', '{}', '[]', null)$q$, 'ponte_invalida', 'chave desconhecida é recusada');
end $$;
do $$ begin
  perform teste.confere((select count(*) from cotacoes_ponte) = 0, 'sem usuário identificado ninguém lê cotações da ponte');
  perform teste.confere((select count(*) from posicoes_ponte) = 0, 'nem posições');
end $$;

-- Cotação fora de ordem não volta o preço para trás; posição enviada vazia zera a conta.
do $$
declare r record;
begin
  select * into r from app.receber_da_ponte('\xa101', null, '1.0.0', '{}',
    '[{"codigo":"PETR4","ultimo":3700,"bid":3699,"ask":3701,"fechamento_anterior":3790,"volume":10,"instante":"2026-10-16T13:59:00Z"},
      {"codigo":"VALE3","ultimo":6102,"bid":6101,"ask":6103,"fechamento_anterior":6080,"volume":200,"instante":"2026-10-16T14:00:05Z"}]',
    null);
  perform teste.confere(r.gravadas = 1 and r.ignoradas = 1 and r.posicoes is null, 'cotação mais antiga que a guardada é ignorada');
end $$;

-- ============ Dono lê; os outros não ============
select teste.entrar('a1@exemplo.test');
do $$ begin
  perform teste.confere((select ultimo from cotacoes_ponte where codigo = 'PETR4') = 3812, 'preço guardado é o mais recente da fonte');
  perform teste.confere((select ultimo from cotacoes_ponte where codigo = 'VALE3') = 6102, 'cotação nova substitui a anterior');
  perform teste.confere((select count(*) from posicoes_ponte) = 2, 'posições continuam quando o lote não traz posições');
  perform teste.confere((select preco_medio from posicoes_ponte where codigo = 'PETR4') = 3655.5, 'preço médio guarda fração de centavo');
  perform teste.confere((select conta_corretora from pontes_mt5) = 'Genial Investimentos' and (select ultimo_contato_em from pontes_mt5) is not null,
    'ponte registra conta e último contato');
  perform teste.confere(array(select app.simbolos_da_ponte('\xa101')) = array['PETR4', 'PETRK380', 'VALE3'], 'lista do robô inclui o que há em posição');
end $$;

select teste.entrar('b1@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from cotacoes_ponte) = 0, 'outro usuário não lê cotações da ponte alheia');
  perform teste.confere((select count(*) from posicoes_ponte) = 0, 'nem posições da corretora alheia');
  perform teste.confere((select count(*) from pontes_mt5) = 1, 'nem as pontes alheias');
  update pontes_mt5 set revogada_em = now() where user_id <> app.uid();
  perform teste.confere(not found, 'outro usuário não revoga a ponte alheia');
end $$;
select teste.entrar('admina@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from cotacoes_ponte) + (select count(*) from posicoes_ponte) + (select count(*) from pontes_mt5) = 0,
    'admin da organização não lê nada da ponte dos usuários');
end $$;

select set_config('app.user_id', '', false);
do $$
declare r record;
begin
  select * into r from app.receber_da_ponte('\xa101', null, '1.0.0', '{}', '[]', '[]');
  perform teste.confere(r.posicoes = 0, 'lote com lista vazia de posições é aceito');
end $$;
select teste.entrar('a1@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from posicoes_ponte) = 0, 'lista vazia zera as posições da conta');
  perform teste.confere((select revogada_em from pontes_mt5) is null, 'B1 não conseguiu revogar a ponte de A1');
  update pontes_mt5 set revogada_em = now();
end $$;

-- ============ Chave revogada e dono suspenso ============
select set_config('app.user_id', '', false);
do $$ begin
  perform teste.espera_erro($q$select app.receber_da_ponte('\xa101', null, 'x', '{}', '[]', null)$q$, 'ponte_invalida', 'ponte revogada é recusada');
  perform teste.confere((select count(*) from app.simbolos_da_ponte('\xa101')) = 0, 'ponte revogada não recebe lista');
end $$;
reset role;
update users set situacao = 'suspenso' where email = 'b1@exemplo.test';
set role wtaopt_app;
select set_config('app.user_id', '', false);
do $$ begin
  perform teste.espera_erro($q$select app.receber_da_ponte('\xb101', null, 'x', '{}', '[]', null)$q$, 'ponte_invalida', 'ponte de usuário suspenso é recusada');
end $$;

reset role;
do $$ begin
  perform teste.confere(not has_function_privilege('public', 'app.receber_da_ponte(bytea,inet,text,jsonb,jsonb,jsonb)', 'execute'), 'public não executa a função da ponte');
  perform teste.confere(not exists (select 1 from pg_tables t join pg_class c on c.relname = t.tablename where t.schemaname = 'public' and not c.relrowsecurity), 'toda tabela continua com RLS ligada');
end $$;

\echo 'PONTE: todos os testes passaram'
