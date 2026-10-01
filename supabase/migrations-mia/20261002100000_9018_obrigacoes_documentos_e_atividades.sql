-- 9018 · documentos e obrigações com vencimento
--
-- ── O que muda ──────────────────────────────────────────────────────────────
--
-- Tem cliente que precisa pedir ou avisar os PRÓPRIOS clientes de renovar
-- documentação (alvará, AVCB, licença sanitária, CNH, certificado digital) e de
-- cumprir o que se repete (relatório mensal, renovação anual do contrato,
-- revisão semestral). Até aqui isso morava numa planilha ao lado do sistema.
-- Passa a morar numa lista só, "Obrigações", com dois tipos: DOCUMENTO (o
-- cliente entrega, ou tem validade) e ATIVIDADE RECORRENTE (algo que se repete).
-- A regra inteira está em docs/fork/obrigacoes.md.
--
-- ── As cinco tabelas, e por que cinco ───────────────────────────────────────
--
--   mia_obrigacoes_tipos      o CATÁLOGO por organização e funil: o tipo traz
--                             validade, recorrência, avisos, quem entrega e a
--                             quem se liga. É só o ponto de partida: tudo é
--                             copiado para o item e editável nele.
--   mia_obrigacoes            o ITEM. Guarda as DATAS, nunca a situação: "a
--                             pedir", "vencendo", "vencido" são calculados pelas
--                             datas (lib/obrigacoes/situacao.ts), num lugar só,
--                             para a tela, o servidor, a automação e o MCP
--                             dizerem a mesma coisa. Uma coluna de situação
--                             envelheceria sozinha à meia-noite.
--   mia_obrigacoes_ciclos     o HISTÓRICO: ao receber a versão nova (ou marcar
--                             feita), o ciclo que terminou vem para cá com as
--                             datas e o arquivo dele, e o item segue com o novo.
--   mia_obrigacoes_propostas  o que o AGENTE DE IA propõe: "o cliente mandou um
--                             arquivo; é o alvará pedido?". Ele nunca marca
--                             recebido. Uma pessoa confirma ou diz que não é.
--   mia_obrigacoes_avisos     a TRAVA dos avisos: cada regra de automação
--                             dispara UMA vez por item, ciclo e data medida. A
--                             linha nasce na mesma transação do evento.
--
-- ── A quem o item se liga ───────────────────────────────────────────────────
--
-- A negócio, empresa e/ou contato: pelo menos um. O que é da EMPRESA aparece em
-- todos os negócios dela; o que é do CONTATO acompanha a pessoa; o que é do
-- NEGÓCIO fica só nele (a herança é leitura, em lib/obrigacoes/heranca.ts).
-- As três chaves são `on delete set null`: apagar o negócio não leva o alvará
-- que também é da empresa. O item que fica sem dono nenhum sai (gatilho), e o
-- arquivo dele vai para a fila de remoção do upstream (`storage_redaction_queue`).
--
-- ── As datas são DIAS ───────────────────────────────────────────────────────
--
-- `date`, e não `timestamptz`: validade de alvará é um dia do calendário, e o
-- "hoje" que decide a situação é o do fuso da empresa. Instante com fuso faria o
-- documento vencer um dia antes para quem está a oeste do servidor.
--
-- ── Quem vê e quem grava ────────────────────────────────────────────────────
--
-- Leitura: quem é da organização E enxerga o negócio ligado (a régua de
-- visibilidade de `crm_leads` vale por dentro da policy; contato e empresa são
-- vistos pela organização inteira). Escrita: `agent` em diante, com as travas do
-- suporte somente leitura plantadas por `fn_aplicar_travas_de_suporte` (a função
-- do upstream, chamada, nunca copiada). O catálogo é configuração: `manager`.
-- Os avisos só o servidor grava.
--
-- ── O arquivo ───────────────────────────────────────────────────────────────
--
-- Bucket PRIVADO `mia-obrigacoes`, sem policy: só o servidor lê e escreve, e a
-- tela recebe um link assinado de vida curta depois que a rota conferiu o papel
-- e leu o item pela RLS de quem pediu (o desenho do anexo de nota interna).
--
-- ── LGPD ────────────────────────────────────────────────────────────────────
--
-- Anonimizar o contato leva junto, na MESMA transação: os itens ligados a ele
-- saem inteiros; os dos negócios dele ficam sem arquivo e sem observação; e todo
-- arquivo vai para a fila de remoção. O relatório de acesso entrega as três
-- tabelas (lib/lgpd/export-collector.ts). Documento de saúde (atestado, laudo,
-- exame) é dado sensível e fica FORA dos modelos de tipo.
--
-- Nomes com prefixo `mia_`/`fn_mia_`/`trg_mia_`: nada do upstream é redefinido.
-- Provado em tests/invariants/obrigacoes.test.ts.

