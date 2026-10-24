-- manifest: O DISPARO DE E-MAIL MARKETING, PARTE 2 (.89): o CONSENTIMENTO. O aceite vigente mora numa chave NOVA do jsonb do upstream, `contacts.consent.email_marketing` ({granted_at, source, version, evidence, measurement, registered_by, registered_by_kind, declined_at}), escrita pelo codigo e zerada pela anonimizacao do upstream (que ja zera `consent` inteiro). Ao lado, duas tabelas nossas: `mia_email_textos_de_consentimento` (as versoes do texto aceito, por empresa, com a marca de aviso de medicao e de rascunho juridico) e `mia_email_consentimentos` (o REGISTRO de cada aceite e de cada recusa: data, origem, versao e texto aceito, evidencia, quem registrou e por qual porta: a ficha, a importacao, a pagina de preferencias ou a plataforma). O registro e a prova da base legal e entra no acesso do titular; a anonimizacao (9064) apaga origem, evidencia e texto e solta o contato. Leitura por atendente para cima (quem registra o aceite na ficha), escrita so pelo servidor. Nenhum objeto do upstream e tocado.
--
-- 9061 · o consentimento de e-mail marketing
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente.

-- ── 1. as versões do texto aceito ──────────────────────────────────────────
--
-- O texto aceito é o que dá sentido ao aceite: "quero receber novidades" e
-- "quero receber novidades, e a empresa mede aberturas" são consentimentos
-- diferentes (a abertura só é medida no segundo). Sem linha, vale o texto padrão
-- do código, marcado como rascunho para revisão jurídica.
create table if not exists public.mia_email_textos_de_consentimento (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  versao text not null,
  texto text not null,
  inclui_aviso_de_medicao boolean not null default true,
  rascunho_juridico boolean not null default false,
  vigente_desde timestamptz not null default now(),
  arquivado_em timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint mia_email_textos_de_consentimento_versao check (versao ~ '^[A-Za-z0-9._-]{1,30}$'),
  constraint mia_email_textos_de_consentimento_texto check (length(btrim(texto)) between 10 and 2000),
  constraint mia_email_textos_de_consentimento_unica unique (organization_id, versao)
);

comment on table public.mia_email_textos_de_consentimento is
  'MIA (9061): as versoes do texto de consentimento de e-mail marketing da empresa. inclui_aviso_de_medicao = o texto avisa que aberturas e cliques sao medidos (sem isso, o pixel de abertura nao entra). Sem linha vale o padrao do codigo (lib/email-marketing/textos-padrao.ts), um rascunho para revisao juridica. Escrita so pelo servidor.';

-- ── 2. o registro de cada aceite e de cada recusa ──────────────────────────
create table if not exists public.mia_email_consentimentos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  -- O mesmo cálculo da supressão (SHA-256 do endereço em minúsculas): o registro
  -- continua casando com o endereço depois que o contato é anonimizado.
  email_hash text not null,
  tipo text not null,
  -- QUANDO a pessoa aceitou ou recusou, não quando a linha foi gravada.
  ocorrido_em timestamptz not null,
  origem text,
  versao_do_texto text,
  texto_aceito text,
  aceitou_medicao boolean not null default false,
  evidencia text,
  registrado_por uuid references auth.users(id) on delete set null,
  registrado_pelo text not null,
  created_at timestamptz not null default now(),
  constraint mia_email_consentimentos_tipo check (tipo in ('aceite', 'recusa')),
  constraint mia_email_consentimentos_porta check (
    registrado_pelo in ('ficha', 'importacao', 'pagina_de_preferencias', 'plataforma')
  )
);

create index if not exists idx_mia_email_consentimentos_contato
  on public.mia_email_consentimentos (organization_id, contact_id, created_at desc);
create index if not exists idx_mia_email_consentimentos_hash
  on public.mia_email_consentimentos (organization_id, email_hash);

comment on table public.mia_email_consentimentos is
  'MIA (9061): o REGISTRO de cada aceite e recusa de e-mail marketing (data, origem, versao e texto aceito, evidencia, quem registrou e por qual porta). E a prova da base legal de consentimento e entra no acesso do titular. O vigente mora em contacts.consent.email_marketing. Anonimizar (9064) apaga origem, evidencia e texto e solta o contato. Escrita so pelo servidor.';

-- ── 3. RLS: atendente para cima lê (é quem registra na ficha); só o servidor escreve
alter table public.mia_email_textos_de_consentimento enable row level security;
alter table public.mia_email_consentimentos enable row level security;

drop policy if exists mia_email_textos_de_consentimento_select on public.mia_email_textos_de_consentimento;
create policy mia_email_textos_de_consentimento_select on public.mia_email_textos_de_consentimento
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  );

drop policy if exists mia_email_consentimentos_select on public.mia_email_consentimentos;
create policy mia_email_consentimentos_select on public.mia_email_consentimentos
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  );

revoke all on public.mia_email_textos_de_consentimento from anon, authenticated;
revoke all on public.mia_email_consentimentos from anon, authenticated;
grant select on public.mia_email_textos_de_consentimento to authenticated;
grant select on public.mia_email_consentimentos to authenticated;
grant all on public.mia_email_textos_de_consentimento to service_role;
grant all on public.mia_email_consentimentos to service_role;
