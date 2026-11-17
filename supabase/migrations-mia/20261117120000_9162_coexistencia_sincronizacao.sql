-- manifest: A SINCRONIZAÇÃO DA COEXISTÊNCIA DO WHATSAPP, por número (S2 da coexistência; docs/fork/coexistencia.md). FORK MIA: quando o cliente conecta pelo app WhatsApp Business o MESMO número que usa no celular, a Meta manda uma vez só os contatos do app (`smb_app_state_sync`) e até 180 dias de conversa (`history`), em lotes fora de ordem. Três tabelas NOSSAS guardam o estado disso. `mia_coexistencia_conexoes`: um ciclo de conexão do número pelo app (`no_ar`, `fora_do_ar`, `encerrada`; um ciclo vivo por número), com quem o abriu (`conexao_pelo_app` na janela da Meta, ou `historico_sem_pedido` quando o histórico chegou sem a MIA ter aberto o ciclo). `mia_coexistencia_sincronizacoes`: os dois pedidos do ciclo (`contatos` e `historico`), `unique (conexao_id, tipo)`, que é a trava do pedido único, com estado (`pedindo`, `pedida`, `em_andamento`, `concluida`, `falhou`, `recusada_pelo_dono`, `sem_resposta`, `prazo_vencido`), o `request_id` e o erro que a Meta devolveu, a fase e o progresso do histórico e os contadores (contatos, conversas, mensagens novas e já existentes, mídias, lotes com falha). `mia_coexistencia_lotes`: cada pedaço do histórico (e cada mídia que chega à parte), `unique (sincronizacao_id, chave)`, para o mesmo lote reentregue não ser gravado nem contado de novo; o lote cru (`payload`) vira nulo assim que é gravado ou desiste, para a conversa não ficar guardada duas vezes. As mensagens do histórico vão para `messages` com `metadata.historico_importado = 'true'`, a chave da 0760, e por isso não disparam nada; esta migration não toca nesse corte. Duas funções nossas, `security invoker`, só o `service_role` executa: `fn_mia_coexistencia_somar_contato` (+1 contato, e o pedido passa a `em_andamento`) e `fn_mia_coexistencia_recontar` (soma os lotes gravados no pedido do histórico, numa escrita só, e fecha em `concluida` quando o lote de progresso 100 chegou e nenhum está pendente). RLS: a equipe da empresa lê o ciclo e os pedidos; o lote cru só o administrador de plataforma lê; só o servidor escreve. Nenhum objeto do upstream é tocado. Idempotente.
--
-- 9162 · o estado da sincronização da coexistência, por número
--
-- FORK MIA (S2 da coexistência). Só objetos NOSSOS (docs/FORK-MIA.md, regra 3):
-- três tabelas novas, as constraints delas dentro de `do` que confere o
-- catálogo, índices, duas funções com nome nosso e as policies. O gatilho de
-- `updated_at` é a função de sempre do upstream (`fn_set_updated_at`, só
-- CHAMADA).
--
-- O prazo de 24 h para pedir a sincronização é `conectada_em + 24 h`, calculado
-- por quem pede (S3). Não é coluna gerada: `timestamptz + interval` não é
-- imutável para o Postgres.