-- ── 1. o catálogo de tipos ──────────────────────────────────────────────────
create table if not exists public.mia_obrigacoes_tipos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Nulo = o tipo vale para a organização inteira, em qualquer funil.
  pipeline_id uuid references public.crm_pipelines(id) on delete cascade,
  nome text not null,
  nome_curto text,
  categoria text not null,
  quem_entrega text not null default 'cliente',
  recorrencia text not null default 'unica',
  recorrencia_meses integer,
  validade_meses integer not null default 0,
  avisos_dias integer[] not null default '{}'::integer[],
  dias_sem_resposta integer not null default 5,
  liga_a text not null default 'negocio',
  pede_arquivo boolean not null default true,
  -- De qual modelo de segmento o tipo veio (lib/obrigacoes/catalogo.ts). Nulo = criado à mão.
  segmento text,
  posicao integer not null default 0,
  arquivado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references auth.users(id) on delete set null,
  constraint mia_obrigacoes_tipos_nome check (length(btrim(nome)) between 1 and 120),
  constraint mia_obrigacoes_tipos_categoria check (categoria in ('documento', 'atividade')),
  constraint mia_obrigacoes_tipos_quem check (quem_entrega in ('cliente', 'nos')),
  constraint mia_obrigacoes_tipos_recorrencia check (recorrencia in ('unica', 'mensal', 'anual', 'n_meses')),
  constraint mia_obrigacoes_tipos_n_meses check (
    (recorrencia = 'n_meses' and recorrencia_meses between 1 and 240)
    or (recorrencia <> 'n_meses' and recorrencia_meses is null)
  ),
  constraint mia_obrigacoes_tipos_validade check (validade_meses between 0 and 600),
  constraint mia_obrigacoes_tipos_avisos check (
    coalesce(array_length(avisos_dias, 1), 0) <= 3
    and 0 < all (avisos_dias) and 3650 >= all (avisos_dias)
  ),
  constraint mia_obrigacoes_tipos_sem_resposta check (dias_sem_resposta between 1 and 365),
  constraint mia_obrigacoes_tipos_liga_a check (liga_a in ('negocio', 'empresa', 'contato'))
);

comment on table public.mia_obrigacoes_tipos is
  'MIA (9018): o catalogo de tipos de obrigacao por organizacao e funil (pipeline_id nulo = vale para todos os funis). O tipo e so o ponto de partida: validade, recorrencia, avisos e quem entrega sao copiados para o item e editaveis nele.';

-- Um nome por funil (e um por organização quando o tipo é de todos os funis).
create unique index if not exists uq_mia_obrigacoes_tipos_nome
  on public.mia_obrigacoes_tipos (
    organization_id,
    coalesce(pipeline_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(nome))
  )
  where arquivado_em is null;

-- ── 2. os itens ─────────────────────────────────────────────────────────────
create table if not exists public.mia_obrigacoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tipo_id uuid references public.mia_obrigacoes_tipos(id) on delete set null,
  nome text not null,
  nome_curto text,
  categoria text not null,
  lead_id uuid references public.crm_leads(id) on delete set null,
  empresa_id uuid references public.crm_empresas(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  quem_entrega text not null default 'cliente',
  recorrencia text not null default 'unica',
  recorrencia_meses integer,
  validade_meses integer not null default 0,
  avisos_dias integer[] not null default '{30,15,7}'::integer[],
  dias_sem_resposta integer not null default 5,
  -- documento
  pedido_em date,
  prazo_em date,
  cobrado_em date,
  recebido_em date,
  valido_ate date,
  renovado_em date,
  -- atividade recorrente
  proxima_em date,
  feita_em date,
  -- Sobe a cada renovação (documento recebido de novo) e a cada atividade feita.
  ciclo integer not null default 1,
  arquivo_path text,
  arquivo_nome text,
  arquivo_mime text,
  arquivo_bytes bigint,
  responsavel_user_id uuid references auth.users(id) on delete set null,
  observacao text,
  -- De onde o item veio: 'tela', 'mcp', 'demonstracao' ou 'importacao:<origem>'.
  origem text not null default 'tela',
  -- A chave de reexecução da importação: tipo + a quem está ligado.
  chave_natural text,
  -- Nenhum aviso com data de disparo anterior a este dia: é o que impede uma
  -- base migrada de planilha de disparar avisos atrasados no dia em que entra.
  sem_aviso_antes_de date not null default current_date,
  arquivado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  constraint mia_obrigacoes_nome check (length(btrim(nome)) between 1 and 120),
  constraint mia_obrigacoes_categoria check (categoria in ('documento', 'atividade')),
  constraint mia_obrigacoes_quem check (quem_entrega in ('cliente', 'nos')),
  constraint mia_obrigacoes_recorrencia check (recorrencia in ('unica', 'mensal', 'anual', 'n_meses')),
  constraint mia_obrigacoes_n_meses check (
    (recorrencia = 'n_meses' and recorrencia_meses between 1 and 240)
    or (recorrencia <> 'n_meses' and recorrencia_meses is null)
  ),
  constraint mia_obrigacoes_validade check (validade_meses between 0 and 600),
  constraint mia_obrigacoes_avisos check (
    coalesce(array_length(avisos_dias, 1), 0) <= 3
    and 0 < all (avisos_dias) and 3650 >= all (avisos_dias)
  ),
  constraint mia_obrigacoes_sem_resposta check (dias_sem_resposta between 1 and 365),
  constraint mia_obrigacoes_ciclo check (ciclo >= 1),
  -- Cada categoria só usa as datas dela: a função da situação lê por categoria,
  -- e uma data da outra ficaria guardada sem ninguém mostrar.
  constraint mia_obrigacoes_datas_da_categoria check (
    (categoria = 'documento' and proxima_em is null and feita_em is null)
    or (categoria = 'atividade' and pedido_em is null and prazo_em is null and cobrado_em is null
        and recebido_em is null and valido_ate is null and renovado_em is null and arquivo_path is null)
  ),
  constraint mia_obrigacoes_arquivo_no_espaco_da_empresa check (
    arquivo_path is null or split_part(arquivo_path, '/', 1) = organization_id::text
  )
);

comment on table public.mia_obrigacoes is
  'MIA (9018): documentos e atividades recorrentes com vencimento, ligados a negocio, empresa e/ou contato. A SITUACAO NAO E COLUNA: e calculada pelas datas em lib/obrigacoes/situacao.ts. Datas sao dias do calendario (date), lidos no fuso da empresa.';
