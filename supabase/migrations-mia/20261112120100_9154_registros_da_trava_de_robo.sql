-- manifest: A TRAVA DE ROBÔ, o registro de cada vez que ela agiu (.108; docs/fork/trava-de-robo.md). FORK MIA (.108): `mia_travas_de_robo` é a auditoria da trava e também a âncora da conta seguinte: a avaliação de uma conversa só conta o que chegou DEPOIS do último registro dela, para quem devolve a conversa para a IA não a ver travar de novo pelos giros já contados. Uma linha por disparo, com a empresa, o contato, a conversa e o job; o `motivo` ('robo': o laço com outro robô; 'teto': respostas demais da IA na conversa); os `sinais` que casaram em jsonb (só o id da mensagem e o NOME do sinal: autodeclaracao, repeticao, velocidade; nunca o texto); quantas mensagens de robô e quantas respostas da IA na janela; os negócios marcados como perdidos (`negocios_afetados`, uuid[]); se a conversa foi encerrada, se a etiqueta "robô" foi posta e quantos follow-ups foram cancelados; os códigos do que falhou; e o desfazer (`desfeita_em`, `desfeita_por_user_id`, pelo MCP `plataforma_desfazer_trava_de_robo`). Nenhum dado pessoal além do ponteiro para o contato, que vira nulo se a ficha for apagada (on delete set null): declarada em `NAO_SE_REDIGE` (tests/unit/lgpd-exporta-o-que-redige.test.ts). RLS igual às vizinhas do fork: gerente lê a própria empresa, o administrador de plataforma lê todas, só o servidor escreve. Nenhum objeto do upstream é tocado. Idempotente.
--
-- 9154 · o registro da trava de robô
--
-- FORK MIA (.108). Só objetos NOSSOS (docs/FORK-MIA.md, regra 3): uma tabela
-- nova, as constraints dela dentro de `do` que confere o catálogo e dois
-- índices. Nenhuma função criada.

create table if not exists public.mia_travas_de_robo (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  -- O ponteiro para o contato e a conversa. Apagar a ficha ou a conversa solta a
  -- referência e deixa o registro (é auditoria).
  contact_id            uuid references public.contacts(id) on delete set null,
  conversation_id       uuid references public.conversations(id) on delete set null,
  -- O turno que disparou. Sem FK: a fila é podada e o registro fica.
  job_id                uuid,
  motivo                text not null,
  -- [{ "mensagem_id": "<uuid>", "sinais": ["autodeclaracao", "repeticao", "velocidade"] }]
  sinais                jsonb not null default '[]'::jsonb,
  mensagens_de_robo     integer not null default 0,
  respostas_da_ia       integer not null default 0,
  duracao_segundos      integer not null default 0,
  negocios_afetados     uuid[] not null default '{}'::uuid[],
  conversa_encerrada    boolean not null default false,
  etiqueta_aplicada     boolean not null default false,
  followups_cancelados  integer not null default 0,
  -- Códigos curtos do que não deu certo (ex.: 'conversa_nao_encerrada:PT409'). Nunca texto da conversa.
  falhas                text[] not null default '{}'::text[],
  desfeita_em           timestamptz,
  desfeita_por_user_id  uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_travas_de_robo_motivo') then
    alter table public.mia_travas_de_robo add constraint mia_travas_de_robo_motivo check (motivo in ('robo', 'teto'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_travas_de_robo_sinais') then
    alter table public.mia_travas_de_robo add constraint mia_travas_de_robo_sinais check (jsonb_typeof(sinais) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_travas_de_robo_contagens') then
    alter table public.mia_travas_de_robo add constraint mia_travas_de_robo_contagens
      check (mensagens_de_robo >= 0 and respostas_da_ia >= 0 and duracao_segundos >= 0 and followups_cancelados >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_travas_de_robo_teto_nao_perde') then
    -- O teto pausa SÓ a conversa: não perde negócio, não encerra e não etiqueta.
    alter table public.mia_travas_de_robo add constraint mia_travas_de_robo_teto_nao_perde
      check (motivo = 'robo' or (cardinality(negocios_afetados) = 0 and not conversa_encerrada and not etiqueta_aplicada));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_travas_de_robo_desfeita') then
    alter table public.mia_travas_de_robo add constraint mia_travas_de_robo_desfeita
      check (desfeita_em is null or desfeita_em >= created_at);
  end if;
end $$;

comment on table public.mia_travas_de_robo is
  'MIA (9154): cada vez que a trava de robo agiu (docs/fork/trava-de-robo.md). motivo robo = o laco com outro robo (a IA calou para o contato, negocios abertos perdidos, conversa encerrada); teto = respostas demais da IA na conversa (a IA pausou so ali). sinais guarda o id da mensagem e o nome do sinal, nunca o texto. E a ancora da conta: a avaliacao so conta o que chegou depois do ultimo registro da conversa. Gerente le a propria empresa; so o servidor escreve.';

create index if not exists mia_travas_de_robo_org_idx on public.mia_travas_de_robo (organization_id, created_at desc);
create index if not exists mia_travas_de_robo_conversa_idx on public.mia_travas_de_robo (conversation_id, created_at desc) where conversation_id is not null;

-- ── RLS: gerente lê a própria empresa; só o servidor escreve ────────────────
alter table public.mia_travas_de_robo enable row level security;

drop policy if exists mia_travas_de_robo_select on public.mia_travas_de_robo;
create policy mia_travas_de_robo_select on public.mia_travas_de_robo
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- O default ACL do Supabase dá ALL a anon e authenticated em toda tabela nova;
-- o `grant select` sozinho não o desfaz (lição da 9001).
revoke all on public.mia_travas_de_robo from public, anon, authenticated;
grant select on public.mia_travas_de_robo to authenticated;
grant select, insert, update, delete on public.mia_travas_de_robo to service_role;

notify pgrst, 'reload schema';
