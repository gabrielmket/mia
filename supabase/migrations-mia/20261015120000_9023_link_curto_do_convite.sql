-- manifest: O LINK CURTO DO CONVITE DE EQUIPE (`/c/<codigo>`, pedido do Gabriel em 15/10/2026: o link longo `/team/accept-invite/<token>` fica ilegivel no WhatsApp). Coluna NOVA nossa em `team_invites` (tabela do upstream, 0238): `codigo_curto_hash text`, o HMAC-SHA256 em hex (64 caracteres, segredo do servidor) do codigo de 12 caracteres que vai no endereco; o codigo cru NUNCA e gravado, e por isso "copiar o link de novo" gera um codigo novo, que substitui o anterior. Indice unico parcial `team_invites_mia_codigo_curto_hash_idx` (onde nao e nulo): a rota curta acha o convite pelo hash. Constraint `team_invites_mia_codigo_curto_hash_formato`: so 64 hex minusculos, e um codigo cru gravado por engano e recusado (23514). Gatilho nosso `trg_mia_link_curto_morre_com_o_convite` (funcao `fn_mia_link_curto_morre_com_o_convite`): convite REVOGADO (inclusive a revogacao em massa ao marcar a empresa como demonstracao, 9010) perde o hash na mesma escrita, e o link curto deixa de existir no banco; vencido nao precisa, a resolucao confere `expires_at`. ACEITO nao perde: o aceite do upstream e repetivel (o token longo vale ate `exp`, e `lib/auth/aplicar-convite.ts` so recusa convite revogado), e o link curto segue o longo; quem abre de novo depois de aceitar cai no mesmo aceite, e o replay nao muda nada. RLS e grants seguem os da 0238 (a coluna e legivel por gerente e administrador da empresa, como as outras; o valor e um HMAC que nao serve para nada fora do servidor). Nenhum objeto do upstream e redefinido: a tabela ganha coluna, indice, constraint e gatilho com nome nosso. Provado em tests/invariants/link-curto-do-convite.test.ts (com controle negativo).
--
-- 9023 · o link curto do convite de equipe
--
-- `mia`: só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: `if not
-- exists` na coluna e no índice, a constraint dentro de um `do` que confere o
-- catálogo, `create or replace` da função nossa e `drop trigger if exists`.
--
-- O código, o tamanho (12 de um alfabeto de 31, ~59 bits) e a conta que o fecha
-- estão em `lib/team/link-curto.ts`. Aqui mora só o que o banco garante.

alter table public.team_invites
  add column if not exists codigo_curto_hash text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'team_invites_mia_codigo_curto_hash_formato'
  ) then
    alter table public.team_invites
      add constraint team_invites_mia_codigo_curto_hash_formato
      check (codigo_curto_hash is null or codigo_curto_hash ~ '^[0-9a-f]{64}$');
  end if;
end $$;

comment on column public.team_invites.codigo_curto_hash is
  'MIA (9023): HMAC-SHA256 em hex do codigo do link curto do convite (/c/<codigo>), com o segredo do servidor. O codigo cru nunca e gravado. Nulo = convite sem link curto (antigo ou revogado). Aceito mantem o hash ate vencer, como o link longo segue valendo ate o exp. Trocado a cada reenvio e a cada "Copiar link do convite": o anterior deixa de valer.';

create unique index if not exists team_invites_mia_codigo_curto_hash_idx
  on public.team_invites (codigo_curto_hash)
  where codigo_curto_hash is not null;

-- O link curto morre com o convite REVOGADO: o hash sai na mesma escrita.
-- Inclusive quando quem revoga é a marca de demonstração (9010), que faz
-- `update ... set revoked_at = now()` em todos os pendentes da empresa.
--
-- O ACEITE não apaga, de propósito. O aceite do upstream é repetível: o token
-- longo vale até `exp` e `lib/auth/aplicar-convite.ts` só recusa convite
-- revogado (o fechamento usa `is("accepted_at", null)` para o replay não mexer
-- em nada). O link curto segue o longo: quem aceitou e abre de novo o link do
-- WhatsApp cai no mesmo aceite, e não em "peça um novo convite". O e2e do
-- upstream `tests/e2e/interface-por-vinculo.spec.ts` depende disso.
create or replace function public.fn_mia_link_curto_morre_com_o_convite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.revoked_at is not null then
    new.codigo_curto_hash := null;
  end if;
  return new;
end;
$$;

comment on function public.fn_mia_link_curto_morre_com_o_convite() is
  'MIA (9023): convite revogado perde o hash do link curto na mesma escrita (team_invites.codigo_curto_hash). Aceito nao perde (o aceite e repetivel, como o do link longo). Vencido nao precisa: a resolucao confere expires_at.';

revoke all on function public.fn_mia_link_curto_morre_com_o_convite() from public;
revoke execute on function public.fn_mia_link_curto_morre_com_o_convite() from anon, authenticated;

drop trigger if exists trg_mia_link_curto_morre_com_o_convite on public.team_invites;
create trigger trg_mia_link_curto_morre_com_o_convite
  before insert or update on public.team_invites
  for each row execute function public.fn_mia_link_curto_morre_com_o_convite();

notify pgrst, 'reload schema';