comment on column public.mia_obrigacoes.ciclo is
  'MIA (9018): o ciclo em vigor. Sobe quando o documento e recebido de novo (renovacao) e quando a atividade e marcada feita; o ciclo que terminou vai para mia_obrigacoes_ciclos.';
comment on column public.mia_obrigacoes.sem_aviso_antes_de is
  'MIA (9018): nenhum gatilho de automacao dispara para este item com data de disparo anterior a este dia. Nasce com o dia da criacao: item migrado de planilha nao dispara aviso atrasado.';

create index if not exists idx_mia_obrigacoes_org on public.mia_obrigacoes (organization_id) where arquivado_em is null;
create index if not exists idx_mia_obrigacoes_lead on public.mia_obrigacoes (lead_id) where lead_id is not null;
create index if not exists idx_mia_obrigacoes_empresa on public.mia_obrigacoes (empresa_id) where empresa_id is not null;
create index if not exists idx_mia_obrigacoes_contato on public.mia_obrigacoes (contact_id) where contact_id is not null;
create index if not exists idx_mia_obrigacoes_valido_ate on public.mia_obrigacoes (organization_id, valido_ate) where valido_ate is not null and arquivado_em is null;
create index if not exists idx_mia_obrigacoes_proxima_em on public.mia_obrigacoes (organization_id, proxima_em) where proxima_em is not null and arquivado_em is null;
create index if not exists idx_mia_obrigacoes_pedido_em on public.mia_obrigacoes (organization_id, pedido_em) where pedido_em is not null and arquivado_em is null;
create unique index if not exists uq_mia_obrigacoes_chave_natural
  on public.mia_obrigacoes (organization_id, chave_natural)
  where chave_natural is not null and arquivado_em is null;

-- ── 3. o histórico dos ciclos ───────────────────────────────────────────────
create table if not exists public.mia_obrigacoes_ciclos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  obrigacao_id uuid not null references public.mia_obrigacoes(id) on delete cascade,
  ciclo integer not null,
  -- Como o ciclo terminou: 'recebido' (chegou a versão nova) ou 'feita'.
  como text not null,
  pedido_em date,
  recebido_em date,
  valido_ate date,
  proxima_em date,
  feita_em date,
  arquivo_path text,
  arquivo_nome text,
  arquivo_mime text,
  arquivo_bytes bigint,
  encerrado_em timestamptz not null default now(),
  encerrado_por_user_id uuid references auth.users(id) on delete set null,
  constraint mia_obrigacoes_ciclos_como check (como in ('recebido', 'feita')),
  constraint mia_obrigacoes_ciclos_um_por_ciclo unique (obrigacao_id, ciclo)
);

comment on table public.mia_obrigacoes_ciclos is
  'MIA (9018): o historico de um item. Cada linha e um ciclo que terminou (documento renovado, atividade feita), com as datas e o arquivo daquele ciclo.';

create index if not exists idx_mia_obrigacoes_ciclos_org on public.mia_obrigacoes_ciclos (organization_id);

-- ── 4. a proposta do agente de IA ───────────────────────────────────────────
create table if not exists public.mia_obrigacoes_propostas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  obrigacao_id uuid not null references public.mia_obrigacoes(id) on delete cascade,
  ciclo integer not null,
  -- Quem mandou o arquivo. Some junto com a pessoa na anonimização.
  contact_id uuid references public.contacts(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  -- A mensagem que trouxe o arquivo. O arquivo continua NA CONVERSA: só é
  -- copiado para a área das obrigações quando uma pessoa confirma.
  message_id uuid references public.messages(id) on delete set null,
  arquivo_nome text,
  arquivo_mime text,
  situacao text not null default 'pendente',
  proposta_por_agente_id uuid,
  decidida_em timestamptz,
  decidida_por_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint mia_obrigacoes_propostas_situacao check (situacao in ('pendente', 'confirmada', 'recusada', 'superada'))
);

comment on table public.mia_obrigacoes_propostas is
  'MIA (9018): o agente de IA PROPOE que um arquivo recebido na conversa e o documento pedido; uma pessoa confirma ou recusa. O agente nunca marca recebido. Enquanto ha proposta pendente, o gatilho "documento nao enviado" fica segurado.';

-- Uma proposta pendente por item: a mais nova substitui a anterior.
create unique index if not exists uq_mia_obrigacoes_propostas_pendente
  on public.mia_obrigacoes_propostas (obrigacao_id)
  where situacao = 'pendente';
create index if not exists idx_mia_obrigacoes_propostas_org on public.mia_obrigacoes_propostas (organization_id, situacao);
create index if not exists idx_mia_obrigacoes_propostas_contato on public.mia_obrigacoes_propostas (contact_id) where contact_id is not null;

-- ── 5. a trava dos avisos ───────────────────────────────────────────────────
create table if not exists public.mia_obrigacoes_avisos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  obrigacao_id uuid not null references public.mia_obrigacoes(id) on delete cascade,
  regra_id uuid not null references public.automation_rules(id) on delete cascade,
  gatilho text not null,
  ciclo integer not null,
  -- A data MEDIDA: o "válido até", o "pedido em", a próxima data ou o dia do
  -- recebimento. Corrigir a data rearma o aviso; a mesma data avisa uma vez.
  ancora date not null,
  -- "Documento não enviado" com arquivo do cliente esperando confirmação: a
  -- linha nasce segurada, sem evento, e é solta quando a proposta é decidida.
  segurado boolean not null default false,
  event_id uuid references public.event_log(id) on delete set null,
  disparado_em timestamptz,
  created_at timestamptz not null default now(),
  constraint mia_obrigacoes_avisos_gatilho check (gatilho ~ '^obrigacao\.[a-z_]+$'),
  constraint mia_obrigacoes_avisos_uma_vez unique (obrigacao_id, regra_id, gatilho, ciclo, ancora)
);

