-- WTA Options Intelligence — 0005: alertas, eventos, avisos (outbox) e Telegram.
--
-- Regras, estado, eventos e avisos são do dono (RLS): ninguém mais lê, nem admin.
-- A api avalia as regras quando chega cotação (como o próprio dono, dentro da RLS).
-- O envio ao Telegram é do worker (papel wtaopt_coleta), que não lê as tabelas:
-- só usa as funções abaixo, que entregam o mínimo (texto e chat) e marcam o resultado.

create table regras_alerta (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users (id) on delete cascade,
  nome             text not null check (length(trim(nome)) between 1 and 80),
  codigo           text not null check (codigo ~ '^[A-Z0-9]{4,12}$'),
  condicao         jsonb not null,
  rearme           jsonb not null,
  limite_por_dia   integer not null default 5 check (limite_por_dia between 1 and 50),
  aceitar_periodica boolean not null default true,
  janela_inicio    text check (janela_inicio ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  janela_fim       text check (janela_fim ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  ativa            boolean not null default true,
  versao           integer not null default 1,
  criada_em        timestamptz not null default now(),
  atualizada_em    timestamptz not null default now(),
  check ((janela_inicio is null) = (janela_fim is null)),
  check (janela_inicio is null or janela_inicio < janela_fim)
);
create index regras_alerta_dono on regras_alerta (user_id, codigo) where ativa;

-- Estado do motor por regra (versão da regra junto: regra editada recomeça o estado).
create table estados_alerta (
  regra_id      uuid primary key references regras_alerta (id) on delete cascade,
  user_id       uuid not null references users (id) on delete cascade,
  versao        integer not null,
  estado        jsonb not null,
  atualizado_em timestamptz not null default now()
);

create table eventos_alerta (
  id          bigint generated always as identity primary key,
  regra_id    uuid references regras_alerta (id) on delete set null,
  user_id     uuid not null references users (id) on delete cascade,
  chave       text not null unique, -- idempotência: regra + versão + número do disparo
  codigo      text not null,
  descricao   text not null,        -- a condição como estava quando disparou
  instante    timestamptz not null, -- instante da fonte
  qualidade   text not null,
  fonte       text not null,
  valores     jsonb not null,
  criado_em   timestamptz not null default now()
);
create index eventos_alerta_dono on eventos_alerta (user_id, criado_em desc);

-- Vínculo com o Telegram e silêncio.
create table vinculos_telegram (
  user_id       uuid primary key references users (id) on delete cascade,
  chat_id       bigint not null unique,
  nome_telegram text check (length(nome_telegram) <= 80),
  vinculado_em  timestamptz not null default now(),
  silencio_ate  timestamptz
);

create table codigos_telegram (
  codigo_hash bytea primary key,
  user_id     uuid not null references users (id) on delete cascade,
  expira_em   timestamptz not null,
  usado_em    timestamptz
);

-- Outbox: um aviso por evento e canal; o worker envia e marca.
create table avisos (
  id                 bigint generated always as identity primary key,
  user_id            uuid not null references users (id) on delete cascade,
  evento_id          bigint references eventos_alerta (id) on delete cascade,
  canal              text not null check (canal in ('telegram')),
  chave              text not null unique,
  texto              text not null check (length(texto) <= 4000),
  situacao           text not null default 'pendente' check (situacao in ('pendente', 'enviado', 'falhou', 'sem_destino', 'silenciado')),
  tentativas         integer not null default 0,
  proxima_tentativa  timestamptz not null default now(),
  enviado_em         timestamptz,
  erro               text check (length(erro) <= 300),
  criado_em          timestamptz not null default now()
);
create index avisos_pendentes on avisos (proxima_tentativa) where situacao = 'pendente';

alter table regras_alerta     enable row level security;
alter table estados_alerta    enable row level security;
alter table eventos_alerta    enable row level security;
alter table vinculos_telegram enable row level security;
alter table codigos_telegram  enable row level security;
alter table avisos            enable row level security;

grant select, insert, update, delete on regras_alerta to wtaopt_app;
create policy regras_dono on regras_alerta for all to wtaopt_app using (user_id = app.eu()) with check (user_id = app.eu());
grant select, insert, update, delete on estados_alerta to wtaopt_app;
create policy estados_dono on estados_alerta for all to wtaopt_app using (user_id = app.eu()) with check (user_id = app.eu());
grant select, insert on eventos_alerta to wtaopt_app;
create policy eventos_dono_ler on eventos_alerta for select to wtaopt_app using (user_id = app.eu());
create policy eventos_dono_criar on eventos_alerta for insert to wtaopt_app with check (user_id = app.eu());
grant select, insert on avisos to wtaopt_app;
create policy avisos_dono_ler on avisos for select to wtaopt_app using (user_id = app.eu());
create policy avisos_dono_criar on avisos for insert to wtaopt_app with check (user_id = app.eu() and situacao = 'pendente');
grant select (user_id, nome_telegram, vinculado_em, silencio_ate), delete on vinculos_telegram to wtaopt_app;
grant update (silencio_ate) on vinculos_telegram to wtaopt_app;
create policy vinculo_dono on vinculos_telegram for all to wtaopt_app using (user_id = app.eu()) with check (user_id = app.eu());
grant insert (codigo_hash, user_id, expira_em) on codigos_telegram to wtaopt_app;
create policy codigos_dono on codigos_telegram for insert to wtaopt_app with check (user_id = app.eu());

-- ---------------------------------------------------------------------------
-- Funções do worker (Telegram). Só o mínimo, e só para contas ativas.
-- ---------------------------------------------------------------------------

-- "/start CODIGO" no bot: liga o chat à conta dona do código (válido e não usado).
create function app.vincular_telegram(p_codigo_hash bytea, p_chat_id bigint, p_nome text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  update codigos_telegram c set usado_em = now()
  from users u
  where c.codigo_hash = p_codigo_hash and c.usado_em is null and c.expira_em > now()
    and u.id = c.user_id and u.situacao = 'ativo'
  returning c.user_id into v_user;
  if v_user is null then return false; end if;
  delete from vinculos_telegram where chat_id = p_chat_id and user_id <> v_user; -- o chat passa para a conta nova
  insert into vinculos_telegram (user_id, chat_id, nome_telegram) values (v_user, p_chat_id, left(p_nome, 80))
  on conflict (user_id) do update set chat_id = excluded.chat_id, nome_telegram = excluded.nome_telegram, vinculado_em = now(), silencio_ate = null;
  return true;
end $$;

-- Comandos do chat já vinculado: silêncio, ativar, desvincular, situação.
create function app.comando_telegram(p_chat_id bigint, p_comando text, p_minutos integer default null)
returns table (ok boolean, silencio_ate timestamptz, regras_ativas bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  select v.user_id into v_user from vinculos_telegram v join users u on u.id = v.user_id
  where v.chat_id = p_chat_id and u.situacao = 'ativo';
  if v_user is null then return query select false, null::timestamptz, 0::bigint; return; end if;
  if p_comando = 'silenciar' then
    update vinculos_telegram set silencio_ate = now() + make_interval(mins => greatest(1, least(coalesce(p_minutos, 60), 7 * 24 * 60))) where user_id = v_user;
  elsif p_comando = 'ativar' then
    update vinculos_telegram set silencio_ate = null where user_id = v_user;
  elsif p_comando = 'desvincular' then
    delete from vinculos_telegram where user_id = v_user;
    return query select true, null::timestamptz, 0::bigint; return;
  end if;
  return query select true, v.silencio_ate, (select count(*) from regras_alerta r where r.user_id = v_user and r.ativa)
    from vinculos_telegram v where v.user_id = v_user;
end $$;

-- Avisos a enviar agora (reserva por 2 minutos para não enviar em dobro com dois workers).
create function app.avisos_para_enviar(p_limite integer default 20)
returns table (id bigint, chat_id bigint, texto text, silenciado boolean, tentativas integer, criado_em timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with escolhidos as (
    select a.id from avisos a
    where a.situacao = 'pendente' and a.proxima_tentativa <= now()
    order by a.proxima_tentativa limit greatest(1, least(p_limite, 100))
    for update skip locked
  ), reservados as (
    update avisos a set proxima_tentativa = now() + interval '2 minutes', tentativas = a.tentativas + 1
    from escolhidos e where a.id = e.id
    returning a.id, a.user_id, a.texto, a.tentativas, a.criado_em
  )
  select r.id, v.chat_id, r.texto, coalesce(v.silencio_ate > now(), false), r.tentativas, r.criado_em
  from reservados r
  join users u on u.id = r.user_id and u.situacao = 'ativo'
  left join vinculos_telegram v on v.user_id = r.user_id;
end $$;

create function app.marcar_aviso(p_id bigint, p_situacao text, p_erro text default null, p_tentar_em interval default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_situacao not in ('enviado', 'falhou', 'sem_destino', 'silenciado', 'pendente') then raise exception 'situacao_invalida' using errcode = 'P0001'; end if;
  update avisos set situacao = p_situacao, erro = left(p_erro, 300),
    enviado_em = case when p_situacao = 'enviado' then now() else enviado_em end,
    proxima_tentativa = case when p_situacao = 'pendente' then now() + coalesce(p_tentar_em, interval '1 minute') else proxima_tentativa end
  where id = p_id;
end $$;

-- Posição do "getUpdates" do Telegram (para não reprocessar mensagens depois de reiniciar).
create table controle_telegram (
  chave text primary key,
  valor bigint not null
);
alter table controle_telegram enable row level security;
grant select, insert, update on controle_telegram to wtaopt_coleta;
create policy coleta_controle on controle_telegram for all to wtaopt_coleta using (true) with check (true);

revoke execute on function app.vincular_telegram(bytea, bigint, text), app.comando_telegram(bigint, text, integer),
  app.avisos_para_enviar(integer), app.marcar_aviso(bigint, text, text, interval) from public;
grant usage on schema app to wtaopt_coleta;
grant execute on function app.vincular_telegram(bytea, bigint, text), app.comando_telegram(bigint, text, integer),
  app.avisos_para_enviar(integer), app.marcar_aviso(bigint, text, text, interval) to wtaopt_coleta;
