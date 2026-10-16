-- WTA Options Intelligence — 0001: acesso, organizações, auditoria.
--
-- Papéis do banco:
--   dono das tabelas (quem roda as migrações) — nunca usado pela aplicação;
--   wtaopt_app — usado pela api e pelo worker; NÃO é dono, NÃO ignora RLS.
-- A aplicação identifica o usuário por transação:
--   select set_config('app.user_id', '<uuid>', true);
-- Sem isso, app.uid() é null e as regras de linha não liberam nada.
-- Fluxos anteriores ao login (entrar, aceitar convite, recuperar senha) passam
-- por funções SECURITY DEFINER pequenas, cada uma com uma tarefa só.
-- Sem begin/commit: db/aplicar.sh roda cada arquivo numa transação única.


do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'wtaopt_app') then
    create role wtaopt_app nologin nobypassrls;
  end if;
end $$;

create schema app;
grant usage on schema app to wtaopt_app;
revoke all on schema public from public;
grant usage on schema public to wtaopt_app;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table organizations (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (length(trim(nome)) between 1 and 120),
  criada_em  timestamptz not null default now()
);

create table users (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id),
  email              text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  nome               text not null default '' check (length(nome) <= 120),
  papel              text not null default 'usuario' check (papel in ('superadmin', 'admin', 'usuario')),
  situacao           text not null default 'ativo' check (situacao in ('ativo', 'suspenso')),
  senha_hash         text,
  deve_trocar_senha  boolean not null default false,
  ultimo_login_em    timestamptz,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
create unique index users_email_unico on users (email);
create index users_organizacao on users (organization_id);

create table sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users (id) on delete cascade,
  token_hash     bytea not null unique,           -- SHA-256 do token do cookie
  csrf_token     text not null,
  criada_em      timestamptz not null default now(),
  ultimo_uso_em  timestamptz not null default now(),
  expira_em      timestamptz not null,            -- idade máxima
  revogada_em    timestamptz,
  ip             inet,
  user_agent     text check (length(user_agent) <= 400)
);
create index sessions_usuario on sessions (user_id) where revogada_em is null;

create table invites (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id),
  email            text not null check (email = lower(trim(email))),
  papel            text not null check (papel in ('admin', 'usuario')),
  token_hash       bytea not null unique,
  criado_por       uuid not null references users (id),
  criado_em        timestamptz not null default now(),
  expira_em        timestamptz not null,
  usado_em         timestamptz,
  cancelado_em     timestamptz
);

create table password_resets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  token_hash  bytea not null unique,
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  usado_em    timestamptz
);

-- Contadores de tentativas: chave "email:<email>" ou "ip:<ip>".
create table login_attempts (
  chave          text primary key,
  falhas         integer not null default 0,
  bloqueado_ate  timestamptz,
  atualizado_em  timestamptz not null default now()
);

create table audit_logs (
  id               bigint generated always as identity primary key,
  organization_id  uuid references organizations (id),
  ator_id          uuid references users (id),
  acao             text not null,
  alvo_tipo        text,
  alvo_id          text,
  antes            jsonb,
  depois           jsonb,
  ip               inet,
  quando           timestamptz not null default now()
);
create index audit_logs_quando on audit_logs (organization_id, quando desc);

