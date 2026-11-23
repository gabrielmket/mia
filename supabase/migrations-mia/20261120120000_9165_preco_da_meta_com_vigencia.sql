-- manifest: O PREÇO DA META GANHA VIGÊNCIA (MIA-99; docs/fork/consumo-de-ia.md, seção 9). FORK MIA: `platform_precos_meta` (0259) guarda só o preço ATUAL de cada categoria, e a aba Uso e o custo da Meta multiplicavam as mensagens do mês pedido por ele: mudar o preço em novembro mudava o custo de outubro, um mês já fechado. Tabela NOSSA nova, `mia_precos_meta_vigencias`: cada preço com `vigente_desde` e `vigente_ate` (aberto, nulo, no preço atual; uma vigência aberta por categoria, `uq_mia_precos_meta_vigencias_aberta`). Quem a mantém é um gatilho em `platform_precos_meta` (`trg_mia_precos_meta_vigencia`, função `fn_mia_preco_da_meta_abre_vigencia`, `security invoker`): todo insert, update ou delete ali fecha a vigência aberta em `now()` e abre a nova, na mesma transação, seja quem for que grave (a tela, o MCP, o código de antes desta migration). Preço igual ao vigente não abre vigência. O PRIMEIRO preço de uma categoria vale desde sempre (`-infinity`): não há histórico para reconstruir. Pelo mesmo motivo, o preço que existe hoje vira a primeira vigência, desde sempre, e o custo do passado continua como estava. Nenhuma coluna existente muda: `platform_precos_meta` continua sendo o preço atual e a leitura antiga segue funcionando. Plataforma, zero policies, só o `service_role`. Nenhum objeto do upstream é tocado. Idempotente.
--
-- 9165 · o preço da Meta ganha vigência, e o mês fechado não muda
--
-- FORK MIA (MIA-99, defeito 4 da seção 2.1 do mapa da MIA-54). Só objetos
-- NOSSOS (docs/FORK-MIA.md, regra 3): uma tabela nova com o prefixo `mia_`,
-- uma função com nome nosso e um gatilho na `platform_precos_meta`, que também
-- é nossa (0259).
--
-- ── Por que um gatilho, e não a rota fechando a vigência ─────────────────────
--
-- Quem grava preço é quem tem de fechar a vigência. Escrito na rota, valeria
-- para a rota: o MCP, um `update` à mão e a imagem de antes desta migration
-- (num rollback de imagem o banco fica) continuariam sobrescrevendo, e o
-- histórico teria buracos que ninguém vê. Pendurado no FATO (a linha de
-- `platform_precos_meta` mudou), vale para todos, e na mesma transação: não
-- existe o instante em que a vigência velha fechou e a nova não abriu.
--
-- ── Por que `-infinity` no primeiro preço ────────────────────────────────────
--
-- O preço de hoje é o único que se conhece. Fazê-lo valer só a partir desta
-- migration deixaria todo o passado "sem preço" (a tela diria "preço não
-- informado" para outubro), que é mentira de outro tipo. A regra vale também
-- para a categoria que ganha preço pela primeira vez depois daqui: o primeiro
-- número dela cobre o passado, e só o SEGUNDO em diante tem início no dia em
-- que foi gravado.

create table if not exists public.mia_precos_meta_vigencias (
  id uuid primary key default gen_random_uuid(),
  categoria text not null,
  -- Centavos de REAL, como `platform_precos_meta.centavos_brl`.
  centavos_brl integer not null,
  -- `-infinity` = desde sempre (o primeiro preço da categoria).
  vigente_desde timestamptz not null,
  -- Nulo = é o preço atual.
  vigente_ate timestamptz,
  criado_em timestamptz not null default now(),
  -- Quem gravou o preço (`platform_precos_meta.atualizado_por`), um admin da plataforma.
  criado_por uuid,
  constraint mia_precos_meta_vigencias_centavos_check check (centavos_brl >= 0),
  constraint mia_precos_meta_vigencias_intervalo_check
    check (vigente_ate is null or vigente_ate > vigente_desde)
);

comment on table public.mia_precos_meta_vigencias is
  'MIA (9165): o historico do preco de cada categoria de mensagem da Meta, em centavos de REAL. Uma mensagem custa o preco cuja vigencia contem o instante dela (vigente_desde <= created_at < vigente_ate). vigente_ate nulo = o preco atual (um por categoria); vigente_desde = -infinity = desde sempre (o primeiro preco da categoria). Mantida pelo gatilho trg_mia_precos_meta_vigencia em platform_precos_meta: nao escreva aqui direto.';

-- Uma vigência aberta por categoria: é a trava contra dois "preços atuais".
create unique index if not exists uq_mia_precos_meta_vigencias_aberta
  on public.mia_precos_meta_vigencias (categoria)
  where vigente_ate is null;

-- A pergunta é sempre "que preço valia nesta categoria neste instante".
create index if not exists idx_mia_precos_meta_vigencias_categoria
  on public.mia_precos_meta_vigencias (categoria, vigente_desde);

-- `security invoker`: quem grava preço é o servidor (service_role), que tem as
-- permissões nas duas tabelas. A função não faz nada que quem grava não possa.
create or replace function public.fn_mia_preco_da_meta_abre_vigencia()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_agora timestamptz := now();
  v_aberta_id uuid;
  v_aberta_centavos integer;
  v_aberta_criada timestamptz;
  v_tem_historico boolean;
begin
  -- "Aberta nesta mesma transação" se lê em `criado_em`, que é o `now()` da
  -- transação que a abriu: igual ao nosso, foi esta. Não em `vigente_desde`:
  -- o primeiro preço da categoria tem `-infinity` ali.
  --
  -- A categoria que deixou de ter preço (apagada, ou renomeada num update):
  -- a vigência aberta dela fecha agora. A que abriu nesta mesma transação nunca
  -- valeu para mensagem nenhuma e sai.
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.categoria is distinct from new.categoria) then
    delete from public.mia_precos_meta_vigencias
     where categoria = old.categoria and vigente_ate is null and criado_em = v_agora;
    update public.mia_precos_meta_vigencias
       set vigente_ate = v_agora
     where categoria = old.categoria and vigente_ate is null;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;

  select v.id, v.centavos_brl, v.criado_em
    into v_aberta_id, v_aberta_centavos, v_aberta_criada
    from public.mia_precos_meta_vigencias v
   where v.categoria = new.categoria and v.vigente_ate is null
   for update;

  -- O mesmo preço gravado de novo (a tela manda a tabela inteira): nada muda.
  if v_aberta_id is not null and v_aberta_centavos = new.centavos_brl then
    return new;
  end if;

  -- Aberta nesta mesma transação: corrige o valor em vez de abrir uma vigência
  -- de duração zero.
  if v_aberta_id is not null and v_aberta_criada = v_agora then
    update public.mia_precos_meta_vigencias
       set centavos_brl = new.centavos_brl, criado_por = new.atualizado_por
     where id = v_aberta_id;
    return new;
  end if;

  select exists (
    select 1 from public.mia_precos_meta_vigencias v where v.categoria = new.categoria
  ) into v_tem_historico;

  if v_aberta_id is not null then
    update public.mia_precos_meta_vigencias set vigente_ate = v_agora where id = v_aberta_id;
  end if;

  insert into public.mia_precos_meta_vigencias (categoria, centavos_brl, vigente_desde, criado_por)
  values (
    new.categoria,
    new.centavos_brl,
    -- O primeiro preço da categoria vale desde sempre (o cabeçalho diz por quê).
    case when v_tem_historico then v_agora else '-infinity'::timestamptz end,
    new.atualizado_por
  );
  return new;
