-- manifest: A LISTA DE MELHORIAS DO PRODUTO (.93, o lado da Time em /admin/assistente; protótipo aprovado em 26/10/2026, tela 6, decisão 13). Uma tabela NOSSA da PLATAFORMA, sem organização: `mia_melhorias_do_produto`, o que a Time anota a partir de onde os clientes travam (um tema muito perguntado sem trilha, o passo com a maior queda, uma pergunta sem resposta, uma proposta muito desfeita), com a evidência em números e a situação (anotada, em desenvolvimento, no ar). O título é a chave natural (sem diferença de maiúscula nem de espaço nas pontas): anotar de novo atualiza em vez de duplicar. A evidência é número juntado, nunca nome de cliente nem texto de conversa. Ninguém lê nem grava pela sessão (nem anon, nem authenticated): a tela da Time e o MCP de plataforma (`plataforma_anotar_melhoria_do_produto`) passam pelo servidor, depois de conferir o administrador da plataforma ou o token. Nenhum objeto do upstream é tocado. Provado em tests/invariants/trilhas-do-assistente.test.ts.
--
-- 9091 · a lista de melhorias do produto
--
-- `mia`: só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente.

create table if not exists public.mia_melhorias_do_produto (
  id              uuid primary key default gen_random_uuid(),
  titulo          text not null,
  -- Os números que a sustentam ("Ligar o primeiro número, passo 4: 38 pontos de queda em 30 dias").
  evidencia       text,
  -- De onde veio: tema, trilha, sem_resposta, proposta ou manual.
  origem          text not null default 'manual',
  -- anotada, em_desenvolvimento ou no_ar.
  situacao        text not null default 'anotada',
  anotada_por     uuid references auth.users(id) on delete set null,
  atualizada_por  uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.mia_melhorias_do_produto is
  'MIA (9091): a lista de melhorias do produto que a Time anota a partir de onde os clientes travam (/admin/assistente e o MCP de plataforma). Titulo e a chave natural; evidencia e numero juntado, nunca nome de cliente nem texto de conversa. Da plataforma, sem organizacao: so o servidor le e grava.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_melhorias_do_produto_titulo') then
    alter table public.mia_melhorias_do_produto
      add constraint mia_melhorias_do_produto_titulo check (length(btrim(titulo)) between 3 and 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_melhorias_do_produto_evidencia') then
    alter table public.mia_melhorias_do_produto
      add constraint mia_melhorias_do_produto_evidencia check (evidencia is null or length(evidencia) <= 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_melhorias_do_produto_origem') then
    alter table public.mia_melhorias_do_produto
      add constraint mia_melhorias_do_produto_origem
      check (origem in ('tema', 'trilha', 'sem_resposta', 'proposta', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_melhorias_do_produto_situacao') then
    alter table public.mia_melhorias_do_produto
      add constraint mia_melhorias_do_produto_situacao
      check (situacao in ('anotada', 'em_desenvolvimento', 'no_ar'));
  end if;
end $$;

-- O título é a chave: anotar de novo atualiza.
create unique index if not exists mia_melhorias_do_produto_titulo_idx
  on public.mia_melhorias_do_produto (lower(btrim(titulo)));
create index if not exists mia_melhorias_do_produto_recentes_idx
  on public.mia_melhorias_do_produto (created_at desc);

alter table public.mia_melhorias_do_produto enable row level security;

-- Só o servidor: a tela da Time e o MCP conferem quem pede antes de gravar.
revoke all on table public.mia_melhorias_do_produto from public, anon, authenticated;
grant all on table public.mia_melhorias_do_produto to service_role;

notify pgrst, 'reload schema';
