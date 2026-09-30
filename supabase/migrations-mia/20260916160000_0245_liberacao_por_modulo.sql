-- 0245 — cada cliente com o que comprou
--
-- O sistema passou a ter peça VENDÁVEL SEPARADA (o disparador é a primeira), e
-- até aqui "quem tem acesso a quê" só existia em duas réguas: papel dentro da
-- organização e admin de plataforma. Nenhuma das duas responde "esta empresa
-- contratou este módulo" — e sem a resposta, ligar um módulo para um cliente
-- significa ligá-lo para todos.
--
-- ── Ausência de linha = NÃO contratado, e só para módulo DECLARADO ──────────
--
-- A tentação é gravar uma linha por módulo por organização no dia da criação, e
-- ela envelhece mal: módulo novo nasce invisível para todo cliente antigo, e
-- alguém tem de lembrar de um backfill a cada lançamento.
--
-- Aqui o catálogo dos módulos vive no CÓDIGO (`lib/modulos/catalogo.ts`) e só o
-- que o cliente COMPROU vira linha. O que a tabela responde é uma pergunta só:
-- "existe liberação viva deste módulo para esta organização?". Tudo que o
-- catálogo não declara continua valendo para todo mundo, como hoje — esta
-- migration não tira NADA de ninguém.
--
-- ── Por que `revoked_at` e não `delete` ─────────────────────────────────────
--
-- Cancelamento é fato comercial: quem cancelou, quando, e por quê. Apagar a
-- linha responde "nunca teve", que é outra história — e é a história errada na
-- conversa em que alguém pergunta por que a tela sumiu.

create table if not exists public.organization_modules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  -- A chave do catálogo em `lib/modulos/catalogo.ts`. Texto livre de propósito:
  -- um CHECK com a lista obrigaria uma migration a cada módulo novo, e a lista
  -- de verdade (com rótulo, descrição e o que cada um destrava) já mora no
  -- código, onde ela é lida.
  modulo           text not null,
  granted_at       timestamptz not null default now(),
  granted_by       uuid references auth.users(id) on delete set null,
  -- Cancelamento. Linha com `revoked_at` preenchido NÃO libera nada, e continua
  -- contando a história: quem liberou, quando, quem cancelou, quando.
  revoked_at       timestamptz,
  revoked_by       uuid references auth.users(id) on delete set null,
  note             text,
  created_at       timestamptz not null default now()
);

comment on table public.organization_modules is
  'Modulos VENDAVEIS que cada organizacao contratou. Ausencia de linha (ou linha revogada) = nao contratado. O catalogo dos modulos vive no codigo (lib/modulos/catalogo.ts); o que o catalogo nao declara continua liberado para todos, como sempre foi.';

comment on column public.organization_modules.revoked_at is
  'Cancelamento. Preenchido = nao libera mais. A linha FICA, porque apagar responderia "nunca teve", que e outra historia - e a errada na conversa em que alguem pergunta por que a tela sumiu.';

-- Uma liberação VIVA por módulo por organização. Revogadas podem se repetir
-- (contratou, cancelou, contratou de novo é histórico legítimo), e por isso o
-- índice é parcial.
create unique index if not exists uq_organization_modules_vivo
  on public.organization_modules (organization_id, modulo)
  where revoked_at is null;

create index if not exists idx_organization_modules_org
  on public.organization_modules (organization_id, modulo, revoked_at);

alter table public.organization_modules enable row level security;

-- A organização LÊ o que ela contratou (a tela precisa saber o que mostrar);
-- quem libera e cancela é a plataforma, e só ela.
drop policy if exists organization_modules_select on public.organization_modules;
create policy organization_modules_select on public.organization_modules
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()))
  );

revoke all on public.organization_modules from anon;
grant select on public.organization_modules to authenticated;
grant select, insert, update on public.organization_modules to service_role;
-- Sem `delete`: revogar é `update` em `revoked_at`, e o histórico fica.