comment on table public.mia_obrigacoes_avisos is
  'MIA (9018): a trava de "uma vez por item e ciclo" dos cinco gatilhos de obrigacao. A linha nasce na MESMA transacao do evento (fn_mia_obrigacao_disparar). So o servidor grava.';

create index if not exists idx_mia_obrigacoes_avisos_org on public.mia_obrigacoes_avisos (organization_id);
create index if not exists idx_mia_obrigacoes_avisos_segurados on public.mia_obrigacoes_avisos (organization_id) where segurado;

-- ── 6. quem vê e quem grava ─────────────────────────────────────────────────
alter table public.mia_obrigacoes_tipos enable row level security;
alter table public.mia_obrigacoes enable row level security;
alter table public.mia_obrigacoes_ciclos enable row level security;
alter table public.mia_obrigacoes_propostas enable row level security;
alter table public.mia_obrigacoes_avisos enable row level security;

revoke all on table public.mia_obrigacoes_tipos from anon, authenticated;
revoke all on table public.mia_obrigacoes from anon, authenticated;
revoke all on table public.mia_obrigacoes_ciclos from anon, authenticated;
revoke all on table public.mia_obrigacoes_propostas from anon, authenticated;
revoke all on table public.mia_obrigacoes_avisos from anon, authenticated;

grant select, insert, update, delete on table public.mia_obrigacoes_tipos to authenticated;
grant select, insert, update, delete on table public.mia_obrigacoes to authenticated;
grant select, insert, update, delete on table public.mia_obrigacoes_ciclos to authenticated;
grant select, insert, update, delete on table public.mia_obrigacoes_propostas to authenticated;
-- Os avisos só o servidor grava: a sessão lê, para o histórico do item.
grant select on table public.mia_obrigacoes_avisos to authenticated;

grant all on table public.mia_obrigacoes_tipos to service_role;
grant all on table public.mia_obrigacoes to service_role;
grant all on table public.mia_obrigacoes_ciclos to service_role;
grant all on table public.mia_obrigacoes_propostas to service_role;
grant all on table public.mia_obrigacoes_avisos to service_role;

drop policy if exists "mia_obrigacoes_tipos_select" on public.mia_obrigacoes_tipos;
drop policy if exists "mia_obrigacoes_tipos_escrita" on public.mia_obrigacoes_tipos;
create policy "mia_obrigacoes_tipos_select" on public.mia_obrigacoes_tipos
  for select using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()))
  );
-- O catálogo é configuração do funil: gerente em diante.
create policy "mia_obrigacoes_tipos_escrita" on public.mia_obrigacoes_tipos
  for all using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  ) with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists "mia_obrigacoes_select" on public.mia_obrigacoes;
drop policy if exists "mia_obrigacoes_insert" on public.mia_obrigacoes;
drop policy if exists "mia_obrigacoes_update" on public.mia_obrigacoes;
drop policy if exists "mia_obrigacoes_delete" on public.mia_obrigacoes;
-- O `exists` em `crm_leads` roda com a RLS de quem pergunta: o item de um
-- negócio que a pessoa não enxerga também não aparece para ela.
create policy "mia_obrigacoes_select" on public.mia_obrigacoes
  for select using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and (lead_id is null
             or exists (select 1 from public.crm_leads l where l.id = mia_obrigacoes.lead_id)))
  );
create policy "mia_obrigacoes_insert" on public.mia_obrigacoes
  for insert with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and (lead_id is null
             or exists (select 1 from public.crm_leads l where l.id = mia_obrigacoes.lead_id)))
  );
create policy "mia_obrigacoes_update" on public.mia_obrigacoes
  for update using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and (lead_id is null
             or exists (select 1 from public.crm_leads l where l.id = mia_obrigacoes.lead_id)))
  ) with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  );
create policy "mia_obrigacoes_delete" on public.mia_obrigacoes
  for delete using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and (lead_id is null
             or exists (select 1 from public.crm_leads l where l.id = mia_obrigacoes.lead_id)))
  );

-- Ciclos e propostas seguem o item: quem vê o item vê o histórico dele.
drop policy if exists "mia_obrigacoes_ciclos_select" on public.mia_obrigacoes_ciclos;
drop policy if exists "mia_obrigacoes_ciclos_escrita" on public.mia_obrigacoes_ciclos;
create policy "mia_obrigacoes_ciclos_select" on public.mia_obrigacoes_ciclos
  for select using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and exists (select 1 from public.mia_obrigacoes o where o.id = mia_obrigacoes_ciclos.obrigacao_id))
  );
create policy "mia_obrigacoes_ciclos_escrita" on public.mia_obrigacoes_ciclos
  for all using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and exists (select 1 from public.mia_obrigacoes o where o.id = mia_obrigacoes_ciclos.obrigacao_id))
  ) with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and exists (select 1 from public.mia_obrigacoes o
                     where o.id = mia_obrigacoes_ciclos.obrigacao_id
                       and o.organization_id = mia_obrigacoes_ciclos.organization_id))
  );

drop policy if exists "mia_obrigacoes_propostas_select" on public.mia_obrigacoes_propostas;
drop policy if exists "mia_obrigacoes_propostas_escrita" on public.mia_obrigacoes_propostas;
create policy "mia_obrigacoes_propostas_select" on public.mia_obrigacoes_propostas
  for select using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and exists (select 1 from public.mia_obrigacoes o where o.id = mia_obrigacoes_propostas.obrigacao_id))
  );
