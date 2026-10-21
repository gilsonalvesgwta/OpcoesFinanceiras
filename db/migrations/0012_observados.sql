-- WTA Options Intelligence — 0012: séries observadas pela ponte MT5.
--
-- Quando o usuário abre a cadeia no Simulador, as séries ficam "observadas" por alguns
-- minutos e entram na lista que o robô do MT5 acompanha (além de favoritos e posições).
-- Assim a cadeia recebe preço em tempo real sem o usuário favoritar cada opção.
-- Some sozinho quando a tela fecha (o prazo vence).

create table observados_ponte (
  user_id uuid not null references users (id) on delete cascade,
  codigo  text not null check (codigo ~ '^[A-Z0-9]{4,16}$'),
  ate     timestamptz not null,
  primary key (user_id, codigo)
);
create index observados_ponte_ate on observados_ponte (user_id, ate);

alter table observados_ponte enable row level security;
grant select, insert, update, delete on observados_ponte to wtaopt_app;
create policy observados_dono on observados_ponte for all to wtaopt_app using (user_id = app.eu()) with check (user_id = app.eu());

-- Lista do robô: favoritos e posições primeiro (o robô acompanha até 500), depois as
-- séries observadas que ainda valem, das mais recentes para as mais antigas.
create or replace function app.simbolos_da_ponte(p_token_hash bytea)
returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  with dono as (select user_id from app.ponte_por_token(p_token_hash)),
  lista as (
    select codigo, 0 as ordem, null::timestamptz as ate from favoritos where user_id = (select user_id from dono)
    union all
    select codigo, 0, null from posicoes_ponte where user_id = (select user_id from dono)
    union all
    select codigo, 1, ate from observados_ponte where user_id = (select user_id from dono) and ate > now()
  )
  select codigo from (
    select codigo, min(ordem) as ordem, max(ate) as ate from lista group by codigo
  ) x
  order by ordem, ate desc nulls first, codigo
  limit 500;
$$;
