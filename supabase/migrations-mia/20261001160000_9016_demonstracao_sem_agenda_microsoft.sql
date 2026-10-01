-- 9016 · a trava da empresa de demonstração alcança a agenda do Outlook
--
-- ── O buraco que esta migration fecha ───────────────────────────────────────
--
-- A 9010 fechou a "agenda externa" da empresa de demonstração em
-- `calendar_connections`, porque o Google manda convite por e-mail aos
-- participantes. Na mesma versão, a 9011 trouxe a agenda do Outlook com uma
-- tabela NOSSA de conexões, `mia_agenda_microsoft_conexoes`, que a trava da 9010
-- não conhece (ela é uma lista por nome de tabela, e tabela que ela não conhece
-- passa). Sem esta migration, a empresa de demonstração conectaria uma conta
-- Microsoft e a publicação (9014) criaria o evento no Outlook com o e-mail do
-- contato como participante: a Microsoft manda o convite, e o Teams (9015)
-- nasce junto. Seria a primeira coisa a sair da demonstração.
--
-- ── A regra ─────────────────────────────────────────────────────────────────
--
-- Na empresa de demonstração, conta Microsoft só existe DESCONECTADA. É o mesmo
-- desenho do número de WhatsApp (só sessão arquivada): `disconnected` é o estado
-- sem token, que nenhuma rotina lê, sincroniza ou publica. Sem conexão viva não
-- há publicação, não há evento com participante, não há reunião do Teams e não
-- há link para a máquina de entrega mandar.
--
--   · `trg_mia_demonstracao_sem_agenda_microsoft` recusa (42501,
--     `organizacao_de_demonstracao:`) a conexão que nasce ou volta a ficar viva;
--   · `trg_mia_marca_de_demonstracao_agenda_microsoft` recusa marcar como
--     demonstração a empresa que ainda tem conta Microsoft viva, com a mesma
--     frase da 9010 ("ainda tem destino vivo (...): desligue antes de marcar").
--
-- ── Por que ao lado, e não dentro das funções da 9010 ───────────────────────
--
-- `fn_mia_trava_da_demonstracao` e `fn_mia_marca_de_demonstracao` são nossas e
-- poderiam ser reescritas, mas reescrever as duas inteiras para acrescentar uma
-- tabela é copiar cem linhas que a próxima mudança da trava teria de lembrar de
-- manter em dois lugares. Gatilho próprio, pendurado ao lado, com a MESMA
-- mensagem e o MESMO código: `lib/demonstracao/trava.ts` traduz as duas igual.
-- A consequência aceita: quem marca uma empresa com número vivo E conta
-- Microsoft viva recebe a lista da 9010 primeiro e a do Outlook depois.
--
-- Nomes com prefixo `fn_mia_`/`trg_mia_`: nada do upstream é redefinido.
-- Provado em tests/invariants/empresa-de-demonstracao-nao-envia.test.ts.

-- ── 1. a porta: conta Microsoft viva não nasce nem revive na demonstração ───
create or replace function public.fn_mia_demonstracao_sem_agenda_microsoft()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  -- A condição barata primeiro: desconectada pode existir (é o estado sem token).
  if new.status = 'disconnected' then
    return new;
  end if;

  if not public.fn_mia_e_demonstracao(new.organization_id) then
    return new;
  end if;

  raise exception 'organizacao_de_demonstracao: agenda do Outlook conectada nao existe numa empresa de demonstracao'
    using errcode = '42501',
          hint = 'Esta e a empresa de demonstracao da plataforma: nada sai dela (docs/fork/cliente-modelo.md).';
end
$f$;

comment on function public.fn_mia_demonstracao_sem_agenda_microsoft() is
  'MIA (9016): a trava da empresa de demonstracao (9010) na agenda do Outlook. Recusa (42501, organizacao_de_demonstracao:) a conta Microsoft que nasce ou volta a ficar viva numa empresa de demonstracao; so a desconectada (sem token) pode existir. Sem conexao viva nao ha publicacao no Outlook, convite por e-mail ao participante, reuniao do Teams nem link para entregar.';

revoke all on function public.fn_mia_demonstracao_sem_agenda_microsoft() from public;
revoke execute on function public.fn_mia_demonstracao_sem_agenda_microsoft() from anon, authenticated;

drop trigger if exists trg_mia_demonstracao_sem_agenda_microsoft on public.mia_agenda_microsoft_conexoes;
create trigger trg_mia_demonstracao_sem_agenda_microsoft
  before insert or update of organization_id, status on public.mia_agenda_microsoft_conexoes
  for each row execute function public.fn_mia_demonstracao_sem_agenda_microsoft();

-- ── 2. a marca: empresa com conta Microsoft viva não vira demonstração ──────
create or replace function public.fn_mia_marca_de_demonstracao_agenda_microsoft()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  if exists (select 1 from public.mia_agenda_microsoft_conexoes m
              where m.organization_id = new.id and m.status <> 'disconnected') then
    raise exception 'organizacao_de_demonstracao: a empresa ainda tem destino vivo (%): desligue antes de marcar',
      'agenda do Outlook conectada'
      using errcode = '42501';
  end if;
  return new;
end
$f$;

comment on function public.fn_mia_marca_de_demonstracao_agenda_microsoft() is
  'MIA (9016): marcar como demonstracao a empresa que ainda tem conta Microsoft viva (agenda do Outlook) e recusado, com a mesma frase da 9010. Pendurada ao lado de fn_mia_marca_de_demonstracao, que nao e reescrita.';

revoke all on function public.fn_mia_marca_de_demonstracao_agenda_microsoft() from public;
revoke execute on function public.fn_mia_marca_de_demonstracao_agenda_microsoft() from anon, authenticated;

drop trigger if exists trg_mia_marca_de_demonstracao_agenda_microsoft on public.organizations;
create trigger trg_mia_marca_de_demonstracao_agenda_microsoft
  before update of demonstracao on public.organizations
  for each row
  when (new.demonstracao and not old.demonstracao)
  execute function public.fn_mia_marca_de_demonstracao_agenda_microsoft();