create policy "mia_obrigacoes_propostas_escrita" on public.mia_obrigacoes_propostas
  for all using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and exists (select 1 from public.mia_obrigacoes o where o.id = mia_obrigacoes_propostas.obrigacao_id))
  ) with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and exists (select 1 from public.mia_obrigacoes o
                     where o.id = mia_obrigacoes_propostas.obrigacao_id
                       and o.organization_id = mia_obrigacoes_propostas.organization_id))
  );

drop policy if exists "mia_obrigacoes_avisos_select" on public.mia_obrigacoes_avisos;
create policy "mia_obrigacoes_avisos_select" on public.mia_obrigacoes_avisos
  for select using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and exists (select 1 from public.mia_obrigacoes o where o.id = mia_obrigacoes_avisos.obrigacao_id))
  );

-- ── 7. a área de arquivo privada ────────────────────────────────────────────
--
-- Sem policy em `storage.objects`, como `internal-media` e `whatsapp-media`: só
-- o servidor (service_role) lê e grava; a tela recebe link assinado. 25 MB: é
-- documento digitalizado, não vídeo.
insert into storage.buckets (id, name, public, file_size_limit)
values ('mia-obrigacoes', 'mia-obrigacoes', false, 26214400)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- ── 8. o item precisa de dono, e o item sem dono sai ────────────────────────
create or replace function public.fn_mia_obrigacao_exige_dono()
returns trigger
language plpgsql
set search_path = public
as $f$
begin
  if new.lead_id is null and new.empresa_id is null and new.contact_id is null then
    raise exception 'mia_obrigacao_sem_dono: ligue o item a um negocio, a uma empresa ou a um contato'
      using errcode = '23514';
  end if;
  return new;
end
$f$;

comment on function public.fn_mia_obrigacao_exige_dono() is
  'MIA (9018): o item de obrigacao nasce ligado a pelo menos um de negocio, empresa ou contato. E gatilho de INSERT, e nao CHECK: as tres chaves sao on delete set null, e um CHECK impediria apagar o negocio de um item que so tem ele.';

revoke all on function public.fn_mia_obrigacao_exige_dono() from public;
revoke execute on function public.fn_mia_obrigacao_exige_dono() from anon, authenticated;

drop trigger if exists trg_mia_obrigacao_exige_dono on public.mia_obrigacoes;
create trigger trg_mia_obrigacao_exige_dono
  before insert on public.mia_obrigacoes
  for each row execute function public.fn_mia_obrigacao_exige_dono();

create or replace function public.fn_mia_obrigacao_sem_dono_sai()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  if new.lead_id is null and new.empresa_id is null and new.contact_id is null then
    delete from public.mia_obrigacoes where id = new.id;
  end if;
  return null;
end
$f$;

comment on function public.fn_mia_obrigacao_sem_dono_sai() is
  'MIA (9018): quando o ultimo dono de um item some (negocio, empresa ou contato apagado: as chaves sao on delete set null), o item sai junto. O gatilho de DELETE enfileira o arquivo dele para remocao.';

revoke all on function public.fn_mia_obrigacao_sem_dono_sai() from public;
revoke execute on function public.fn_mia_obrigacao_sem_dono_sai() from anon, authenticated;

drop trigger if exists trg_mia_obrigacao_sem_dono_sai on public.mia_obrigacoes;
create trigger trg_mia_obrigacao_sem_dono_sai
  after update of lead_id, empresa_id, contact_id on public.mia_obrigacoes
  for each row execute function public.fn_mia_obrigacao_sem_dono_sai();

-- ── 9. arquivo que ninguém mais aponta vai para a fila de remoção ───────────
--
-- A fila é a do upstream (`storage_redaction_queue`), que já sabe tirar de
-- qualquer bucket. Três momentos: o item sai; o arquivo do item é trocado sem
-- ir para o histórico; o histórico perde o arquivo.
create or replace function public.fn_mia_obrigacao_arquivo_orfao()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_saindo boolean := (tg_op = 'DELETE');
  v_caminhos text[];
begin
  -- Organização sendo apagada: a fila referencia a organização, e ela já não
  -- existe a esta altura da cascata. Os arquivos saem com o espaço dela.
  if not exists (select 1 from public.organizations g where g.id = old.organization_id) then
    return old;
  end if;

  if v_saindo then
    -- Só a tabela dos itens tem gatilho de DELETE: o arquivo do ciclo em vigor
    -- e os do histórico, que a cascata vai levar junto.
    select array_agg(x.caminho) into v_caminhos
      from (
        select old.arquivo_path as caminho
        union
        select c.arquivo_path from public.mia_obrigacoes_ciclos c where c.obrigacao_id = old.id
      ) x
     where x.caminho is not null;
  else
    v_caminhos := array[old.arquivo_path];
  end if;

  if v_caminhos is null then
    return old;
  end if;

  insert into public.storage_redaction_queue (organization_id, bucket, object_path)
  select old.organization_id, 'mia-obrigacoes', x.caminho
    from unnest(v_caminhos) as x(caminho)
   where x.caminho is not null
     -- O arquivo que foi para o histórico, ou que outro item aponta, segue em uso.
     and not exists (
       select 1 from public.mia_obrigacoes_ciclos c
        where c.arquivo_path = x.caminho
          and not (v_saindo and c.obrigacao_id = old.id)
     )
     and not exists (
       select 1 from public.mia_obrigacoes o
        where o.arquivo_path = x.caminho
          and not (v_saindo and o.id = old.id)
     )
  on conflict (bucket, object_path) do update
    set status = 'pending',
        attempts = 0,
        enqueued_at = now(),
        processed_at = null,
        error_message = null
    where storage_redaction_queue.status in ('deleted', 'skipped');

  return old;