create table user_preferences (
  user_id     uuid primary key references users (id) on delete cascade,
  tema        text not null default 'escuro' check (tema in ('escuro', 'claro', 'sistema')),
  dados       jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

create table favoritos (
  user_id    uuid not null references users (id) on delete cascade,
  codigo     text not null check (codigo ~ '^[A-Z0-9]{4,12}$'),
  ordem      integer not null default 0,
  criado_em  timestamptz not null default now(),
  primary key (user_id, codigo)
);

-- Auditoria só aceita inserção, inclusive para o dono das tabelas.
create function app.auditoria_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'auditoria_imutavel' using errcode = '42501';
end $$;
create trigger audit_logs_imutavel before update or delete on audit_logs
  for each row execute function app.auditoria_imutavel();

create function app.tocar_atualizado_em() returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;
create trigger users_atualizado before update on users for each row execute function app.tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- Quem está agindo
-- ---------------------------------------------------------------------------

create function app.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

-- O usuário da transação, só se a conta estiver ativa. As regras por linha usam
-- esta função (e não app.uid()), para que uma conta suspensa não veja nada.
create function app.eu() returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select id from users where id = app.uid() and situacao = 'ativo';
$$;

-- Papel e organização do usuário ATIVO da transação (suspenso = sem papel).
create function app.papel() returns text language sql stable security definer set search_path = public, pg_temp as $$
  select papel from users where id = app.uid() and situacao = 'ativo';
$$;

create function app.org() returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select organization_id from users where id = app.uid() and situacao = 'ativo';
$$;

-- ---------------------------------------------------------------------------
-- Regras por linha
-- ---------------------------------------------------------------------------

alter table organizations    enable row level security;
alter table users            enable row level security;
alter table sessions         enable row level security;
alter table invites          enable row level security;
alter table password_resets  enable row level security;
alter table login_attempts   enable row level security;
alter table audit_logs       enable row level security;
alter table user_preferences enable row level security;
alter table favoritos        enable row level security;

-- Organizações: cada um vê a sua; o superadministrador vê e cria todas.
grant select, insert on organizations to wtaopt_app;
create policy org_ver on organizations for select to wtaopt_app
  using (id = app.org() or app.papel() = 'superadmin');
create policy org_criar on organizations for insert to wtaopt_app
  with check (app.papel() = 'superadmin');

-- Usuários: o próprio; o admin, os da sua organização (menos o superadmin); o superadmin, todos.
-- O hash da senha não é legível pela aplicação (nem por administradores): a
-- conferência passa por app.usuario_para_login.
grant select (id, organization_id, email, nome, papel, situacao, deve_trocar_senha, ultimo_login_em, criado_em, atualizado_em) on users to wtaopt_app;
grant update (nome, papel, situacao, senha_hash, deve_trocar_senha) on users to wtaopt_app;
create policy users_ver on users for select to wtaopt_app using (
  id = app.eu()
  or (app.papel() = 'admin' and organization_id = app.org() and papel <> 'superadmin')
  or app.papel() = 'superadmin');
-- Alterar: o superadmin altera qualquer um; o admin altera só usuários comuns da
-- própria organização e não muda o papel deles (dar papel de admin é do
-- superadmin); o próprio usuário altera seus dados sem mudar o próprio papel
-- nem a própria situação.
create policy users_alterar on users for update to wtaopt_app
  using (
    app.papel() = 'superadmin'
    or (app.papel() = 'admin' and organization_id = app.org() and papel = 'usuario')
    or id = app.eu())
  with check (
    app.papel() = 'superadmin'
    or (app.papel() = 'admin' and organization_id = app.org() and papel = 'usuario')
    or (id = app.eu() and papel = app.papel() and situacao = 'ativo'));

-- Sessões: só as próprias (listar e revogar). Criação e leitura pelo token, por função.
grant select on sessions to wtaopt_app;
grant update (revogada_em) on sessions to wtaopt_app;
create policy sessions_proprias on sessions for select to wtaopt_app using (user_id = app.eu());
create policy sessions_revogar on sessions for update to wtaopt_app using (user_id = app.eu()) with check (user_id = app.eu());

-- Convites: admin da organização e superadmin.
grant select, insert on invites to wtaopt_app;
grant update (cancelado_em) on invites to wtaopt_app;
create policy invites_ver on invites for select to wtaopt_app using (
  app.papel() = 'superadmin' or (app.papel() = 'admin' and organization_id = app.org()));
create policy invites_criar on invites for insert to wtaopt_app with check (
  criado_por = app.eu() and (
    app.papel() = 'superadmin'
    or (app.papel() = 'admin' and organization_id = app.org() and papel = 'usuario')));
create policy invites_cancelar on invites for update to wtaopt_app
  using (app.papel() = 'superadmin' or (app.papel() = 'admin' and organization_id = app.org()))
  with check (app.papel() = 'superadmin' or (app.papel() = 'admin' and organization_id = app.org()));

-- password_resets e login_attempts: nenhum acesso direto (só pelas funções).

-- Auditoria: quem age registra a própria ação; leitura pelo admin (sua organização) e superadmin.
grant select, insert on audit_logs to wtaopt_app;
create policy audit_registrar on audit_logs for insert to wtaopt_app with check (ator_id = app.eu() and organization_id = app.org());
create policy audit_ver on audit_logs for select to wtaopt_app using (
  app.papel() = 'superadmin' or (app.papel() = 'admin' and organization_id = app.org()));

-- Dados do usuário: só o dono, sem exceção para administradores.
grant select, insert, update, delete on user_preferences, favoritos to wtaopt_app;
create policy prefs_dono on user_preferences for all to wtaopt_app using (user_id = app.eu()) with check (user_id = app.eu());
create policy favoritos_dono on favoritos for all to wtaopt_app using (user_id = app.eu()) with check (user_id = app.eu());

-- ---------------------------------------------------------------------------
-- Funções dos fluxos sem usuário identificado (SECURITY DEFINER, tarefa única)
-- ---------------------------------------------------------------------------

-- Tentativas: 8 falhas seguidas bloqueiam a chave por 15 minutos.
create function app.tentativa_bloqueada(p_chave text) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select bloqueado_ate from login_attempts where chave = p_chave and bloqueado_ate > now();
$$;

create function app.registrar_falha(p_chave text, p_limite integer default 8, p_espera interval default '15 minutes')
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare v login_attempts;
begin
  insert into login_attempts (chave, falhas) values (p_chave, 1)
  on conflict (chave) do update set
    falhas = case when login_attempts.bloqueado_ate is not null and login_attempts.bloqueado_ate <= now() then 1 else login_attempts.falhas + 1 end,
    bloqueado_ate = case when login_attempts.bloqueado_ate is not null and login_attempts.bloqueado_ate <= now() then null else login_attempts.bloqueado_ate end,
    atualizado_em = now()
  returning * into v;
  if v.falhas >= p_limite then
    update login_attempts set bloqueado_ate = now() + p_espera, falhas = 0 where chave = p_chave returning * into v;
  end if;
  return v.bloqueado_ate;
end $$;

create function app.limpar_falhas(p_chave text) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from login_attempts where chave = p_chave;
$$;

-- Dados para conferir a senha. Devolve linha só para conta ativa.
create function app.usuario_para_login(p_email text)
returns table (id uuid, senha_hash text, deve_trocar_senha boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.senha_hash, u.deve_trocar_senha from users u
  where u.email = lower(trim(p_email)) and u.situacao = 'ativo';
$$;

create function app.criar_sessao(p_user uuid, p_token_hash bytea, p_csrf text, p_idade interval, p_ip inet, p_agente text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not exists (select 1 from users where id = p_user and situacao = 'ativo') then
    raise exception 'usuario_inativo' using errcode = 'P0001';
  end if;
  insert into sessions (user_id, token_hash, csrf_token, expira_em, ip, user_agent)
  values (p_user, p_token_hash, p_csrf, now() + p_idade, p_ip, left(p_agente, 400))
  returning id into v_id;
  update users set ultimo_login_em = now() where id = p_user;
  return v_id;
end $$;

-- Sessão válida pelo hash do token: não revogada, dentro da idade máxima, sem
-- inatividade maior que p_inatividade e com usuário ativo. Atualiza o último uso.
create function app.sessao_por_token(p_token_hash bytea, p_inatividade interval)
returns table (sessao_id uuid, user_id uuid, organization_id uuid, papel text, email text, nome text, csrf_token text, deve_trocar_senha boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  update sessions s set ultimo_uso_em = now()
  from users u
  where s.token_hash = p_token_hash
    and u.id = s.user_id
    and s.revogada_em is null
    and s.expira_em > now()
    and s.ultimo_uso_em > now() - p_inatividade
    and u.situacao = 'ativo'
  returning s.id, u.id, u.organization_id, u.papel, u.email, u.nome, s.csrf_token, u.deve_trocar_senha;
end $$;

create function app.revogar_sessao_por_token(p_token_hash bytea) returns void
language sql security definer set search_path = public, pg_temp as $$
  update sessions set revogada_em = now() where token_hash = p_token_hash and revogada_em is null;
$$;

-- Suspender alguém (ou trocar a senha) revoga todas as sessões dele. Gatilho, para
-- valer qualquer que seja o caminho da alteração.
create function app.revogar_ao_suspender() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.situacao = 'suspenso' and old.situacao <> 'suspenso') or new.senha_hash is distinct from old.senha_hash then
    update sessions set revogada_em = now() where user_id = new.id and revogada_em is null;
  end if;
  return new;
end $$;
create trigger users_revogar after update of situacao, senha_hash on users
  for each row execute function app.revogar_ao_suspender();

-- Pela aplicação, só o próprio usuário troca a própria senha. Redefinição por
-- link roda nas funções acima (como dono das tabelas) e passa por aqui livre.
create function app.senha_so_do_dono() returns trigger language plpgsql as $$
begin
  if new.senha_hash is distinct from old.senha_hash and current_user = 'wtaopt_app' and new.id is distinct from app.uid() then
    raise exception 'senha_so_do_dono' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger users_senha_so_do_dono before update of senha_hash on users
  for each row execute function app.senha_so_do_dono();

-- Recuperação de senha. Sem conta ativa, não cria nada e devolve null; a api
-- responde igual nos dois casos (sem enumeração de contas).
create function app.criar_recuperacao(p_email text, p_token_hash bytea, p_validade interval)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  select id into v_user from users where email = lower(trim(p_email)) and situacao = 'ativo';
  if v_user is null then return null; end if;
  -- Um pedido novo invalida os anteriores.
  update password_resets set usado_em = now() where user_id = v_user and usado_em is null;
  insert into password_resets (user_id, token_hash, expira_em) values (v_user, p_token_hash, now() + p_validade);
  return v_user;
end $$;

create function app.redefinir_senha(p_token_hash bytea, p_senha_hash text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  update password_resets r set usado_em = now()
  from users u
  where r.token_hash = p_token_hash and r.usado_em is null and r.expira_em > now()
    and u.id = r.user_id and u.situacao = 'ativo'
  returning r.user_id into v_user;
  if v_user is null then raise exception 'token_invalido' using errcode = 'P0001'; end if;
  update users set senha_hash = p_senha_hash, deve_trocar_senha = false where id = v_user;
  insert into audit_logs (organization_id, ator_id, acao, alvo_tipo, alvo_id)
  select organization_id, id, 'senha.redefinida', 'usuario', id::text from users where id = v_user;
  return v_user;
end $$;

-- Convite: consulta pública só diz se vale e para qual e-mail.
create function app.convite_valido(p_token_hash bytea)
returns table (email text, papel text, organizacao text)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.email, i.papel, o.nome from invites i join organizations o on o.id = i.organization_id
  where i.token_hash = p_token_hash and i.usado_em is null and i.cancelado_em is null and i.expira_em > now();
$$;

create function app.aceitar_convite(p_token_hash bytea, p_nome text, p_senha_hash text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inv invites; v_user uuid;
begin
  update invites set usado_em = now()
  where token_hash = p_token_hash and usado_em is null and cancelado_em is null and expira_em > now()
  returning * into v_inv;
  if not found then raise exception 'convite_invalido' using errcode = 'P0001'; end if;
  if exists (select 1 from users where email = v_inv.email) then raise exception 'email_ja_cadastrado' using errcode = 'P0001'; end if;
  insert into users (organization_id, email, nome, papel, senha_hash)
  values (v_inv.organization_id, v_inv.email, left(trim(p_nome), 120), v_inv.papel, p_senha_hash)
  returning id into v_user;
  insert into audit_logs (organization_id, ator_id, acao, alvo_tipo, alvo_id, depois)
  values (v_inv.organization_id, v_user, 'convite.aceito', 'usuario', v_user::text,
          jsonb_build_object('email', v_inv.email, 'papel', v_inv.papel, 'convidado_por', v_inv.criado_por));
  return v_user;
end $$;

-- Primeira conta: só cria se ainda não existir nenhum superadministrador.
create function app.garantir_superadmin(p_email text, p_senha_hash text, p_organizacao text default 'WTA')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_user uuid;
begin
  perform pg_advisory_xact_lock(hashtext('app.garantir_superadmin'));
  if exists (select 1 from users where papel = 'superadmin') then return null; end if;
  insert into organizations (nome) values (p_organizacao) returning id into v_org;
  insert into users (organization_id, email, nome, papel, senha_hash, deve_trocar_senha)
  values (v_org, lower(trim(p_email)), '', 'superadmin', p_senha_hash, true)
  returning id into v_user;
  insert into audit_logs (organization_id, ator_id, acao, alvo_tipo, alvo_id)
  values (v_org, v_user, 'superadmin.criado', 'usuario', v_user::text);
  return v_user;
end $$;

-- Quem pode chamar o quê: nada para public; só o necessário para a aplicação.
revoke execute on all functions in schema app from public;
grant execute on function
  app.uid(), app.eu(), app.papel(), app.org(),
  app.tentativa_bloqueada(text), app.registrar_falha(text, integer, interval), app.limpar_falhas(text),
  app.usuario_para_login(text), app.criar_sessao(uuid, bytea, text, interval, inet, text),
  app.sessao_por_token(bytea, interval), app.revogar_sessao_por_token(bytea),
  app.criar_recuperacao(text, bytea, interval), app.redefinir_senha(bytea, text),
  app.convite_valido(bytea), app.aceitar_convite(bytea, text, text),
  app.garantir_superadmin(text, text, text)
to wtaopt_app;
