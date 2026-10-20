-- WTA Options Intelligence — 0008: rolagens.
--
-- Uma rolagem é um conjunto de execuções gravadas juntas (encerrar e abrir pernas).
-- Nada é editado: as execuções novas apontam para a rolagem; desfazer a rolagem apaga
-- só as execuções dela. O resumo guarda o que o simulador mostrou na hora (fluxo,
-- avisos, antes e depois), para o histórico.

create table rolagens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  estrategia_id uuid not null references estrategias (id) on delete cascade,
  instante      timestamptz not null,
  observacao    text check (length(observacao) <= 300),
  resumo        jsonb not null default '{}'::jsonb,
  criada_em     timestamptz not null default now()
);
create index rolagens_estrategia on rolagens (estrategia_id, instante desc);

alter table execucoes add column rolagem_id uuid references rolagens (id) on delete cascade;
create index execucoes_rolagem on execucoes (rolagem_id) where rolagem_id is not null;

alter table rolagens enable row level security;
grant select, insert, delete on rolagens to wtaopt_app;
create policy rolagens_dono on rolagens for all to wtaopt_app using (user_id = app.eu()) with check (
  user_id = app.eu() and exists (select 1 from estrategias e where e.id = estrategia_id and e.user_id = app.eu())
);

-- A execução de uma rolagem precisa ser da mesma estratégia da rolagem.
create or replace function app.conferir_rolagem_da_execucao() returns trigger language plpgsql as $$
begin
  if new.rolagem_id is not null and not exists (
    select 1 from rolagens r where r.id = new.rolagem_id and r.estrategia_id = new.estrategia_id and r.user_id = new.user_id
  ) then
    raise exception 'rolagem_de_outra_estrategia';
  end if;
  return new;
end $$;
create trigger execucoes_rolagem_confere before insert or update of rolagem_id, estrategia_id on execucoes
  for each row execute function app.conferir_rolagem_da_execucao();