-- ── o ciclo de conexão do número pelo app ───────────────────────────────────
create table if not exists public.mia_coexistencia_conexoes (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations(id) on delete cascade,
  channel_session_id        uuid not null references public.channel_sessions(id) on delete cascade,
  waba_id                   text not null,
  phone_number_id           text not null,
  -- Quem abriu o ciclo: a janela da Meta (S3) ou o histórico que chegou sem ciclo.
  aberta_por                text not null default 'conexao_pelo_app',
  -- O começo das 24 h que a Meta dá para pedir a sincronização.
  conectada_em              timestamptz not null default now(),
  estado                    text not null default 'no_ar',
  fora_do_ar_motivo         text,
  fora_do_ar_iniciado_por   text,
  fora_do_ar_em             timestamptz,
  voltou_em                 timestamptz,
  -- O `time` do último `account_update` aplicado: guarda de ordem (S4).
  ultimo_evento_em          timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_coexistencia_conexoes_estado') then
    alter table public.mia_coexistencia_conexoes add constraint mia_coexistencia_conexoes_estado
      check (estado in ('no_ar', 'fora_do_ar', 'encerrada'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_coexistencia_conexoes_aberta_por') then
    alter table public.mia_coexistencia_conexoes add constraint mia_coexistencia_conexoes_aberta_por
      check (aberta_por in ('conexao_pelo_app', 'historico_sem_pedido'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_coexistencia_conexoes_motivo') then
    -- O vocabulário do `PARTNER_REMOVED` da Meta, mais a saída pelo `ACCOUNT_OFFBOARDED`.
    alter table public.mia_coexistencia_conexoes add constraint mia_coexistencia_conexoes_motivo
      check (fora_do_ar_motivo is null or fora_do_ar_motivo in (
        'ACCOUNT_DISCONNECTED', 'BUSINESS_DOWNGRADE', 'CHANGE_NUMBER', 'COMPANION_INACTIVITY',
        'PRIMARY_INACTIVITY', 'USER_RE_REGISTERED', 'ACCOUNT_OFFBOARDED', 'desconhecido'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_coexistencia_conexoes_iniciado_por') then
    alter table public.mia_coexistencia_conexoes add constraint mia_coexistencia_conexoes_iniciado_por
      check (fora_do_ar_iniciado_por is null or fora_do_ar_iniciado_por in ('USER', 'SYSTEM'));
  end if;
end $$;

comment on table public.mia_coexistencia_conexoes is
  'MIA (9162): um ciclo de conexao de um numero pelo app WhatsApp Business (coexistencia; docs/fork/coexistencia.md). Ciclo novo so quando o cliente passa pela janela da Meta de novo; um ciclo vivo (estado <> encerrada) por numero. aberta_por = historico_sem_pedido quando o historico chegou sem a MIA ter aberto o ciclo. A equipe da empresa le; so o servidor escreve.';

-- Um ciclo vivo por número.
create unique index if not exists mia_coexistencia_conexoes_viva_uidx
  on public.mia_coexistencia_conexoes (channel_session_id)
  where estado <> 'encerrada';
create index if not exists mia_coexistencia_conexoes_org_idx
  on public.mia_coexistencia_conexoes (organization_id, created_at desc);
create index if not exists mia_coexistencia_conexoes_numero_idx
  on public.mia_coexistencia_conexoes (organization_id, phone_number_id)
  where estado <> 'encerrada';

-- ── os dois pedidos do ciclo: contatos e histórico ──────────────────────────
create table if not exists public.mia_coexistencia_sincronizacoes (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations(id) on delete cascade,
  conexao_id              uuid not null references public.mia_coexistencia_conexoes(id) on delete cascade,
  tipo                    text not null,
  estado                  text not null,
  pedida_em               timestamptz,
  respondida_em           timestamptz,
  concluida_em            timestamptz,
  -- O que a Meta devolve ao pedido (para o suporte da Meta).
  request_id              text,
  -- Só o que a Meta disse: código e título. Nunca o payload.
  erro_codigo             text,
  erro_titulo             text,
  progresso               integer,
  fase                    integer,
  contatos_recebidos      integer not null default 0,
  conversas_recebidas     integer not null default 0,
  mensagens_recebidas     integer not null default 0,
  mensagens_existentes    integer not null default 0,
  midias_guardadas        integer not null default 0,
  lotes_com_falha         integer not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_coexistencia_sincronizacoes_tipo') then
    alter table public.mia_coexistencia_sincronizacoes add constraint mia_coexistencia_sincronizacoes_tipo
      check (tipo in ('contatos', 'historico'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_coexistencia_sincronizacoes_estado') then
    alter table public.mia_coexistencia_sincronizacoes add constraint mia_coexistencia_sincronizacoes_estado
      check (estado in ('pedindo', 'pedida', 'em_andamento', 'concluida', 'falhou',
                        'recusada_pelo_dono', 'sem_resposta', 'prazo_vencido'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_coexistencia_sincronizacoes_progresso') then
    alter table public.mia_coexistencia_sincronizacoes add constraint mia_coexistencia_sincronizacoes_progresso
      check ((progresso is null or progresso between 0 and 100) and (fase is null or fase between 0 and 2));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_coexistencia_sincronizacoes_contagens') then
    alter table public.mia_coexistencia_sincronizacoes add constraint mia_coexistencia_sincronizacoes_contagens
      check (contatos_recebidos >= 0 and conversas_recebidas >= 0 and mensagens_recebidas >= 0
             and mensagens_existentes >= 0 and midias_guardadas >= 0 and lotes_com_falha >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_coexistencia_sincronizacoes_erro') then
    alter table public.mia_coexistencia_sincronizacoes add constraint mia_coexistencia_sincronizacoes_erro
      check ((erro_codigo is null or length(erro_codigo) <= 40) and (erro_titulo is null or length(erro_titulo) <= 300));
  end if;
  -- A TRAVA DO PEDIDO ÚNICO: um pedido de cada tipo por ciclo. Quem não
  -- consegue inserir a linha não chama a Meta (S3).
  if not exists (select 1 from pg_constraint where conname = 'mia_coexistencia_sincronizacoes_um_por_tipo') then
    alter table public.mia_coexistencia_sincronizacoes add constraint mia_coexistencia_sincronizacoes_um_por_tipo
      unique (conexao_id, tipo);
  end if;
end $$;

comment on table public.mia_coexistencia_sincronizacoes is
  'MIA (9162): os dois pedidos de sincronizacao de um ciclo da coexistencia (contatos e historico; docs/fork/coexistencia.md). unique (conexao_id, tipo) e a trava do pedido unico: a Meta aceita cada pedido uma vez so, ate 24 h depois da conexao. Os contadores dizem o que chegou: contatos do app novos ou renomeados, conversas criadas pelo historico, mensagens novas e ja existentes, midias guardadas, lotes que desistiram. A equipe da empresa le; so o servidor escreve.';

create index if not exists mia_coexistencia_sincronizacoes_org_idx
  on public.mia_coexistencia_sincronizacoes (organization_id, created_at desc);

-- ── cada pedaço do histórico ────────────────────────────────────────────────
create table if not exists public.mia_coexistencia_lotes (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  sincronizacao_id    uuid not null references public.mia_coexistencia_sincronizacoes(id) on delete cascade,
  -- `mensagens`: um pedaço do histórico (`phase` + `chunk_order`);
  -- `midia`: o arquivo de uma mensagem que veio como `media_placeholder`.
  tipo                text not null,
  -- `f<fase>:o<ordem>` ou `midia:<wamid>`: o que a reentrega repete.
  chave               text not null,
  fase                integer,
  ordem               integer,
  progresso           integer,
  estado              text not null default 'recebido',
  -- O lote cru. Vira NULO quando é gravado ou desiste: a conversa não fica
  -- guardada duas vezes.
  payload             jsonb,
  mensagens           integer not null default 0,
  existentes          integer not null default 0,
  conversas           integer not null default 0,
  midias              integer not null default 0,
  ignoradas           integer not null default 0,
  tentativas          integer not null default 0,
  -- Código curto do que falhou. Nunca texto da conversa.
  erro                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_coexistencia_lotes_tipo') then
    alter table public.mia_coexistencia_lotes add constraint mia_coexistencia_lotes_tipo
      check (tipo in ('mensagens', 'midia'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_coexistencia_lotes_estado') then
    alter table public.mia_coexistencia_lotes add constraint mia_coexistencia_lotes_estado
      check (estado in ('recebido', 'gravado', 'falhou'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_coexistencia_lotes_cru_so_pendente') then
    -- O lote gravado (ou que desistiu) não guarda a conversa.
    alter table public.mia_coexistencia_lotes add constraint mia_coexistencia_lotes_cru_so_pendente
      check (estado = 'recebido' or payload is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_coexistencia_lotes_contagens') then
    alter table public.mia_coexistencia_lotes add constraint mia_coexistencia_lotes_contagens
      check (mensagens >= 0 and existentes >= 0 and conversas >= 0 and midias >= 0
             and ignoradas >= 0 and tentativas >= 0
             and (progresso is null or progresso between 0 and 100)
             and (fase is null or fase between 0 and 2)
             and (erro is null or length(erro) <= 120));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_coexistencia_lotes_um_por_chave') then
    alter table public.mia_coexistencia_lotes add constraint mia_coexistencia_lotes_um_por_chave
      unique (sincronizacao_id, chave);
  end if;
end $$;

comment on table public.mia_coexistencia_lotes is
  'MIA (9162): cada pedaco do historico que a Meta manda na coexistencia (phase e chunk_order), e cada midia que chega a parte (docs/fork/coexistencia.md). unique (sincronizacao_id, chave): o lote reentregue nao e gravado nem contado de novo. payload e o lote cru e vira nulo quando o lote e gravado ou desiste. So o administrador de plataforma le; so o servidor escreve.';

create index if not exists mia_coexistencia_lotes_pendentes_idx
  on public.mia_coexistencia_lotes (sincronizacao_id)
  where estado = 'recebido';

-- ── updated_at, com a função de sempre ──────────────────────────────────────
drop trigger if exists trg_mia_coexistencia_conexoes_updated_at on public.mia_coexistencia_conexoes;
create trigger trg_mia_coexistencia_conexoes_updated_at
  before update on public.mia_coexistencia_conexoes
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_mia_coexistencia_sincronizacoes_updated_at on public.mia_coexistencia_sincronizacoes;
create trigger trg_mia_coexistencia_sincronizacoes_updated_at
  before update on public.mia_coexistencia_sincronizacoes
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_mia_coexistencia_lotes_updated_at on public.mia_coexistencia_lotes;
create trigger trg_mia_coexistencia_lotes_updated_at
  before update on public.mia_coexistencia_lotes
  for each row execute function public.fn_set_updated_at();

-- ── as somas, numa escrita só ───────────────────────────────────────────────
-- `security invoker`: quem chama é o servidor (service_role), e a sessão do
-- cliente nem executa. Sem dado pessoal: só ids e contagens.

-- +1 contato do app (novo ou renomeado). O pedido que esperava resposta passa a
-- `em_andamento`: chegou o que foi pedido.
create or replace function public.fn_mia_coexistencia_somar_contato(p_sincronizacao uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.mia_coexistencia_sincronizacoes
     set contatos_recebidos = contatos_recebidos + 1,
         estado = case when estado in ('pedindo', 'pedida', 'sem_resposta') then 'em_andamento' else estado end
   where id = p_sincronizacao
     and tipo = 'contatos';
$$;

comment on function public.fn_mia_coexistencia_somar_contato(uuid) is
  'MIA (9162): soma um contato do app (novo ou renomeado) no pedido de contatos da coexistencia, e o pedido que esperava resposta passa a em_andamento. So o servidor executa.';

-- Os contadores do pedido do histórico são a SOMA dos lotes, recalculada a cada
-- lote: um lote reentregue ou refeito não soma duas vezes. Fecha em `concluida`
-- quando o lote de progresso 100 chegou e nenhum lote de mensagens está
-- pendente; aí o pedido de contatos que estava em andamento fecha junto (a Meta
-- não avisa o fim dos contatos). Estado de erro do pedido não é desfeito.
create or replace function public.fn_mia_coexistencia_recontar(p_sincronizacao uuid)
returns text
language sql
security invoker
set search_path = ''
as $$
  with soma as (
    select
      coalesce(sum(l.mensagens) filter (where l.estado = 'gravado'), 0)::integer  as mensagens,
      coalesce(sum(l.existentes) filter (where l.estado = 'gravado'), 0)::integer as existentes,
      coalesce(sum(l.conversas) filter (where l.estado = 'gravado'), 0)::integer  as conversas,
      coalesce(sum(l.midias) filter (where l.estado = 'gravado'), 0)::integer     as midias,
      count(*) filter (where l.estado = 'falhou')::integer                        as falhas,
      max(l.progresso) filter (where l.tipo = 'mensagens')                        as progresso,
      max(l.fase) filter (where l.tipo = 'mensagens')                             as fase,
      coalesce(bool_or(l.progresso = 100) filter (where l.tipo = 'mensagens'), false) as chegou_o_fim,
      count(*) filter (where l.tipo = 'mensagens' and l.estado = 'recebido')::integer as pendentes
    from public.mia_coexistencia_lotes l
    where l.sincronizacao_id = p_sincronizacao
  ),
  historico as (
    update public.mia_coexistencia_sincronizacoes s
       set mensagens_recebidas  = soma.mensagens,
           mensagens_existentes = soma.existentes,
           conversas_recebidas  = soma.conversas,
           midias_guardadas     = soma.midias,
           lotes_com_falha      = soma.falhas,
           progresso            = greatest(coalesce(s.progresso, 0), coalesce(soma.progresso, 0)),
           fase                 = greatest(coalesce(s.fase, 0), coalesce(soma.fase, 0)),
           estado = case
             when s.estado in ('falhou', 'recusada_pelo_dono', 'prazo_vencido', 'concluida') then s.estado
             when soma.chegou_o_fim and soma.pendentes = 0 then 'concluida'
             else 'em_andamento'
           end,
           concluida_em = case
             when s.estado not in ('falhou', 'recusada_pelo_dono', 'prazo_vencido', 'concluida')
                  and soma.chegou_o_fim and soma.pendentes = 0 then now()
             else s.concluida_em
           end
      from soma
     where s.id = p_sincronizacao
       and s.tipo = 'historico'
    returning s.conexao_id, s.estado
  ),
  contatos as (
    update public.mia_coexistencia_sincronizacoes c
       set estado = 'concluida', concluida_em = now()
      from historico h
     where h.estado = 'concluida'
       and c.conexao_id = h.conexao_id
       and c.tipo = 'contatos'
       and c.estado = 'em_andamento'
    returning c.id
  )
  -- `contatos` roda mesmo sem ser lido: CTE que escreve executa uma vez sempre.
  select h.estado from historico h;
$$;

comment on function public.fn_mia_coexistencia_recontar(uuid) is
  'MIA (9162): recalcula os contadores do pedido do historico da coexistencia pela soma dos lotes gravados (o lote reentregue nao soma duas vezes) e fecha em concluida quando o lote de progresso 100 chegou e nenhum esta pendente; o pedido de contatos em andamento fecha junto. Devolve o estado do pedido. So o servidor executa.';

-- ── RLS: a equipe lê o estado; o lote cru, só a plataforma; só o servidor escreve ──
alter table public.mia_coexistencia_conexoes enable row level security;
alter table public.mia_coexistencia_sincronizacoes enable row level security;
alter table public.mia_coexistencia_lotes enable row level security;

drop policy if exists mia_coexistencia_conexoes_select on public.mia_coexistencia_conexoes;
create policy mia_coexistencia_conexoes_select on public.mia_coexistencia_conexoes
  for select to authenticated
  using (public.fn_is_platform_admin() or organization_id in (select public.fn_user_org_ids()));

drop policy if exists mia_coexistencia_sincronizacoes_select on public.mia_coexistencia_sincronizacoes;
create policy mia_coexistencia_sincronizacoes_select on public.mia_coexistencia_sincronizacoes
  for select to authenticated
  using (public.fn_is_platform_admin() or organization_id in (select public.fn_user_org_ids()));

-- O lote cru tem a conversa inteira do pedaço: a equipe vê as mensagens na
-- caixa de entrada, não aqui.
drop policy if exists mia_coexistencia_lotes_select on public.mia_coexistencia_lotes;
create policy mia_coexistencia_lotes_select on public.mia_coexistencia_lotes
  for select to authenticated
  using (public.fn_is_platform_admin());

-- O default ACL do Supabase dá ALL a anon e authenticated em toda tabela nova;
-- o `grant select` sozinho não o desfaz (lição da 9001).
revoke all on public.mia_coexistencia_conexoes from public, anon, authenticated;
revoke all on public.mia_coexistencia_sincronizacoes from public, anon, authenticated;
revoke all on public.mia_coexistencia_lotes from public, anon, authenticated;
grant select on public.mia_coexistencia_conexoes to authenticated;
grant select on public.mia_coexistencia_sincronizacoes to authenticated;
grant select on public.mia_coexistencia_lotes to authenticated;
grant select, insert, update, delete on public.mia_coexistencia_conexoes to service_role;
grant select, insert, update, delete on public.mia_coexistencia_sincronizacoes to service_role;
grant select, insert, update, delete on public.mia_coexistencia_lotes to service_role;

revoke all on function public.fn_mia_coexistencia_somar_contato(uuid) from public, anon, authenticated;
revoke all on function public.fn_mia_coexistencia_recontar(uuid) from public, anon, authenticated;
grant execute on function public.fn_mia_coexistencia_somar_contato(uuid) to service_role;
grant execute on function public.fn_mia_coexistencia_recontar(uuid) to service_role;

notify pgrst, 'reload schema';
