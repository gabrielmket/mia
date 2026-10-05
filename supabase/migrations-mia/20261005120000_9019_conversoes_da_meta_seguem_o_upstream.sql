-- manifest: As conversões da Meta por etapa passam a ser as do UPSTREAM (0524, `meta_ads_conversion_rules`, consumidor `conversoes.etapa_meta`), e a 9017 fica de pé só no que o upstream não tem. `mia_conversoes_meta_regras`, `fn_mia_marcar_configuracao_regra_meta` e `fn_mia_solicitar_reenvio_conversao_meta` ficam OBSOLETAS (comentário na tabela e nas funções): nenhum código lê nem grava a tabela, e a função do reenvio passa a devolver `false` sem emitir `conversao_meta.retry_requested`, que perdeu o consumidor. Nada é apagado nesta fusão; a tabela e as duas funções podem sair numa fusão futura, depois de a .72 ficar um ciclo no ar (em produção, em 05/10/2026, a tabela tinha 0 linhas). `mia_conversoes_meta_config` (a chave "leads de formulário voltam para a Meta") continua valendo, agora para o consumidor `conversoes.meta_formulario`, que só age no negócio SEM atribuição de anúncio que nasceu de formulário da Meta. Nenhum objeto do upstream é tocado. Provado em tests/invariants/conversoes-da-meta-por-etapa.test.ts. E, à parte: `fn_mia_contato_anonimizado_limpa` (nossa) ganha `search_path` fixo, que a 0521 do upstream passou a exigir de toda função de public (tests/invariants/avisos-do-security-advisor.test.ts).
--
-- 9019 · as conversões da Meta por etapa seguem as do upstream
--
-- ── O que aconteceu ─────────────────────────────────────────────────────────
--
-- Na .70 (01/10/2026) a MIA pôs no ar a régua da Meta por etapa, em tabelas
-- nossas (9017). Dois dias depois o upstream lançou a dele (1.70, migration
-- 0524, PR #2087): a mesma régua, na tabela `meta_ads_conversion_rules`, com o
-- consumidor `lib/conversoes/etapa-meta.handler.ts` e a tela "O que cada etapa
-- do funil informa à Meta". Pela doutrina do fork ("nunca dois caminhos para a
-- mesma coisa", docs/FORK-MIA.md), a dele virou a principal na .72.
--
-- Os dois consumidores ligados mandariam o mesmo movimento de etapa à Meta duas
-- vezes (chaves diferentes no livro-razão: `Meta:<evento>` e `MetaEtapa:<uuid>`).
-- Por isso o nosso saiu do registro, e esta migration deixa a 9017 inerte no que
-- ela tinha de régua.
--
-- ── O que fica de pé ────────────────────────────────────────────────────────
--
--   · `mia_conversoes_meta_config`: a chave por empresa "leads de formulário da
--     Meta voltam para a Meta". O upstream não tem lead de formulário; o
--     consumidor `conversoes.meta_formulario` (lib/conversoes-meta/) a lê e
--     informa os eventos da régua do UPSTREAM e a venda para esse lead, pela API
--     de conversões para CRM, no mesmo livro-razão e com a mesma chave.
--
-- ── O que fica obsoleto (e não é apagado agora) ─────────────────────────────
--
--   · `mia_conversoes_meta_regras` e o gatilho que carimba `configurada_em`;
--   · `fn_mia_solicitar_reenvio_conversao_meta`: o reenvio de um evento de etapa
--     da Meta é o do upstream (`fn_solicitar_reenvio_conversao`, que aceita
--     `MetaEtapa:<uuid>` desde a 0524). A nossa passa a devolver `false` e não
--     emite mais `conversao_meta.retry_requested`, que ficou sem consumidor.
--
-- Nomes com prefixo `mia_`/`fn_mia_`: só objetos NOSSOS são tocados
-- (docs/FORK-MIA.md, regra 3).

-- ── 1. a régua da 9017 fica obsoleta ────────────────────────────────────────
comment on table public.mia_conversoes_meta_regras is
  'OBSOLETA desde a .72 (MIA 9019): a regua da Meta por etapa e a do upstream (meta_ads_conversion_rules, migration 0524). Nenhum codigo le nem grava esta tabela; pode sair numa fusao futura. Era (9017): qual evento cada etapa aberta informava a Meta.';

comment on function public.fn_mia_marcar_configuracao_regra_meta() is
  'OBSOLETA desde a .72 (MIA 9019): carimbava configurada_em em mia_conversoes_meta_regras, que nao tem mais uso. A trava equivalente do upstream e fn_marcar_configuracao_regra_meta (0524).';

-- ── 2. o reenvio nosso fica inerte ──────────────────────────────────────────
--
-- Mesma assinatura, corpo novo: devolve `false` (o mesmo "não há o que
-- reenviar" que ela já respondia) e não emite evento nenhum.
create or replace function public.fn_mia_solicitar_reenvio_conversao_meta(p_org uuid, p_lead uuid, p_event text)
returns boolean
language plpgsql
set search_path = public
as $f$
begin
  return false;
end
$f$;

comment on function public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text) is
  'OBSOLETA desde a .72 (MIA 9019): devolve false e nao emite evento. O reenvio de um evento de etapa da Meta e o do upstream (fn_solicitar_reenvio_conversao, MetaEtapa:<uuid>, 0524). Pode sair numa fusao futura.';

revoke all on function public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text) from public;
revoke execute on function public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text) from anon, authenticated;
grant execute on function public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text) to service_role;