end;
$$;

comment on function public.fn_mia_preco_da_meta_abre_vigencia() is
  'MIA (9165): gatilho de platform_precos_meta. Preco novo fecha a vigencia aberta da categoria em now() e abre outra; o primeiro preco da categoria vale desde sempre (-infinity); preco igual nao abre vigencia; categoria apagada fecha a vigencia aberta.';

drop trigger if exists trg_mia_precos_meta_vigencia on public.platform_precos_meta;
create trigger trg_mia_precos_meta_vigencia
  after insert or update or delete on public.platform_precos_meta
  for each row execute function public.fn_mia_preco_da_meta_abre_vigencia();

-- O preço de hoje vira a primeira vigência, desde sempre. Só a categoria que
-- ainda não tem vigência nenhuma: rodar de novo não faz nada.
insert into public.mia_precos_meta_vigencias (categoria, centavos_brl, vigente_desde, criado_em, criado_por)
select p.categoria, p.centavos_brl, '-infinity'::timestamptz, p.atualizado_em, p.atualizado_por
  from public.platform_precos_meta p
 where not exists (
   select 1 from public.mia_precos_meta_vigencias v where v.categoria = p.categoria
 );

alter table public.mia_precos_meta_vigencias enable row level security;

-- ZERO POLICIES, como `platform_precos_meta`: é preço de CUSTO da plataforma,
-- quem lê é o servidor.
revoke all on public.mia_precos_meta_vigencias from public, anon, authenticated;
grant select, insert, update, delete on public.mia_precos_meta_vigencias to service_role;

revoke all on function public.fn_mia_preco_da_meta_abre_vigencia() from public, anon, authenticated;
grant execute on function public.fn_mia_preco_da_meta_abre_vigencia() to service_role;

notify pgrst, 'reload schema';