end
$f$;

comment on function public.fn_mia_obrigacao_arquivo_orfao() is
  'MIA (9018): o arquivo de uma obrigacao que nada mais aponta (item apagado, arquivo trocado sem ir ao historico, historico sem arquivo) entra em storage_redaction_queue com o bucket mia-obrigacoes. Sem isto o arquivo ficaria no bucket sem ninguem capaz de acha-lo.';

revoke all on function public.fn_mia_obrigacao_arquivo_orfao() from public;
revoke execute on function public.fn_mia_obrigacao_arquivo_orfao() from anon, authenticated;

drop trigger if exists trg_mia_obrigacao_arquivo_orfao_item on public.mia_obrigacoes;
create trigger trg_mia_obrigacao_arquivo_orfao_item
  before delete on public.mia_obrigacoes
  for each row execute function public.fn_mia_obrigacao_arquivo_orfao();

drop trigger if exists trg_mia_obrigacao_arquivo_trocado on public.mia_obrigacoes;
create trigger trg_mia_obrigacao_arquivo_trocado
  after update of arquivo_path on public.mia_obrigacoes
  for each row
  when (old.arquivo_path is not null and old.arquivo_path is distinct from new.arquivo_path)
  execute function public.fn_mia_obrigacao_arquivo_orfao();

drop trigger if exists trg_mia_obrigacao_arquivo_do_ciclo on public.mia_obrigacoes_ciclos;
create trigger trg_mia_obrigacao_arquivo_do_ciclo
  after update of arquivo_path on public.mia_obrigacoes_ciclos
  for each row
  when (old.arquivo_path is not null and old.arquivo_path is distinct from new.arquivo_path)
  execute function public.fn_mia_obrigacao_arquivo_orfao();

-- ── 10. fechar o ciclo: receber a versão nova, marcar feita ─────────────────
--
-- Numa transação só: o ciclo que termina vai para o histórico e o item segue
-- com as datas novas. A CONTA da próxima data (somar meses, o fim do mês) é do
-- TypeScript (lib/obrigacoes/ciclo.ts), no mesmo módulo que a tela usa para
-- mostrar a prévia; aqui só se grava o que ele calculou.
--
-- `security invoker`: roda com a RLS de quem chama. Não é definer, e por isso
-- não dá a ninguém o que a policy não dá.
create or replace function public.fn_mia_obrigacao_fechar_ciclo(
  p_obrigacao uuid,
  p_ciclo_esperado integer,
  p_como text,
  p_dia date,
  p_valido_ate date default null,
  p_proxima_em date default null,
  p_arquivo jsonb default null,
  p_ator uuid default null,
  p_proposta uuid default null
) returns integer
language plpgsql
security invoker
set search_path = public
as $f$
declare
  v public.mia_obrigacoes%rowtype;
  v_tinha boolean;
  v_ciclo integer;
begin
  select * into v from public.mia_obrigacoes where id = p_obrigacao for update;
  if not found then
    raise exception 'mia_obrigacao_nao_encontrada' using errcode = 'P0002';
  end if;
  -- Duas pessoas confirmando o mesmo recebimento: a segunda encontra o ciclo
  -- já fechado e é recusada, em vez de fechar o ciclo seguinte sem querer.
  if v.ciclo <> p_ciclo_esperado then
    raise exception 'mia_obrigacao_mudou: o item ja esta no ciclo %', v.ciclo using errcode = '40001';
  end if;
  if p_dia is null then
    raise exception 'mia_obrigacao_sem_dia' using errcode = '22004';
  end if;

  if p_como = 'recebido' then
    if v.categoria <> 'documento' then
      raise exception 'mia_obrigacao_categoria: so documento e recebido' using errcode = '22023';
    end if;
    v_tinha := v.recebido_em is not null or v.valido_ate is not null;
    if v_tinha then
      insert into public.mia_obrigacoes_ciclos
        (organization_id, obrigacao_id, ciclo, como, pedido_em, recebido_em, valido_ate,
         arquivo_path, arquivo_nome, arquivo_mime, arquivo_bytes, encerrado_por_user_id)
      values
        (v.organization_id, v.id, v.ciclo, 'recebido', v.pedido_em, v.recebido_em, v.valido_ate,
         v.arquivo_path, v.arquivo_nome, v.arquivo_mime, v.arquivo_bytes, p_ator);
    end if;
    v_ciclo := v.ciclo + case when v_tinha then 1 else 0 end;
    update public.mia_obrigacoes
       set recebido_em = p_dia,
           valido_ate = p_valido_ate,
           pedido_em = null,
           prazo_em = null,
           cobrado_em = null,
           renovado_em = case when v_tinha then p_dia else null end,
           arquivo_path = p_arquivo->>'path',
           arquivo_nome = p_arquivo->>'nome',
           arquivo_mime = p_arquivo->>'mime',
           arquivo_bytes = nullif(p_arquivo->>'bytes', '')::bigint,
           ciclo = v_ciclo,
           updated_at = now(),
           updated_by_user_id = p_ator
     where id = v.id;
    -- A proposta que levou a este recebimento é a confirmada; outra pendente
    -- do mesmo item deixou de fazer sentido.
    update public.mia_obrigacoes_propostas
       set situacao = case when id = p_proposta then 'confirmada' else 'superada' end,
           decidida_em = now(),
           decidida_por_user_id = p_ator
     where obrigacao_id = v.id and situacao = 'pendente';
  elsif p_como = 'feita' then
    if v.categoria <> 'atividade' then
      raise exception 'mia_obrigacao_categoria: so atividade e marcada feita' using errcode = '22023';
    end if;
    insert into public.mia_obrigacoes_ciclos
      (organization_id, obrigacao_id, ciclo, como, proxima_em, feita_em, encerrado_por_user_id)
    values
      (v.organization_id, v.id, v.ciclo, 'feita', v.proxima_em, p_dia, p_ator);
    v_ciclo := v.ciclo + 1;
    update public.mia_obrigacoes
       set feita_em = p_dia,
           proxima_em = p_proxima_em,
           ciclo = v_ciclo,
           updated_at = now(),
           updated_by_user_id = p_ator
     where id = v.id;
  else
    raise exception 'mia_obrigacao_como: use recebido ou feita' using errcode = '22023';
  end if;

  return v_ciclo;
