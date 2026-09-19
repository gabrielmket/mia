-- 0268 — o carimbo do schema: "este banco recebeu qual baseline?"
--
-- ── O buraco ──────────────────────────────────────────────────────────────
--
-- `easypanel/bootstrap.sh` aplica o baseline a cada implantação. Num banco NOVO
-- ele usa `ON_ERROR_STOP` e o app não sobe se falhar — ali a garantia existe.
-- Num banco EXISTENTE, que é TODO deploy depois do primeiro, ele roda assim:
--
--     psql ... -f "$BASELINE" > /tmp/baseline.log 2>&1 || true
--
-- filtra os erros benignos ("already exists", que são esperados e certos), e se
-- sobrar erro inesperado escreve `AVISO: ... (o app sobe mesmo assim)`.
--
-- A escolha é defensável: derrubar o produto porque uma migration nova tropeçou
-- seria pior que subir com o schema de ontem. O problema é o que vem depois —
-- NÃO HAVIA COMO SABER que foi isso que aconteceu. O único registro é o stdout
-- de um contêiner efêmero, e a agregação de logs da VPS está desligada (E4).
--
-- Resultado prático: `/api/v1/health` dizia `"status":"healthy"` com a versão
-- nova do código e o banco de ontem, e as duas afirmações eram verdadeiras.
-- Quem implanta ficava sem a única pergunta que importa depois de um deploy com
-- migration: "o banco veio junto?"
--
-- ── Como o carimbo responde ───────────────────────────────────────────────
--
-- O baseline grava aqui, perto do fim, a migration mais nova que ele contém. A
-- imagem carrega a mesma string em `lib/schema/carimbo.ts`. A saúde compara:
-- iguais = mesma entrega dos dois lados; diferentes = o baseline não passou, ou
-- a imagem é outra. Nos dois casos há alguém para chamar.
--
-- ── Por que uma TABELA, e não uma função ou um comentário de schema ───────
--
-- Tem de sobreviver a `create or replace` de qualquer coisa e ser legível por
-- uma linha de SQL na rota de saúde. `aplicado_em` entra porque "está em dia"
-- e "está em dia desde quando" são perguntas diferentes: a segunda é a que
-- responde se o deploy de agora foi o que carimbou, ou se o carimbo é de três
-- deploys atrás e o baseline vem falhando em silêncio desde então.
--
-- Singleton `id = 1` pelo mesmo desenho de `platform_branding`: é estado da
-- INSTALAÇÃO, não de tenant. RLS ligada e ZERO policies — a rota de saúde lê
-- pelo `service_role`, e o carimbo não é assunto de cliente nenhum.

create table if not exists public.schema_baseline (
  id smallint primary key default 1,
  -- O NOME do arquivo, sem extensão: `20260920030000_0268_carimbo_do_schema`.
  -- Nome e não só o timestamp porque quem lê a saúde de madrugada quer saber o
  -- QUE entrou, e "0268_carimbo_do_schema" responde; "20260920030000" não.
  migration_mais_nova text not null,
  aplicado_em timestamptz not null default now(),
  constraint schema_baseline_singleton check (id = 1),
  constraint schema_baseline_nao_vazia check (length(btrim(migration_mais_nova)) > 0)
);

comment on table public.schema_baseline is
  'Qual baseline este banco recebeu. Gravada pelo proprio baseline perto do fim; comparada em /api/v1/health com a constante compilada na imagem (lib/schema/carimbo.ts). Existe porque o bootstrap aplica o baseline com || true num banco existente: o schema pode falhar e o app sobe igual, saudavel, com o banco de ontem.';

comment on column public.schema_baseline.aplicado_em is
  'Quando o carimbo foi gravado. "Em dia" e "em dia desde quando" sao perguntas diferentes: esta responde se o deploy de agora carimbou, ou se o carimbo e de tres deploys atras e o baseline vem falhando calado.';

alter table public.schema_baseline enable row level security;

-- Sem policies de propósito: ninguém lê isto por sessão. A rota de saúde usa o
-- `service_role`, que é `bypassrls`.
revoke all on table public.schema_baseline from anon, authenticated;
grant select, insert, update on table public.schema_baseline to service_role;

-- O carimbo desta migration. O BASELINE tem o bloco equivalente perto do fim, e
-- é aquele que vale no dia a dia — este aqui serve ao banco que aplica as
-- migrations uma a uma.
insert into public.schema_baseline (id, migration_mais_nova, aplicado_em)
values (1, '20260920030000_0268_carimbo_do_schema', now())
on conflict (id) do update
  set migration_mais_nova = excluded.migration_mais_nova,
      aplicado_em = now();

notify pgrst, 'reload schema';