-- ── 3. a chave dos formulários continua, com o comentário em dia ─────────────
comment on table public.mia_conversoes_meta_config is
  'MIA (9017, revista na 9019): a chave POR EMPRESA "leads de formulario da Meta voltam para a Meta". Ligada, os eventos da regua do upstream (meta_ads_conversion_rules, 0524) e a venda tambem sao informados para o negocio SEM atribuicao de anuncio que nasceu de formulario da Meta, pelo id do lead guardado (consumidor conversoes.meta_formulario). Sem linha, ou desligada: lead de formulario nao volta para a Meta.';

-- ── 4. aviso, se a régua obsoleta tiver alguma linha ────────────────────────
--
-- Em produção ela estava vazia (05/10/2026). Se uma instalação tiver regra
-- gravada ali, ela NÃO é copiada para a régua do upstream: os eventos não são
-- os mesmos (a 9017 tinha `Schedule` e `SubmitApplication`, fora da lista da
-- Meta para anúncio de WhatsApp), e copiar ligada uma regra que alguém escolheu
-- noutra régua seria decidir por ele. O aviso diz quantas são, para alguém
-- refazê-las na tela.
do $f$
declare
  v_quantas integer;
begin
  select count(*) into v_quantas from public.mia_conversoes_meta_regras;
  if v_quantas > 0 then
    raise notice 'MIA 9019: % regra(s) na regua obsoleta mia_conversoes_meta_regras. Refaca-as em Configuracoes > Conversoes (regua do upstream).', v_quantas;
  end if;
end
$f$;

-- ── 5. o gatilho nosso da anonimização ganha search_path fixo ─────────────────
--
-- A 0521 do upstream (1.70) fecha o aviso `function_search_path_mutable` do
-- Security Advisor do Supabase nas funções DELE, e o teste dela
-- (tests/invariants/avisos-do-security-advisor.test.ts) passou a exigir
-- `search_path` fixo em TODA função de `public`. A única nossa sem ele era
-- `fn_mia_contato_anonimizado_limpa` (0264, redefinida na 9013). O corpo só
-- atribui campos de NEW com tipos do catálogo, então `search_path = ''` não muda
-- o comportamento. Mesma forma da 0521: `alter function`, sem redefinir.
alter function public.fn_mia_contato_anonimizado_limpa() set search_path = '';

notify pgrst, 'reload schema';