end
$f$;

comment on function public.fn_mia_obrigacao_fechar_ciclo(uuid, integer, text, date, date, date, jsonb, uuid, uuid) is
  'MIA (9018): fecha o ciclo de uma obrigacao numa transacao: o ciclo que termina vai para mia_obrigacoes_ciclos e o item segue com as datas novas. SECURITY INVOKER: vale a RLS de quem chama. Recusa (40001) quando o item ja mudou de ciclo.';

revoke all on function public.fn_mia_obrigacao_fechar_ciclo(uuid, integer, text, date, date, date, jsonb, uuid, uuid) from public;
revoke execute on function public.fn_mia_obrigacao_fechar_ciclo(uuid, integer, text, date, date, date, jsonb, uuid, uuid) from anon;
grant execute on function public.fn_mia_obrigacao_fechar_ciclo(uuid, integer, text, date, date, date, jsonb, uuid, uuid) to authenticated, service_role;

-- ── 11. disparar um aviso: a trava e o evento na mesma transação ────────────
--
-- Devolve o id do evento, ou nulo quando a regra já disparou para este item,
-- ciclo e data (ou quando o aviso nasceu segurado). Só o servidor chama: quem
-- decide o dia é a varredura (app/api/v1/cron/obrigacoes-avisos).
create or replace function public.fn_mia_obrigacao_disparar(
  p_organization_id uuid,
  p_obrigacao uuid,
  p_regra uuid,
  p_gatilho text,
  p_ciclo integer,
  p_ancora date,
  p_payload jsonb default '{}'::jsonb,
  p_segurar boolean default false
) returns uuid
language plpgsql
security invoker
set search_path = public
as $f$
declare
  v_aviso uuid;
  v_evento uuid;
  v_segurado boolean;
begin
  insert into public.mia_obrigacoes_avisos
    (organization_id, obrigacao_id, regra_id, gatilho, ciclo, ancora, segurado)
  values
    (p_organization_id, p_obrigacao, p_regra, p_gatilho, p_ciclo, p_ancora, p_segurar)
  on conflict (obrigacao_id, regra_id, gatilho, ciclo, ancora) do nothing
  returning id into v_aviso;

  if v_aviso is null then
    -- Já existe. Só há o que fazer se ele estava SEGURADO e agora pode sair.
    if p_segurar then
      return null;
    end if;
    select a.id, a.segurado into v_aviso, v_segurado
      from public.mia_obrigacoes_avisos a
     where a.obrigacao_id = p_obrigacao and a.regra_id = p_regra and a.gatilho = p_gatilho
       and a.ciclo = p_ciclo and a.ancora = p_ancora
       for update;
    if not coalesce(v_segurado, false) then
      return null;
    end if;
  elsif p_segurar then
    return null;
  end if;

  v_evento := public.emit_event(
    p_gatilho,
    'mia_obrigacao',
    p_obrigacao,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('rule_id', p_regra),
    jsonb_build_object('actor_kind', 'system', 'source', 'obrigacoes'),
    p_organization_id
  );

  update public.mia_obrigacoes_avisos
     set segurado = false, event_id = v_evento, disparado_em = now()
   where id = v_aviso;

  return v_evento;
end
$f$;

comment on function public.fn_mia_obrigacao_disparar(uuid, uuid, uuid, text, integer, date, jsonb, boolean) is
  'MIA (9018): emite o evento de um gatilho de obrigacao UMA vez por regra, item, ciclo e data medida: a linha da trava e o evento nascem na mesma transacao. Com p_segurar, a trava nasce sem evento e e solta na proxima chamada sem p_segurar. So o servidor chama.';

revoke all on function public.fn_mia_obrigacao_disparar(uuid, uuid, uuid, text, integer, date, jsonb, boolean) from public;
revoke execute on function public.fn_mia_obrigacao_disparar(uuid, uuid, uuid, text, integer, date, jsonb, boolean) from anon, authenticated;
grant execute on function public.fn_mia_obrigacao_disparar(uuid, uuid, uuid, text, integer, date, jsonb, boolean) to service_role;

