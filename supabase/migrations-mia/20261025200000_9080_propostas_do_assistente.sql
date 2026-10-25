-- manifest: AS PROPOSTAS DO ASSISTENTE DA MIA (.91, jornada de assinatura, protótipo aprovado em 25/10/2026; fase 2 da spec do upstream #2860, "propostas com aprovação"). Uma tabela NOSSA, `mia_assistente_propostas` (o `config_proposals` do desenho do upstream, com o prefixo mia_ como as da fase 1): o assistente propõe UMA peça por proposta (o agente do modelo do segmento, o funil do quadro pronto ou o follow-up do modelo), com o que muda (`mudancas`) e o pedido que o aplicar monta (`pedido`), e NADA é criado antes de aprovar: a peça nasce no aplicar. Só três tipos (`agente`, `funil`, `followup`) e só risco `seguro` ou `atencao`: o crítico (canal, número, cobrança, usuários, convite, chave, exclusão) não cabe na tabela, vira "preciso confirmar" no "o que falta". Situações do desenho do upstream: pendente, aprovada, aplicada, rejeitada, expirada; o gatilho `fn_mia_proposta_segue_a_ordem` recusa (23514) pular etapa (pendente nunca vira aplicada sem passar por aprovada), mudar a peça depois de criada e mexer em proposta decidida, e `fn_mia_proposta_nasce` faz a proposta pela sessão nascer pendente, da própria pessoa, sem aprovação nem resultado. Leitura de gestor em diante; propor é de gestor em diante, pela sessão; aprovar, aplicar e rejeitar são só do servidor (as rotas conferem o papel de administrador para aplicar e gravam o registro). Uma pendente por tipo e empresa. Travas do suporte somente leitura pela função do upstream. Nenhum objeto do upstream é redefinido. Provado em tests/invariants/primeiros-passos-do-assistente.test.ts.
--
-- 9080 · as propostas do assistente da MIA
--
-- `mia`: só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: `create
-- table if not exists`, constraints dentro de `do` que conferem o catálogo,
-- `create index if not exists`, `drop trigger/policy if exists`.
--
-- ── As regras do desenho do upstream (#2860, fase 2) que viram banco ───────
--
--   1 proposta = 1 peça        `tipo` é uma peça só, e o `pedido` é dela
--   nada antes de aprovar      a proposta guarda o pedido; o rascunho da peça
--                              nasce no aplicar, pelo servidor
--   nada crítico é proposto    `risco` só aceita seguro e atenção
--   aplicar exige aprovar      a ordem das situações é do banco, não da rota
--   aplicar é do administrador a sessão não atualiza a linha; a rota que
--                              aplica confere o papel e grava o registro

create table if not exists public.mia_assistente_propostas (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  -- A conversa em que o assistente propôs (o histórico da pessoa, 9050).
  conversa_id            uuid references public.mia_assistente_conversas(id) on delete set null,
  criada_por             uuid references auth.users(id) on delete set null,
  -- agente (do modelo do segmento), funil (do quadro pronto), followup (do modelo)
  tipo                   text not null,
  risco                  text not null default 'atencao',
  titulo                 text not null,
  -- O que muda, para o cartão da proposta: [{ "rotulo": "...", "valor": "..." }].
  mudancas               jsonb not null default '[]'::jsonb,
  -- O que o aplicar monta (o segmento, o nome, o quadro, o modelo). Nunca dado
  -- de contato: a peça é configuração da empresa.
  pedido                 jsonb not null default '{}'::jsonb,
  situacao               text not null default 'pendente',
  aprovada_por           uuid references auth.users(id) on delete set null,
  aprovada_em            timestamptz,
  aplicada_por           uuid references auth.users(id) on delete set null,
  aplicada_em            timestamptz,
  rejeitada_por          uuid references auth.users(id) on delete set null,
  rejeitada_em           timestamptz,
  -- Os ids da peça que o aplicar criou (agente, funil, fluxo de follow-up).
  resultado              jsonb,
  -- Por que o último aplicar não terminou (a proposta continua aprovada).
  erro                   text,
  -- Só follow-up: quando ele saiu junto com o agente publicado.
  saiu_com_o_agente_em   timestamptz,
  expira_em              timestamptz not null default (now() + interval '30 days'),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.mia_assistente_propostas is
  'MIA (9080): uma proposta do assistente da MIA = uma peca (agente do modelo do segmento, funil do quadro pronto ou follow-up do modelo). mudancas = o que o cartao mostra; pedido = o que o aplicar monta. Nada e criado antes de aprovar. situacao pendente -> aprovada -> aplicada, ou rejeitada / expirada (a ordem e do gatilho fn_mia_proposta_segue_a_ordem). Gestor em diante le e propoe pela sessao; aprovar, aplicar e rejeitar sao do servidor (aplicar so administrador). Risco critico nao e proposto.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_propostas_tipo') then
    alter table public.mia_assistente_propostas
      add constraint mia_assistente_propostas_tipo check (tipo in ('agente', 'funil', 'followup'));
  end if;
  -- O crítico (canal, número, cobrança, usuários, convite, chave, exclusão) não
  -- é proposto: vira "preciso confirmar" no "o que falta", com o botão da tela.
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_propostas_risco') then
    alter table public.mia_assistente_propostas
      add constraint mia_assistente_propostas_risco check (risco in ('seguro', 'atencao'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_propostas_situacao') then
    alter table public.mia_assistente_propostas
      add constraint mia_assistente_propostas_situacao
      check (situacao in ('pendente', 'aprovada', 'aplicada', 'rejeitada', 'expirada'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_propostas_titulo') then
    alter table public.mia_assistente_propostas
      add constraint mia_assistente_propostas_titulo check (length(btrim(titulo)) between 1 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_propostas_mudancas') then
    alter table public.mia_assistente_propostas
      add constraint mia_assistente_propostas_mudancas
      check (jsonb_typeof(mudancas) = 'array' and octet_length(mudancas::text) <= 8000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_propostas_pedido') then
    alter table public.mia_assistente_propostas
      add constraint mia_assistente_propostas_pedido
      check (jsonb_typeof(pedido) = 'object' and octet_length(pedido::text) <= 32000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_propostas_erro') then
    alter table public.mia_assistente_propostas
      add constraint mia_assistente_propostas_erro check (erro is null or length(erro) <= 1000);
  end if;
  -- Aplicada é sempre aprovada antes: as duas datas existem.
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_propostas_aplicada_foi_aprovada') then
    alter table public.mia_assistente_propostas
      add constraint mia_assistente_propostas_aplicada_foi_aprovada
      check (situacao <> 'aplicada' or (aprovada_em is not null and aplicada_em is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_propostas_aprovada_tem_data') then
    alter table public.mia_assistente_propostas
      add constraint mia_assistente_propostas_aprovada_tem_data
      check (situacao <> 'aprovada' or aprovada_em is not null);
  end if;
end $$;

-- Uma pendente por peça e empresa: pedir de novo devolve a mesma proposta.
create unique index if not exists mia_assistente_propostas_uma_pendente_idx
  on public.mia_assistente_propostas (organization_id, tipo)
  where situacao = 'pendente';
create index if not exists mia_assistente_propostas_org_idx
  on public.mia_assistente_propostas (organization_id, created_at desc);
-- O follow-up aplicado que espera o agente ser publicado.
create index if not exists mia_assistente_propostas_esperando_o_agente_idx
  on public.mia_assistente_propostas (organization_id)
  where tipo = 'followup' and situacao = 'aplicada' and saiu_com_o_agente_em is null;

-- ── a proposta nasce pendente, da própria pessoa ────────────────────────────
--
-- Pela sessão, quem propõe é a própria pessoa (o assistente propõe em nome de
-- quem pergunta), e a proposta nasce pendente, sem aprovação, sem resultado e
-- com 30 dias para vencer. Sem isto, um pedido direto ao PostgREST criaria uma
-- proposta já "aplicada" ou aprovada por outra pessoa.
create or replace function public.fn_mia_proposta_nasce()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $f$
begin
  if auth.uid() is not null then
    new.criada_por := auth.uid();
    new.situacao := 'pendente';
    new.aprovada_por := null;
    new.aprovada_em := null;
    new.aplicada_por := null;
    new.aplicada_em := null;
    new.rejeitada_por := null;
    new.rejeitada_em := null;
    new.resultado := null;
    new.erro := null;
    new.saiu_com_o_agente_em := null;
    new.expira_em := now() + interval '30 days';
    new.created_at := now();
    new.updated_at := now();
  end if;
  return new;
end
$f$;

comment on function public.fn_mia_proposta_nasce() is
  'MIA (9080): a proposta criada pela sessao nasce pendente, da propria pessoa, sem aprovacao, sem resultado e com 30 dias para vencer.';

revoke all on function public.fn_mia_proposta_nasce() from public;
revoke execute on function public.fn_mia_proposta_nasce() from anon, authenticated;

drop trigger if exists trg_mia_proposta_nasce on public.mia_assistente_propostas;
create trigger trg_mia_proposta_nasce
  before insert on public.mia_assistente_propostas
  for each row execute function public.fn_mia_proposta_nasce();

-- ── a ordem das situações ───────────────────────────────────────────────────
--
-- Vale para QUALQUER escrita, inclusive a do servidor: a rota que aplica não
-- consegue pular o aprovar nem reabrir uma proposta decidida. É a sabotagem que
-- o desenho do upstream pede ("aplicar pendente reprova").
create or replace function public.fn_mia_proposta_segue_a_ordem()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $f$
begin
  if new.organization_id is distinct from old.organization_id
     or new.tipo is distinct from old.tipo
     or new.pedido is distinct from old.pedido
     or new.created_at is distinct from old.created_at then
    raise exception 'proposta_imutavel'
      using errcode = '23514',
            detail = 'A peça de uma proposta não muda depois de criada: proponha de novo.';
  end if;

  if old.situacao in ('rejeitada', 'expirada') then
    raise exception 'proposta_ja_decidida'
      using errcode = '23514',
            detail = format('A proposta está %s e não muda mais.', old.situacao);
  end if;

  if old.situacao = 'pendente' and new.situacao not in ('pendente', 'aprovada', 'rejeitada', 'expirada') then
    raise exception 'proposta_sem_aprovacao'
      using errcode = '23514',
            detail = 'Uma proposta pendente precisa ser aprovada antes de ser aplicada.';
  end if;

  if old.situacao = 'aprovada' and new.situacao not in ('aprovada', 'aplicada', 'rejeitada') then
    raise exception 'proposta_transicao_invalida'
      using errcode = '23514',
            detail = format('De aprovada não se vai para %s.', new.situacao);
  end if;

  if old.situacao = 'aplicada' then
    if new.situacao <> 'aplicada'
       or new.resultado is distinct from old.resultado
       or new.aplicada_em is distinct from old.aplicada_em
       or new.aprovada_em is distinct from old.aprovada_em then
      raise exception 'proposta_ja_aplicada'
        using errcode = '23514',
              detail = 'A proposta já foi aplicada: só a saída junto com o agente ainda é anotada.';
    end if;
  end if;

  new.updated_at := now();
  return new;
end
$f$;

comment on function public.fn_mia_proposta_segue_a_ordem() is
  'MIA (9080): a ordem das situacoes da proposta (pendente -> aprovada -> aplicada, ou rejeitada / expirada). Recusa (23514) aplicar sem aprovar, mudar a peca depois de criada e mexer em proposta decidida, para qualquer escrita.';

revoke all on function public.fn_mia_proposta_segue_a_ordem() from public;
revoke execute on function public.fn_mia_proposta_segue_a_ordem() from anon, authenticated;

drop trigger if exists trg_mia_proposta_segue_a_ordem on public.mia_assistente_propostas;
create trigger trg_mia_proposta_segue_a_ordem
  before update on public.mia_assistente_propostas
  for each row execute function public.fn_mia_proposta_segue_a_ordem();

-- ── permissões e RLS ────────────────────────────────────────────────────────

alter table public.mia_assistente_propostas enable row level security;

revoke all on table public.mia_assistente_propostas from public, anon, authenticated;
-- Propor é pela sessão (o insert da tabela inteira é o que faz as travas do
-- suporte a alcançarem); quem decide o que nasce é o gatilho. Aprovar, aplicar
-- e rejeitar são do servidor: a sessão não atualiza nem apaga.
grant select, insert on table public.mia_assistente_propostas to authenticated;
grant all on table public.mia_assistente_propostas to service_role;

drop policy if exists "mia_assistente_propostas_select" on public.mia_assistente_propostas;
drop policy if exists "mia_assistente_propostas_insert" on public.mia_assistente_propostas;
create policy "mia_assistente_propostas_select" on public.mia_assistente_propostas
  for select using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'manager')
  );
create policy "mia_assistente_propostas_insert" on public.mia_assistente_propostas
  for insert with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'manager')
    and (conversa_id is null or exists (
      select 1 from public.mia_assistente_conversas c
       where c.id = conversa_id
         and c.organization_id = mia_assistente_propostas.organization_id
         and c.user_id = auth.uid()
    ))
  );

-- ── as travas do suporte somente leitura ────────────────────────────────────
--
-- A regra é a do upstream (0274): tabela com RLS, `organization_id` e escrita
-- para `authenticated` ganha as três políticas restritivas.
do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

notify pgrst, 'reload schema';
