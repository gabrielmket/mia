-- manifest: O ASSISTENTE FAZ COM APROVAÇÃO (.94, protótipo "ensina e faz" aprovado em 26/10/2026, telas 3 a 5; fase 2 do desenho do upstream #2860 na MESMA tabela da .91). A `mia_assistente_propostas` (9080) ganha nove peças do dia a dia (`etapa_criar`, `etapa_renomear`, `resposta`, `etiqueta`, `tarefa`, `rascunho_de_followup`, `conhecimento`, `relatorio`, `meta`), a situação `desfeita` (só a aplicada vira desfeita, pelo servidor, com a data; desfeita não muda mais), o pedido a quem aprova (`pedida_a`, `pedida_em`), o ajuste antes de aprovar (`ajustada_por`, `ajustada_em`: a peça só muda enquanto a proposta está pendente e continua pendente) e a `chave` da peça (uma pendente por PEÇA e empresa, não mais por tipo: três etapas são três cartões). O risco vem do banco pelo tipo (o crítico continua sem caber). A RLS passa a deixar o atendente propor e ler as PRÓPRIAS propostas (o resultado volta para quem pediu); gestor e administrador leem todas; o somente leitura não propõe. O gatilho da ordem deixa passar a referência que some (a conversa expurgada, a pessoa removida) em qualquer situação, o que a 9080 recusava. `mia_assistente_config` (9050) ganha `tipos_de_proposta` (null = todos) e `pode_pedir`. Só objetos NOSSOS; nenhum objeto do upstream é redefinido. Provado em tests/invariants/assistente-faz-com-aprovacao.test.ts.
--
-- 9100 · o assistente faz com aprovação
--
-- `mia`: só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: `add
-- column if not exists`, constraints trocadas dentro de `do` (drop if exists e
-- add), `create index if not exists`, `drop policy if exists`, `create or
-- replace` das funções NOSSAS da 9080.
--
-- ── As regras do protótipo que viram banco ──────────────────────────────────
--
--   um cartão, uma peça          a `chave` identifica a peça; uma pendente por
--                                peça e empresa
--   nada antes de aprovar        a ordem pendente -> aprovada -> aplicada segue
--                                do banco, como na 9080
--   desfazer não é apagar        só a APLICADA vira desfeita, pelo servidor, e a
--                                desfeita não muda mais
--   o crítico não cabe           o risco é do tipo, e só seguro ou atenção
--   o resultado volta a quem     o atendente lê as propostas que ELE fez
--   pediu

-- ── as colunas novas ────────────────────────────────────────────────────────

alter table public.mia_assistente_propostas
  add column if not exists chave        text not null default '',
  add column if not exists pedida_a     uuid references auth.users(id) on delete set null,
  add column if not exists pedida_em    timestamptz,
  add column if not exists ajustada_por uuid references auth.users(id) on delete set null,
  add column if not exists ajustada_em  timestamptz,
  add column if not exists desfeita_por uuid references auth.users(id) on delete set null,
  add column if not exists desfeita_em  timestamptz;

comment on table public.mia_assistente_propostas is
  'MIA (9080, 9100): uma proposta do assistente da MIA = uma peca. As tres da .91 (agente do modelo, funil do quadro pronto, follow-up do modelo) e as nove do dia a dia da .94 (etapa_criar, etapa_renomear, resposta, etiqueta, tarefa, rascunho_de_followup, conhecimento, relatorio, meta). chave = a peca (uma pendente por peca e empresa); mudancas = o que o cartao mostra; pedido = o que o aplicar monta. situacao pendente -> aprovada -> aplicada -> desfeita, ou rejeitada / expirada (a ordem e do gatilho fn_mia_proposta_segue_a_ordem). pedida_a = a quem quem nao aprova pediu, com o cartao pronto. Quem aprova e quem pode fazer o mesmo na tela (o servidor confere); o risco critico nao cabe. A sessao propoe (atendente em diante) e le as suas; gestor e administrador leem todas.';

comment on column public.mia_assistente_propostas.chave is
  'MIA (9100): a peca da proposta, montada pelo servidor (o nome da etapa no funil, o atalho, a etiqueta, o mes da meta). Vazia nas tres pecas da .91, que sao uma por tipo.';
comment on column public.mia_assistente_propostas.pedida_a is
  'MIA (9100): a quem quem nao aprova pediu, com o cartao pronto (decisao 5 do prototipo). O aviso vai no sino dessa pessoa; o resultado volta para quem pediu.';
comment on column public.mia_assistente_propostas.desfeita_em is
  'MIA (9100): quando a proposta aplicada foi desfeita. Desfazer tira so o que a propria proposta fez, e so enquanto nada depende disso; a desfeita nao muda mais.';

do $$
begin
  -- As doze peças: as três da .91 e as nove do dia a dia.
  alter table public.mia_assistente_propostas drop constraint if exists mia_assistente_propostas_tipo;
  alter table public.mia_assistente_propostas
    add constraint mia_assistente_propostas_tipo check (tipo in (
      'agente', 'funil', 'followup',
      'etapa_criar', 'etapa_renomear', 'resposta', 'etiqueta', 'tarefa',
      'rascunho_de_followup', 'conhecimento', 'relatorio', 'meta'
    ));

  alter table public.mia_assistente_propostas drop constraint if exists mia_assistente_propostas_situacao;
  alter table public.mia_assistente_propostas
    add constraint mia_assistente_propostas_situacao
    check (situacao in ('pendente', 'aprovada', 'aplicada', 'rejeitada', 'expirada', 'desfeita'));

  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_propostas_desfeita_tem_data') then
    alter table public.mia_assistente_propostas
      add constraint mia_assistente_propostas_desfeita_tem_data
      check (situacao <> 'desfeita' or (desfeita_em is not null and aplicada_em is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_propostas_chave') then
    alter table public.mia_assistente_propostas
      add constraint mia_assistente_propostas_chave check (length(chave) <= 300);
  end if;
  -- Pedida tem quando; a pessoa pode sumir depois (a chave estrangeira anula).
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_propostas_pedida_tem_data') then
    alter table public.mia_assistente_propostas
      add constraint mia_assistente_propostas_pedida_tem_data check (pedida_a is null or pedida_em is not null);
  end if;
end $$;

-- Uma pendente por PEÇA e empresa (a da 9080 era por tipo). Pedir de novo a
-- mesma peça devolve o mesmo cartão; três etapas são três cartões.
--
-- O NOME é o da 9080, de propósito: todo deploy reaplica o baseline inteiro, e
-- o bloco da 9080 roda antes deste. Com outro nome, o `create unique index if
-- not exists` da 9080 recriaria o índice POR TIPO e falharia (23505) na empresa
-- que tem duas etapas pendentes. Com o mesmo nome, ele encontra este e passa.
do $$
begin
  if exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'mia_assistente_propostas_uma_pendente_idx'
       and indexdef not like '%chave%'
  ) then
    drop index public.mia_assistente_propostas_uma_pendente_idx;
  end if;
end $$;
create unique index if not exists mia_assistente_propostas_uma_pendente_idx
  on public.mia_assistente_propostas (organization_id, tipo, chave)
  where situacao = 'pendente';
-- Os pedidos esperando quem aprova.
create index if not exists mia_assistente_propostas_pedidas_idx
  on public.mia_assistente_propostas (organization_id, pedida_em desc)
  where situacao = 'pendente' and pedida_em is not null;
-- O que o assistente fez (a lista do "o que ele fez" e a do MCP).
create index if not exists mia_assistente_propostas_feitas_idx
  on public.mia_assistente_propostas (organization_id, aplicada_em desc)
  where situacao in ('aplicada', 'desfeita');
-- As de cada pessoa (o "seus pedidos" do atendente).
create index if not exists mia_assistente_propostas_de_quem_pediu_idx
  on public.mia_assistente_propostas (organization_id, criada_por, created_at desc);

-- ── a proposta nasce pendente, da própria pessoa, com o risco do tipo ───────
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
    -- 9100: o pedido, o ajuste e o desfazer são do servidor.
    new.pedida_a := null;
    new.pedida_em := null;
    new.ajustada_por := null;
    new.ajustada_em := null;
    new.desfeita_por := null;
    new.desfeita_em := null;
    new.expira_em := now() + interval '30 days';
    new.created_at := now();
    new.updated_at := now();
  end if;
  -- 9100: o risco é do TIPO, não de quem propõe. O crítico nem existe aqui.
  new.risco := case
    when new.tipo in ('etapa_criar', 'resposta', 'etiqueta', 'tarefa', 'relatorio') then 'seguro'
    else 'atencao'
  end;
  return new;
end
$f$;

comment on function public.fn_mia_proposta_nasce() is
  'MIA (9080, 9100): a proposta criada pela sessao nasce pendente, da propria pessoa, sem aprovacao, sem pedido, sem ajuste, sem resultado e com 30 dias para vencer. O risco vem do tipo (seguro: etapa_criar, resposta, etiqueta, tarefa, relatorio; atencao: o resto).';

revoke all on function public.fn_mia_proposta_nasce() from public;
revoke execute on function public.fn_mia_proposta_nasce() from anon, authenticated;

drop trigger if exists trg_mia_proposta_nasce on public.mia_assistente_propostas;
create trigger trg_mia_proposta_nasce
  before insert on public.mia_assistente_propostas
  for each row execute function public.fn_mia_proposta_nasce();

-- ── a ordem das situações, com o desfazer e o ajuste ────────────────────────
--
-- Vale para QUALQUER escrita, inclusive a do servidor:
--   pendente  -> pendente (o pedido e o ajuste), aprovada, rejeitada, expirada
--   aprovada  -> aplicada, rejeitada
--   aplicada  -> desfeita (com a data), ou fica aplicada (a saída com o agente)
--   rejeitada, expirada e desfeita não mudam mais
-- A peça (`pedido`, `chave`) só muda no ajuste: pendente que continua pendente.
-- A referência que some (a conversa expurgada, a pessoa removida) vira nulo pela
-- chave estrangeira em qualquer situação: isso não é decisão nova, e a 9080 a
-- recusava (o expurgo de uma conversa citada por proposta recusada parava).
create or replace function public.fn_mia_proposta_segue_a_ordem()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $f$
declare
  v_refs constant text[] := array[
    'conversa_id', 'criada_por', 'aprovada_por', 'aplicada_por', 'rejeitada_por',
    'desfeita_por', 'pedida_a', 'ajustada_por', 'updated_at'
  ];
begin
  if (to_jsonb(new) - v_refs) = (to_jsonb(old) - v_refs)
     and (new.conversa_id is null or new.conversa_id is not distinct from old.conversa_id)
     and (new.criada_por is null or new.criada_por is not distinct from old.criada_por)
     and (new.aprovada_por is null or new.aprovada_por is not distinct from old.aprovada_por)
     and (new.aplicada_por is null or new.aplicada_por is not distinct from old.aplicada_por)
     and (new.rejeitada_por is null or new.rejeitada_por is not distinct from old.rejeitada_por)
     and (new.desfeita_por is null or new.desfeita_por is not distinct from old.desfeita_por)
     and (new.pedida_a is null or new.pedida_a is not distinct from old.pedida_a)
     and (new.ajustada_por is null or new.ajustada_por is not distinct from old.ajustada_por) then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.tipo is distinct from old.tipo
     or new.created_at is distinct from old.created_at then
    raise exception 'proposta_imutavel'
      using errcode = '23514',
            detail = 'A empresa e a peça de uma proposta não mudam depois de criada: proponha de novo.';
  end if;

  if (new.pedido is distinct from old.pedido or new.chave is distinct from old.chave)
     and not (old.situacao = 'pendente' and new.situacao = 'pendente') then
    raise exception 'proposta_imutavel'
      using errcode = '23514',
            detail = 'A peça de uma proposta só muda no ajuste, antes de aprovar.';
  end if;

  if old.situacao in ('rejeitada', 'expirada', 'desfeita') then
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
    if new.situacao not in ('aplicada', 'desfeita')
       or new.resultado is distinct from old.resultado
       or new.aplicada_em is distinct from old.aplicada_em
       or new.aprovada_em is distinct from old.aprovada_em then
      raise exception 'proposta_ja_aplicada'
        using errcode = '23514',
              detail = 'A proposta já foi aplicada: ela só é desfeita, ou anotada a saída junto com o agente.';
    end if;
    if new.situacao = 'desfeita' and new.desfeita_em is null then
      raise exception 'proposta_desfeita_sem_data'
        using errcode = '23514',
              detail = 'Desfazer grava quando foi desfeita.';
    end if;
  end if;

  new.updated_at := now();
  return new;
end
$f$;

comment on function public.fn_mia_proposta_segue_a_ordem() is
  'MIA (9080, 9100): a ordem das situacoes da proposta (pendente -> aprovada -> aplicada -> desfeita, ou rejeitada / expirada). Recusa (23514) aplicar sem aprovar, desfazer o que nao foi aplicado, mudar a peca fora do ajuste da pendente e mexer em proposta decidida, para qualquer escrita. A referencia que some (conversa ou pessoa) vira nulo em qualquer situacao.';

revoke all on function public.fn_mia_proposta_segue_a_ordem() from public;
revoke execute on function public.fn_mia_proposta_segue_a_ordem() from anon, authenticated;

drop trigger if exists trg_mia_proposta_segue_a_ordem on public.mia_assistente_propostas;
create trigger trg_mia_proposta_segue_a_ordem
  before update on public.mia_assistente_propostas
  for each row execute function public.fn_mia_proposta_segue_a_ordem();

-- ── RLS: o atendente propõe e lê as suas ────────────────────────────────────
--
-- Gestor e administrador leem todas as propostas da empresa (os pedidos que
-- esperam por eles, o que o assistente fez). O atendente lê as que ELE fez: é
-- assim que o resultado do pedido volta para quem pediu. O somente leitura não
-- propõe. Aprovar, aplicar, pedir, ajustar, desfazer e rejeitar continuam do
-- servidor: a sessão não atualiza nem apaga.
drop policy if exists "mia_assistente_propostas_select" on public.mia_assistente_propostas;
drop policy if exists "mia_assistente_propostas_insert" on public.mia_assistente_propostas;
create policy "mia_assistente_propostas_select" on public.mia_assistente_propostas
  for select using (
    organization_id in (select public.fn_user_org_ids())
    and (
      public.fn_role_at_least(organization_id, 'manager')
      or (criada_por = auth.uid() and public.fn_role_at_least(organization_id, 'agent'))
    )
  );
create policy "mia_assistente_propostas_insert" on public.mia_assistente_propostas
  for insert with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
    and (conversa_id is null or exists (
      select 1 from public.mia_assistente_conversas c
       where c.id = conversa_id
         and c.organization_id = mia_assistente_propostas.organization_id
         and c.user_id = auth.uid()
    ))
  );

do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

-- ── a configuração da empresa: os tipos ligados e o "pode pedir" ────────────
alter table public.mia_assistente_config
  add column if not exists tipos_de_proposta text[],
  add column if not exists pode_pedir boolean not null default true;

comment on column public.mia_assistente_config.tipos_de_proposta is
  'MIA (9100): os tipos de proposta que o assistente prepara nesta empresa. null = todos. O MCP de plataforma grava (plataforma_configurar_assistente).';
comment on column public.mia_assistente_config.pode_pedir is
  'MIA (9100): quem nao aprova pode pedir a quem aprova, com o cartao pronto (decisao 5). false = o assistente so diz quem pode.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_config_tipos_de_proposta') then
    alter table public.mia_assistente_config
      add constraint mia_assistente_config_tipos_de_proposta
      check (tipos_de_proposta is null or tipos_de_proposta <@ array[
        'agente', 'funil', 'followup',
        'etapa_criar', 'etapa_renomear', 'resposta', 'etiqueta', 'tarefa',
        'rascunho_de_followup', 'conhecimento', 'relatorio', 'meta'
      ]::text[]);
  end if;
end $$;

notify pgrst, 'reload schema';
