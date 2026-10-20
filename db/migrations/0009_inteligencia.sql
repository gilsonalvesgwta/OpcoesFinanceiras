-- WTA Options Intelligence — 0009: inteligência operacional.
--
-- Preferências de avisos das posições (com consentimento explícito para sugestões),
-- eventos de posição (vencimento, risco, calls sem cobertura, sugestão de rolagem) e o
-- aviso pelo Telegram ligado a eles. O worker (wtaopt_coleta) não lê as tabelas do
-- usuário: ele usa duas funções que entregam só o necessário e gravam os eventos.

create table preferencias_avisos (
  user_id       uuid primary key references users (id) on delete cascade,
  preferencias  jsonb not null default '{}'::jsonb,   -- ver PreferenciasDeAvisos no domínio
  criterios     jsonb not null default '{}'::jsonb,   -- critérios das sugestões de rolagem
  atualizado_em timestamptz not null default now()
);

create table eventos_posicao (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references users (id) on delete cascade,
  estrategia_id uuid references estrategias (id) on delete set null,
  tipo          text not null check (tipo in ('vencimento', 'risco_strike', 'descoberta', 'sugestao_rolagem')),
  codigo        text not null check (codigo ~ '^[A-Z0-9]{4,12}$'),
  chave         text not null check (length(chave) <= 200),
  titulo        text not null check (length(titulo) <= 200),
  texto         text not null check (length(texto) <= 3000),
  valores       jsonb not null default '{}'::jsonb,
  lido_em       timestamptz,
  criado_em     timestamptz not null default now(),
  unique (user_id, chave)
);
create index eventos_posicao_dono on eventos_posicao (user_id, criado_em desc);

alter table avisos add column evento_posicao_id bigint references eventos_posicao (id) on delete cascade;

alter table preferencias_avisos enable row level security;
alter table eventos_posicao     enable row level security;
grant select, insert, update, delete on preferencias_avisos to wtaopt_app;
create policy preferencias_avisos_dono on preferencias_avisos for all to wtaopt_app using (user_id = app.eu()) with check (user_id = app.eu());
grant select, delete on eventos_posicao to wtaopt_app;
grant update (lido_em) on eventos_posicao to wtaopt_app;
create policy eventos_posicao_dono on eventos_posicao for all to wtaopt_app using (user_id = app.eu()) with check (user_id = app.eu());

-- Para o worker: estratégias abertas (com as execuções) de quem tem avisos ligados.
-- Usuário sem linha de preferências usa o padrão (vencimento, risco e cobertura ligados;
-- sugestões desligadas até o consentimento).
create function app.posicoes_para_avisos()
returns table (user_id uuid, preferencias jsonb, criterios jsonb, estrategia_id uuid, nome text, ativo_objeto text, execucoes jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.user_id, coalesce(p.preferencias, '{}'::jsonb), coalesce(p.criterios, '{}'::jsonb), e.id, e.nome, e.ativo_objeto,
         (select coalesce(jsonb_agg(jsonb_build_object(
            'codigo', x.codigo, 'tipo', x.tipo, 'strike', x.strike, 'vencimento', to_char(x.vencimento, 'YYYY-MM-DD'),
            'multiplicador', x.multiplicador, 'lado', x.lado, 'quantidade', x.quantidade, 'preco', x.preco, 'custos', x.custos,
            'instante', x.instante) order by x.instante), '[]'::jsonb)
          from execucoes x where x.estrategia_id = e.id)
  from estrategias e
  join users u on u.id = e.user_id and u.situacao = 'ativo'
  left join preferencias_avisos p on p.user_id = e.user_id
  where e.situacao = 'aberta'
  order by e.user_id, e.criada_em
$$;

-- Grava o evento uma vez só (pela chave) e, se pedido, o aviso do Telegram.
-- Devolve true quando o evento é novo.
create function app.registrar_evento_posicao(
  p_user uuid, p_estrategia uuid, p_tipo text, p_codigo text, p_chave text, p_titulo text, p_texto text, p_valores jsonb, p_telegram boolean
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  if not exists (select 1 from users where id = p_user and situacao = 'ativo') then return false; end if;
  if p_estrategia is not null and not exists (select 1 from estrategias where id = p_estrategia and user_id = p_user) then
    raise exception 'estrategia_de_outro_usuario' using errcode = 'P0001';
  end if;
  insert into eventos_posicao (user_id, estrategia_id, tipo, codigo, chave, titulo, texto, valores)
  values (p_user, p_estrategia, p_tipo, p_codigo, p_chave, left(p_titulo, 200), left(p_texto, 3000), coalesce(p_valores, '{}'::jsonb))
  on conflict (user_id, chave) do nothing
  returning id into v_id;
  if v_id is null then return false; end if;
  if p_telegram then
    insert into avisos (user_id, evento_posicao_id, canal, chave, texto)
    values (p_user, v_id, 'telegram', 'posicao:' || v_id, left(p_titulo || E'\n' || p_texto, 4000))
    on conflict (chave) do nothing;
  end if;
  return true;
end $$;

revoke execute on function app.posicoes_para_avisos(), app.registrar_evento_posicao(uuid, uuid, text, text, text, text, text, jsonb, boolean) from public;
grant execute on function app.posicoes_para_avisos(), app.registrar_evento_posicao(uuid, uuid, text, text, text, text, text, jsonb, boolean) to wtaopt_coleta;
