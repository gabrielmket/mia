-- 0271 — o token que administra a PLATAFORMA (item E6, primeira metade)
--
-- ── Por que uma tabela própria, e não um escopo em `api_tokens` ───────────
--
-- `api_tokens.organization_id` é `not null`: todo token existente pertence a UM
-- cliente, e é isso que limita o estrago quando um vaza. Um token de plataforma
-- não pertence a cliente nenhum — encaixá-lo ali exigiria afrouxar a coluna,
-- e aí a garantia "todo token é de alguém" deixaria de valer para TODOS.
--
-- Separar também separa a revogação: matar os tokens de plataforma não pode
-- exigir varrer a tabela em que moram os tokens dos clientes.
--
-- ── O raio, que é o assunto real desta tabela ─────────────────────────────
--
-- Um token de cliente que vaza erra dentro de um cliente. Um de plataforma erra
-- em TODOS — e mora num arquivo de configuração que qualquer sessão carrega.
--
-- Por isso `operacoes` é uma LISTA BRANCA e começa VAZIA. Leitura é livre
-- (`plataforma_listar_*` responde sem escopo nenhum); escrita é NOMEADA, uma
-- por uma. Um token para implantar cliente carrega `criar_cliente` e
-- `liberar_modulo` e não tem como lançar crédito; um token de suporte não
-- carrega nenhuma e só lê.
--
-- "Acesso total" seria uma coluna `pode_tudo boolean` — e seria o valor que
-- todo mundo marca no primeiro token, porque é mais rápido que pensar. A
-- ausência dela é a feature.
--
-- ── O que NÃO está aqui ───────────────────────────────────────────────────
--
-- MFA. O admin de plataforma pela TELA exige AAL2 (`platform_admins.
-- mfa_required`), e um token não tem como apresentar segundo fator. É a troca
-- consciente de todo token de API, e o que a compensa é o escopo curto, o
-- `expires_at` e a auditoria — não um campo a mais aqui.

create table if not exists public.platform_api_tokens (
  id uuid primary key default gen_random_uuid(),
  -- Como quem criou reconhece o token na lista. Sem ele, revogar vira loteria.
  name text not null,
  -- Os 8 primeiros caracteres, para a tela poder mostrar QUAL token sem
  -- guardar nada que sirva para autenticar.
  prefix text not null,
  -- SHA-256 do plaintext, como `api_tokens`. O plaintext existe uma vez, na
  -- resposta da criação, e nunca é gravado.
  token_hash bytea not null,

  -- ⚠️ A LISTA BRANCA. Vazia = só leitura, e é o default de propósito: o token
  -- criado sem pensar não escreve nada.
  operacoes text[] not null default '{}'::text[],

  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  -- Motivo por escrito, como em `platform_admins.reason`: quem concede acesso
  -- de plataforma explica por quê, e quem audita seis meses depois lê.
  reason text not null,

  last_used_at timestamptz,
  last_used_ip inet,
  expires_at timestamptz,

  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoke_reason text,

  constraint platform_api_tokens_nome_nao_vazio check (length(btrim(name)) > 0),
  constraint platform_api_tokens_motivo_nao_vazio check (length(btrim(reason)) > 0),
  -- Revogar é um ato com autor e motivo: os três andam juntos ou nenhum existe.
  constraint platform_api_tokens_revogacao_completa check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or (revoked_at is not null and revoked_by is not null)
  )
);

comment on table public.platform_api_tokens is
  'Token de administracao da PLATAFORMA (MCP admin, item E6). Tabela propria e nao um escopo em api_tokens porque aquela tem organization_id NOT NULL — e e essa coluna que garante que todo token pertence a UM cliente. `operacoes` e lista branca e comeca VAZIA: leitura e livre, escrita e nomeada uma a uma. Nao existe coluna "pode tudo", e a ausencia dela e a feature.';

comment on column public.platform_api_tokens.operacoes is
  'Lista branca das escritas permitidas (ex.: criar_cliente, liberar_modulo, lancar_credito). VAZIA = so leitura. O catalogo de operacoes vive no codigo (lib/mcp-plataforma/), nao aqui: o que uma operacao faz muda junto com o codigo que a executa, e uma tabela de catalogo envelheceria em silencio.';

-- A busca do token é sempre por hash exato, e é o caminho quente de toda
-- chamada MCP.
create unique index if not exists uniq_platform_api_tokens_hash
  on public.platform_api_tokens (token_hash);

-- RLS ligada e ZERO policies: esta tabela é server-side only, lida e escrita
-- pelo `service_role` (que é `bypassrls`). Uma policy aqui seria uma porta a
-- mais para uma tabela cujo conteúdo autentica quem administra tudo.
alter table public.platform_api_tokens enable row level security;
revoke all on table public.platform_api_tokens from anon, authenticated;
grant select, insert, update on table public.platform_api_tokens to service_role;

insert into public.schema_baseline (id, migration_mais_nova, aplicado_em)
values (1, '20260920090000_0271_token_de_plataforma', now())
on conflict (id) do update
  set migration_mais_nova = excluded.migration_mais_nova,
      aplicado_em = now();

notify pgrst, 'reload schema';
