-- Testes do banco de acesso. Rodados por db/tests/rodar.sh num banco descartável.
-- Cada bloco age como o papel da aplicação (wtaopt_app) com um usuário definido,
-- exatamente como a api faz. Qualquer falha interrompe o arquivo.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema teste;
grant usage on schema teste to wtaopt_app;
create function teste.confere(p_ok boolean, p_nome text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FALHOU: %', p_nome; end if;
  raise notice 'ok - %', p_nome;
end $$;
create function teste.espera_erro(p_sql text, p_trecho text, p_nome text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_trecho in sqlerrm) > 0 then raise notice 'ok - %', p_nome; return; end if;
    raise exception 'FALHOU: % (erro inesperado: %)', p_nome, sqlerrm;
  end;
  raise exception 'FALHOU: % (deveria ter sido recusado)', p_nome;
end $$;
create function teste.entrar(p_email text) returns void language plpgsql security definer as $$
begin
  perform set_config('app.user_id', coalesce((select id::text from public.users where email = p_email), ''), false);
end $$;
grant execute on all functions in schema teste to wtaopt_app;

-- Pessoas: superadmin (org WTA); admin A e usuários A1, A2 (org Alfa); admin B e usuário B1 (org Beta).
select app.garantir_superadmin('chefe@exemplo.test', 'hash-inicial');
insert into organizations (nome) values ('Alfa'), ('Beta');
insert into users (organization_id, email, nome, papel, senha_hash)
select o.id, e.email, e.nome, e.papel, 'hash-' || e.nome
from (values ('Alfa', 'admina@exemplo.test', 'AdminA', 'admin'),
             ('Alfa', 'a1@exemplo.test', 'A1', 'usuario'),
             ('Alfa', 'a2@exemplo.test', 'A2', 'usuario'),
             ('Beta', 'adminb@exemplo.test', 'AdminB', 'admin'),
             ('Beta', 'b1@exemplo.test', 'B1', 'usuario')) as e(org, email, nome, papel)
join organizations o on o.nome = e.org;

create table teste.ids as select email, id from users;
grant select on teste.ids to wtaopt_app;
create function teste.id(p_email text) returns uuid language sql stable as $$ select id from teste.ids where email = p_email $$;
grant execute on function teste.id(text) to wtaopt_app;
create table teste.orgs as select nome, id from organizations;
grant select on teste.orgs to wtaopt_app;

-- ============ Primeira conta ============
do $$ begin
  perform teste.confere((select count(*) from users where papel = 'superadmin') = 1, 'existe exatamente um superadmin');
  perform teste.confere(app.garantir_superadmin('outro@exemplo.test', 'x') is null, 'segundo superadmin não é criado pela instalação');
  perform teste.confere((select deve_trocar_senha from users where email = 'chefe@exemplo.test'), 'senha inicial do superadmin precisa ser trocada');
end $$;

set role wtaopt_app;

-- ============ Sem usuário identificado ============
select set_config('app.user_id', '', false);
do $$ begin
  perform teste.confere((select count(*) from users) = 0, 'sem usuário identificado não se vê ninguém');
  perform teste.confere((select count(*) from organizations) = 0, 'nem organizações');
  perform teste.espera_erro($q$select * from password_resets$q$, 'permission denied', 'recuperações de senha não são legíveis');
  perform teste.espera_erro($q$select * from login_attempts$q$, 'permission denied', 'tentativas não são legíveis');
  perform teste.confere((select count(*) from app.usuario_para_login('A1@Exemplo.test ')) = 1, 'login acha a conta com e-mail em maiúsculas e espaços');
  perform teste.confere((select count(*) from app.usuario_para_login('ninguem@exemplo.test')) = 0, 'login de e-mail inexistente não devolve nada');
end $$;

-- ============ Usuário comum (A1) ============
select teste.entrar('a1@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from users) = 1, 'usuário vê só a si mesmo');
  insert into favoritos (user_id, codigo) values (app.uid(), 'PETR4'), (app.uid(), 'VALE3');
  insert into user_preferences (user_id, tema) values (app.uid(), 'claro');
  perform teste.confere((select count(*) from favoritos) = 2, 'usuário grava os próprios favoritos');
  perform teste.espera_erro($q$insert into favoritos (user_id, codigo) values (app.uid(), 'x')$q$, 'check', 'código de ativo inválido é recusado');
end $$;
do $$ begin
  perform teste.espera_erro($q$update users set papel = 'admin' where id = app.uid()$q$, 'row-level security', 'usuário não muda o próprio papel');
  perform teste.espera_erro($q$update users set situacao = 'suspenso' where id = app.uid()$q$, 'row-level security', 'usuário não muda a própria situação');
  update users set nome = 'A Um' where id = app.uid();
  perform teste.confere((select nome from users where id = app.uid()) = 'A Um', 'usuário muda o próprio nome');
  perform teste.espera_erro($q$insert into invites (organization_id, email, papel, token_hash, criado_por, expira_em) values (app.org(), 'x@exemplo.test', 'usuario', '\x01', app.uid(), now() + interval '1 day')$q$,
    'row-level security', 'usuário comum não convida');
  perform teste.confere((select count(*) from audit_logs) = 0, 'usuário comum não lê auditoria');
  perform teste.espera_erro($q$insert into audit_logs (acao, ator_id) values ('falsa', '00000000-0000-0000-0000-000000000001')$q$, 'row-level security', 'auditoria não aceita ação em nome de outro');
end $$;

-- ============ Isolamento: A2 não alcança nada de A1 ============
select teste.entrar('a2@exemplo.test');
do $$
declare v_a1 uuid := teste.id('a1@exemplo.test');
begin
  perform teste.confere(not exists (select 1 from users where id = v_a1), 'A2 não enxerga A1');
  perform teste.confere((select count(*) from favoritos) = 0, 'A2 não lê favoritos de A1');
  perform teste.confere((select count(*) from user_preferences) = 0, 'A2 não lê preferências de A1');
  update favoritos set ordem = 9 where user_id = v_a1;
  perform teste.confere(not found, 'A2 não altera favoritos de A1');
  delete from favoritos where user_id = v_a1;
  perform teste.confere(not found, 'A2 não apaga favoritos de A1');
  perform teste.espera_erro(format($q$insert into favoritos (user_id, codigo) values (%L, 'BBAS3')$q$, v_a1), 'row-level security', 'A2 não grava favorito em nome de A1');
  update users set nome = 'invadido', senha_hash = 'x' where id = v_a1;
  perform teste.confere(not found, 'A2 não altera nome nem senha de A1');
end $$;

-- ============ Administrador da organização (AdminA) ============
select teste.entrar('admina@exemplo.test');
do $$
declare v_a2 uuid := teste.id('a2@exemplo.test');
begin
  perform teste.confere((select count(*) from users) = 3, 'admin vê os 3 usuários da própria organização');
  perform teste.confere(not exists (select 1 from users where email like 'b1%' or email like 'adminb%' or email like 'chefe%'), 'admin não vê outras organizações nem o superadmin');
  perform teste.confere((select count(*) from favoritos) = 0, 'admin não lê dados financeiros/favoritos dos usuários');
  perform teste.espera_erro($q$select senha_hash from users$q$, 'permission denied', 'hash de senha não é legível pela aplicação');
  update users set situacao = 'suspenso' where id = v_a2;
  perform teste.confere((select situacao from users where id = v_a2) = 'suspenso', 'admin suspende usuário da organização');
  update users set situacao = 'ativo' where id = v_a2;
  perform teste.espera_erro(format($q$update users set papel = 'superadmin' where id = %L$q$, v_a2), 'row-level security', 'admin não cria superadmin');
  perform teste.espera_erro(format($q$update users set papel = 'admin' where id = %L$q$, v_a2), 'row-level security', 'admin não promove usuário a admin');
  insert into audit_logs (organization_id, ator_id, acao) values (app.org(), app.uid(), 'org.certa');
  perform teste.espera_erro($q$insert into audit_logs (organization_id, ator_id, acao) select id, app.uid(), 'org.errada' from teste.orgs where nome = 'Beta'$q$, 'row-level security', 'auditoria não aceita outra organização');
  perform teste.espera_erro($q$update users set papel = 'superadmin' where id = app.uid()$q$, 'row-level security', 'admin não vira superadmin');
  perform teste.espera_erro(format($q$update users set senha_hash = 'x' where id = %L$q$, v_a2), 'senha_so_do_dono', 'admin não troca a senha de outro');
  insert into invites (organization_id, email, papel, token_hash, criado_por, expira_em)
    values (app.org(), 'novo@exemplo.test', 'usuario', '\x0a0a', app.uid(), now() + interval '2 days');
  perform teste.confere((select count(*) from invites) = 1, 'admin convida usuário para a própria organização');
  perform teste.espera_erro($q$insert into invites (organization_id, email, papel, token_hash, criado_por, expira_em) values (app.org(), 'adm@exemplo.test', 'admin', '\x0b', app.uid(), now() + interval '1 day')$q$,
    'row-level security', 'admin não convida outro admin');
  perform teste.espera_erro($q$insert into invites (organization_id, email, papel, token_hash, criado_por, expira_em) select id, 'x2@exemplo.test', 'usuario', '\x0c', app.uid(), now() + interval '1 day' from teste.orgs where nome = 'Beta'$q$,
    'row-level security', 'admin não convida para outra organização');
  insert into audit_logs (organization_id, ator_id, acao) values (app.org(), app.uid(), 'teste.acao');
  perform teste.confere((select count(*) from audit_logs where acao = 'teste.acao') = 1, 'admin registra e lê auditoria da organização');
  perform teste.espera_erro($q$update audit_logs set acao = 'mudou'$q$, 'permission denied', 'auditoria não se altera');
  perform teste.espera_erro($q$delete from audit_logs$q$, 'permission denied', 'auditoria não se apaga');
end $$;

-- ============ Superadmin ============
select teste.entrar('chefe@exemplo.test');
do $$ begin
  perform teste.confere((select count(*) from users) = 6, 'superadmin vê todos');
  perform teste.confere((select count(*) from favoritos) = 0, 'nem o superadmin lê favoritos alheios');
  update users set papel = 'admin' where email = 'a1@exemplo.test';
  perform teste.confere(found, 'superadmin promove usuário');
  update users set papel = 'usuario' where email = 'a1@exemplo.test';
  perform teste.confere((select count(*) from audit_logs) >= 2, 'superadmin lê toda a auditoria');
end $$;

-- ============ Sessões, convite, recuperação e tentativas ============
reset role;
do $$ begin
  perform teste.espera_erro($q$update audit_logs set acao = 'x'$q$, 'auditoria_imutavel', 'auditoria imutável até para o dono das tabelas');
end $$;
set role wtaopt_app;
select set_config('app.user_id', '', false);
do $$
declare
  v_a1 uuid := teste.id('a1@exemplo.test');
  v_sessao uuid;
  v_user uuid;
begin
  v_sessao := app.criar_sessao(v_a1, '\xaa01', 'csrf-1', interval '30 days', '10.0.0.1', 'teste');
  perform teste.confere((select user_id from app.sessao_por_token('\xaa01', interval '12 hours')) = v_a1, 'sessão válida é encontrada pelo hash do token');
  perform teste.confere((select count(*) from app.sessao_por_token('\xaa02', interval '12 hours')) = 0, 'token desconhecido não acha sessão');
  perform app.revogar_sessao_por_token('\xaa01');
  perform teste.confere((select count(*) from app.sessao_por_token('\xaa01', interval '12 hours')) = 0, 'sessão revogada (logout) deixa de valer');

  v_sessao := app.criar_sessao(v_a1, '\xaa03', 'csrf-3', interval '30 days', null, null);
  perform teste.confere((select count(*) from app.sessao_por_token('\xaa03', interval '0 seconds')) = 0, 'sessão inativa além do limite deixa de valer');

  -- convite criado pelo AdminA acima
  perform teste.confere((select email from app.convite_valido('\x0a0a')) = 'novo@exemplo.test', 'convite válido mostra o e-mail');
  v_user := app.aceitar_convite('\x0a0a', 'Novo', 'hash-novo');
  perform teste.confere(v_user is not null, 'convite aceito cria a conta na organização certa');
  perform teste.espera_erro($q$select app.aceitar_convite('\x0a0a', 'De novo', 'h')$q$, 'convite_invalido', 'convite não é usado duas vezes');

  -- recuperação
  perform teste.confere(app.criar_recuperacao('ninguem@exemplo.test', '\xbb00', interval '30 minutes') is null, 'recuperação de e-mail inexistente não cria nada');
  perform teste.confere(app.criar_recuperacao('a1@exemplo.test', '\xbb01', interval '30 minutes') = v_a1, 'recuperação criada');
  perform teste.confere(app.criar_recuperacao('a1@exemplo.test', '\xbb02', interval '30 minutes') = v_a1, 'pedido novo');
  perform teste.espera_erro($q$select app.redefinir_senha('\xbb01', 'nova')$q$, 'token_invalido', 'pedido novo invalida o link anterior');
  v_sessao := app.criar_sessao(v_a1, '\xaa04', 'csrf-4', interval '30 days', null, null);
  perform teste.confere(app.redefinir_senha('\xbb02', 'hash-nova') = v_a1, 'senha redefinida pelo link');
  perform teste.confere((select count(*) from app.sessao_por_token('\xaa04', interval '12 hours')) = 0, 'trocar a senha derruba as sessões abertas');
  perform teste.espera_erro($q$select app.redefinir_senha('\xbb02', 'outra')$q$, 'token_invalido', 'link de recuperação não é usado duas vezes');

  -- tentativas
  for i in 1..7 loop perform app.registrar_falha('email:a1@exemplo.test'); end loop;
  perform teste.confere(app.tentativa_bloqueada('email:a1@exemplo.test') is null, '7 falhas ainda não bloqueiam');
  perform teste.confere(app.registrar_falha('email:a1@exemplo.test') > now(), 'a 8ª falha bloqueia');
  perform teste.confere(app.tentativa_bloqueada('email:a1@exemplo.test') > now() + interval '14 minutes', 'bloqueio de 15 minutos');
  perform app.limpar_falhas('email:a1@exemplo.test');
  perform teste.confere(app.tentativa_bloqueada('email:a1@exemplo.test') is null, 'login certo limpa as falhas');
end $$;

-- ============ Suspensão derruba sessões ============
select set_config('app.user_id', '', false);
select app.criar_sessao(teste.id('a2@exemplo.test'), '\xcc01', 'c', interval '30 days', null, null);
select teste.entrar('admina@exemplo.test');
update users set situacao = 'suspenso' where email = 'a2@exemplo.test';
select set_config('app.user_id', '', false);
do $$ begin
  perform teste.confere((select count(*) from app.sessao_por_token('\xcc01', interval '12 hours')) = 0, 'suspensão derruba as sessões do usuário');
  perform teste.confere((select count(*) from app.usuario_para_login('a2@exemplo.test')) = 0, 'usuário suspenso não consegue entrar');
  perform teste.espera_erro($q$select app.criar_sessao(teste.id('a2@exemplo.test'), '\xcc02', 'c', interval '1 day', null, null)$q$, 'usuario_inativo', 'não se cria sessão para usuário suspenso');
end $$;
select teste.entrar('a2@exemplo.test');
do $$ begin
  perform teste.confere(app.papel() is null and (select count(*) from users) = 0, 'usuário suspenso fica sem papel e sem visão, mesmo com o id definido');
end $$;

-- ============ Funções fora do alcance de quem não deve ============
reset role;
do $$ begin
  perform teste.confere(not has_function_privilege('public', 'app.garantir_superadmin(text,text,text)', 'execute'), 'public não executa funções de acesso');
  perform teste.confere(not exists (select 1 from pg_roles where rolname = 'wtaopt_app' and (rolbypassrls or rolsuper)), 'papel da aplicação não ignora RLS');
  perform teste.confere(not exists (select 1 from pg_tables where schemaname = 'public' and tableowner = 'wtaopt_app'), 'papel da aplicação não é dono de tabela');
  perform teste.confere(not exists (select 1 from pg_tables t join pg_class c on c.relname = t.tablename where t.schemaname = 'public' and not c.relrowsecurity), 'toda tabela tem RLS ligada');
end $$;

\echo 'ACESSO: todos os testes passaram'