-- ── 12. LGPD: anonimizar o contato leva os itens e os arquivos ──────────────
create or replace function public.fn_mia_obrigacoes_do_contato_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  -- Os arquivos primeiro: os dos itens ligados a pessoa e os dos negocios dela,
  -- do ciclo em vigor e do historico.
  insert into public.storage_redaction_queue (organization_id, bucket, object_path)
  select new.organization_id, 'mia-obrigacoes', x.caminho
    from (
      select o.arquivo_path as caminho
        from public.mia_obrigacoes o
       where o.organization_id = new.organization_id
         and (o.contact_id = new.id
              or o.lead_id in (select l.id from public.crm_leads l where l.contact_id = new.id))
      union
      select c.arquivo_path
        from public.mia_obrigacoes_ciclos c
        join public.mia_obrigacoes o on o.id = c.obrigacao_id
       where o.organization_id = new.organization_id
         and (o.contact_id = new.id
              or o.lead_id in (select l.id from public.crm_leads l where l.contact_id = new.id))
    ) x
   where x.caminho is not null
  on conflict (bucket, object_path) do update
    set status = 'pending',
        attempts = 0,
        enqueued_at = now(),
        processed_at = null,
        error_message = null
    where storage_redaction_queue.status in ('deleted', 'skipped');

  -- O que a pessoa mandou para o agente conferir.
  delete from public.mia_obrigacoes_propostas
   where organization_id = new.organization_id and contact_id = new.id;

  -- O que e DA PESSOA sai inteiro, com o historico (cascata).
  delete from public.mia_obrigacoes
   where organization_id = new.organization_id and contact_id = new.id;

  -- O que e dos NEGOCIOS dela fica como registro do negocio, sem arquivo e sem
  -- texto livre: o tipo e as datas nao identificam ninguem.
  update public.mia_obrigacoes_ciclos
     set arquivo_path = null, arquivo_nome = null, arquivo_mime = null, arquivo_bytes = null
   where organization_id = new.organization_id
     and obrigacao_id in (
       select o.id from public.mia_obrigacoes o
        where o.lead_id in (select l.id from public.crm_leads l where l.contact_id = new.id)
     );
  update public.mia_obrigacoes
     set arquivo_path = null, arquivo_nome = null, arquivo_mime = null, arquivo_bytes = null,
         observacao = null, updated_at = now()
   where organization_id = new.organization_id
     and lead_id in (select l.id from public.crm_leads l where l.contact_id = new.id);

  return new;
end
$f$;

comment on function public.fn_mia_obrigacoes_do_contato_anonimizado() is
  'MIA (9018): anonimizar o contato leva as obrigacoes dele. Os itens ligados a pessoa saem inteiros (com historico e propostas); os dos negocios dela ficam sem arquivo e sem observacao; todo arquivo vai para storage_redaction_queue com o bucket mia-obrigacoes. Na mesma transacao da anonimizacao.';

revoke all on function public.fn_mia_obrigacoes_do_contato_anonimizado() from public;
revoke execute on function public.fn_mia_obrigacoes_do_contato_anonimizado() from anon, authenticated;

drop trigger if exists trg_mia_obrigacoes_do_contato_anonimizado on public.contacts;
create trigger trg_mia_obrigacoes_do_contato_anonimizado
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized is true and old.is_anonymized is distinct from true)
  execute function public.fn_mia_obrigacoes_do_contato_anonimizado();

-- ── 13. fusão: os itens seguem a ficha que ficou ────────────────────────────
create or replace function public.fn_mia_obrigacoes_seguem_o_contato_mesclado()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  update public.mia_obrigacoes
     set contact_id = new.is_merged_into, updated_at = now()
   where organization_id = new.organization_id and contact_id = new.id;
  update public.mia_obrigacoes_propostas
     set contact_id = new.is_merged_into
   where organization_id = new.organization_id and contact_id = new.id;
  return new;
end
$f$;

comment on function public.fn_mia_obrigacoes_seguem_o_contato_mesclado() is
  'MIA (9018): contato mesclado em outro (is_merged_into): as obrigacoes e as propostas dele passam para a ficha que ficou, em vez de ficarem presas na lapide.';

revoke all on function public.fn_mia_obrigacoes_seguem_o_contato_mesclado() from public;
revoke execute on function public.fn_mia_obrigacoes_seguem_o_contato_mesclado() from anon, authenticated;

drop trigger if exists trg_mia_obrigacoes_seguem_o_contato_mesclado on public.contacts;
create trigger trg_mia_obrigacoes_seguem_o_contato_mesclado
  after update of is_merged_into on public.contacts
  for each row
  when (new.is_merged_into is not null and new.is_merged_into is distinct from old.is_merged_into)
  execute function public.fn_mia_obrigacoes_seguem_o_contato_mesclado();

create or replace function public.fn_mia_obrigacoes_seguem_a_empresa_mesclada()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  update public.mia_obrigacoes
     set empresa_id = new.mesclada_com, updated_at = now()
   where organization_id = new.organization_id and empresa_id = new.id;
  return new;
end
$f$;

comment on function public.fn_mia_obrigacoes_seguem_a_empresa_mesclada() is
  'MIA (9018): empresa mesclada em outra (mesclada_com, 0263): as obrigacoes dela passam para a empresa que ficou.';

revoke all on function public.fn_mia_obrigacoes_seguem_a_empresa_mesclada() from public;
revoke execute on function public.fn_mia_obrigacoes_seguem_a_empresa_mesclada() from anon, authenticated;

drop trigger if exists trg_mia_obrigacoes_seguem_a_empresa_mesclada on public.crm_empresas;
create trigger trg_mia_obrigacoes_seguem_a_empresa_mesclada
  after update of mesclada_com on public.crm_empresas
  for each row
  when (new.mesclada_com is not null and new.mesclada_com is distinct from old.mesclada_com)
  execute function public.fn_mia_obrigacoes_seguem_a_empresa_mesclada();

-- ── 14. as travas do suporte somente leitura alcançam as tabelas novas ──────
--
-- A função é do upstream e é CHAMADA, não copiada (docs/FORK-MIA.md, regra 3):
-- as quatro tabelas que a sessão grava ganham as três restritivas; a dos avisos,
-- que só o servidor grava, fica sem nenhuma.
do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

notify pgrst, 'reload schema';
