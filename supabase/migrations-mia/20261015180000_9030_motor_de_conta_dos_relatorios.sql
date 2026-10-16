-- manifest: O MOTOR DE CONTA dos painéis prontos (item 8 do mapa de produção, protótipo aprovado em 15/10/2026) e do montador de relatórios (item 9, que vem depois e usa o MESMO motor sem refazer). `fn_mia_relatorio(p_org, p_fonte, p_medidas, p_dim1, p_dim2, p_filtros, p_periodo, p_de, p_ate, p_valores, p_comparar, p_agora)` devolve um jsonb com os grupos SOMADOS NO BANCO (sem o teto de 1000 linhas do PostgREST): sete fontes (negocios, conversas, contatos, agenda, followup, obrigacoes, anuncios), as medidas, até dois agrupamentos, filtros e período, com a regra de data do protótipo (ganho e perdido pela data em que fecharam, aberto pela de entrada; agenda e obrigações pelo dia marcado), o fuso e a moeda da empresa, "Sem responsável/Sem origem" sempre presentes e nunca em "Outros", mais de 12 grupos dobrando em "Outros" (recalculado sobre as linhas, nunca somado), a meta do mês proporcional ao período quando a medida é soma dos ganhos, e a comparação com o período anterior. SECURITY INVOKER: quem pergunta enxerga o que a RLS de cada tabela de origem já deixa ver no CRM (atendente vê os negócios e as conversas dele, pela visibility_mode do upstream), e uma guarda explícita recusa (42501) quem pergunta por organização da qual não é membro. A plataforma (service_role: o link do dono e o MCP) chama com a organização resolvida no servidor. A única fonte cuja tabela é só do servidor (ad_conversion_dispatches) passa por UM definer estreito, `fn_mia_relatorio_linhas_de_anuncios`, que confere gestor ou administrador e devolve só plataforma, evento, situação, data e campanha (nada de pessoa). `p_valores = false` (quem não vê valor, o link sem valores) devolve as medidas de dinheiro como nulas e a meta sem o alvo. Peças: o tipo `mia_relatorio_linha`, `fn_mia_relatorio_catalogo` (o que cada fonte mede, agrupa e filtra), `fn_mia_relatorio_janela` e `fn_mia_relatorio_janela_anterior` (o período no fuso da empresa), `fn_mia_obrigacao_situacao` (a porta SQL de lib/obrigacoes/situacao.ts, provada igual pelo invariante), `fn_mia_relatorio_linhas`, `fn_mia_relatorio_chaves`, `fn_mia_relatorio_passa` e `fn_mia_relatorio_medir`. Nenhum objeto do upstream é redefinido. Provado em tests/invariants/motor-de-conta-dos-relatorios.test.ts.
--
-- 9030 · o motor de conta dos painéis prontos e do montador de relatórios
--
-- `mia`: só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: o tipo
-- nasce dentro de um `do` que confere o catálogo, as funções são `create or
-- replace` com nome nosso.
--
-- ── Por que no banco ────────────────────────────────────────────────────────
--
-- Decisão do protótipo do montador ("Onde a conta é feita"): no banco, com
-- todos os registros do período; o navegador só desenha. No navegador a conta
-- para nas primeiras 1000 linhas (`max_rows` do PostgREST) e o número sai
-- errado sem avisar. Aqui a resposta é UM jsonb, do tamanho dos grupos.
--
-- ── Por que SECURITY INVOKER ────────────────────────────────────────────────
--
-- "O relatório respeita o que a pessoa já vê no CRM" (decisão do protótipo).
-- Quem diz o que cada um vê é a RLS de cada tabela de origem: `crm_leads` por
-- `fn_can_view_lead` (o atendente vê os dele, ou os dele e os sem dono, pela
-- `visibility_mode` da empresa), `conversations` por `fn_can_view_conversation`,
-- e assim por diante. Um definer teria de reescrever essas sete regras e
-- divergiria em silêncio na primeira mudança do upstream nelas. Invoker herda.
-- É o molde das irmãs do upstream (`fn_attendant_metrics`, 0037;
-- `fn_channel_metrics`, 0590).
--
-- A guarda explícita no começo de `fn_mia_relatorio` não troca a RLS: ela dá
-- uma recusa legível (42501) a quem pergunta por empresa da qual não é membro,
-- em vez de uma resposta de zeros que pareceria "não aconteceu nada".
--
-- A plataforma (`service_role`, sem `auth.uid()`) passa: é o link do dono e o
-- MCP, que resolvem a organização no servidor (a linha do link, o token de
-- plataforma), nunca do corpo do pedido. Por isso toda leitura abaixo filtra
-- `organization_id = p_org` explicitamente, mesmo onde a RLS já filtraria.
--
-- A exceção é `ad_conversion_dispatches`, que é só do servidor (RLS sem policy,
-- grants revogados). Ela passa por um definer estreito que confere gestor ou
-- administrador (o mesmo piso da tela de Conversões) e devolve só colunas sem
-- dado de pessoa.
--
-- ── O que cada linha é ──────────────────────────────────────────────────────
--
-- Toda fonte produz linhas de UM tipo (`mia_relatorio_linha`): o registro
-- contado, o momento que decide o período, as chaves de agrupamento (`dims`) e
-- os rótulos de quem tem nome no banco (`rotulos`), e os insumos das medidas
-- (valor, moeda, situação, x1..x3, probabilidade, ok). O agregador não sabe de
-- fonte nenhuma: agrupa, dobra, mede. Fonte nova é um ramo em
-- `fn_mia_relatorio_linhas` e uma linha no catálogo.

do $$
begin
  if to_regtype('public.mia_relatorio_linha') is null then
    create type public.mia_relatorio_linha as (
      registro    uuid,
      momento     timestamptz,
      dims        jsonb,
      rotulos     jsonb,
      valor_cents bigint,
      moeda       text,
      sit         text,
      x1          numeric,
      x2          numeric,
      x3          numeric,
      prob        numeric,
      ok          boolean
    );
  end if;
end $$;

comment on type public.mia_relatorio_linha is
  'MIA (9030): uma linha contada pelo motor de relatorios. registro = o que e contado; momento = a data que decide o periodo; dims = chave de cada agrupamento (texto, ou lista de texto nas etiquetas); rotulos = o nome que o banco tem para a chave (etapa, tipo, regua, agente); valor_cents/moeda/sit/x1/x2/x3/prob/ok = os insumos das medidas, com o significado que fn_mia_relatorio_catalogo da a cada fonte.';

-- ── 1. o catálogo ───────────────────────────────────────────────────────────
--
-- O que cada fonte MEDE, por onde AGRUPA e o que FILTRA. A tela (o montador) e
-- o MCP leem a mesma lista de `lib/paineis/catalogo.ts`; o invariante confere
-- que as duas dizem o mesmo.
--
-- `futuro`: "Este mês" inclui os dias que ainda vêm (agenda e obrigações contam
-- pelo dia marcado). `naturais`: agrupamentos com ordem própria e todos os
-- valores sempre presentes (mesmo com zero). `com_sem`: agrupamentos em que a
-- ausência vira o grupo "Sem …", sempre presente e nunca dobrado em "Outros".
create or replace function public.fn_mia_relatorio_catalogo()
returns jsonb
language sql
immutable
set search_path = ''
as $f$
  select '{
    "negocios": {
      "medidas": ["qtd", "soma", "media", "conv", "tetapa", "tfechar", "prev", "sem_prob", "chegaram"],
      "dims": ["etapa", "situacao", "resp", "origem", "etiqueta", "motivo", "previsto", "funil", "mes", "semana", "dia"],
      "filtros": ["funil", "resp", "etiqueta", "situacao", "origem", "motivo", "so_receita"],
      "futuro": false
    },
    "conversas": {
      "medidas": ["qtd", "tresp", "tresp90", "resolv"],
      "dims": ["quem", "canal", "resp", "etiqueta", "mes", "semana", "dia"],
      "filtros": ["resp", "etiqueta", "canal", "quem"],
      "futuro": false
    },
    "contatos": {
      "medidas": ["qtd"],
      "dims": ["origem", "canal", "etiqueta", "resp", "mes", "semana", "dia"],
      "filtros": ["resp", "etiqueta", "origem", "canal"],
      "futuro": false
    },
    "agenda": {
      "medidas": ["qtd", "comp"],
      "dims": ["situacao", "tipo", "prof", "resp", "mes", "semana", "dia"],
      "filtros": ["resp", "situacao", "prof", "tipo"],
      "futuro": true
    },
    "followup": {
      "medidas": ["qtd", "taxa"],
      "dims": ["resultado", "fluxo", "mes", "semana", "dia"],
      "filtros": ["fluxo", "resultado"],
      "futuro": false
    },
    "obrigacoes": {
      "medidas": ["qtd", "emdia"],
      "dims": ["situacao", "tipo", "resp", "categoria", "mes", "semana"],
      "filtros": ["resp", "situacao", "tipo", "categoria"],
      "futuro": true
    },
    "anuncios": {
      "medidas": ["qtd", "aceito"],
      "dims": ["evento", "plataforma", "campanha", "mes", "semana", "dia"],
      "filtros": ["plataforma", "evento"],
      "futuro": false
    },
    "_tempo": ["mes", "semana", "dia"],
    "_naturais": {
      "negocios.situacao": ["aberto", "ganho", "perdido"],
      "conversas.quem": ["agente", "equipe", "sem_resposta"],
      "agenda.situacao": ["marcado", "confirmado", "compareceu", "faltou", "desmarcou"],
      "followup.resultado": ["respondeu", "fechou", "equipe", "parou", "sem_resposta", "andamento", "encerrado"],
      "obrigacoes.situacao": ["a_pedir", "pedido", "recebido", "valido", "vencendo", "vencido", "pendente", "feita"],
      "obrigacoes.categoria": ["documento", "atividade"],
      "anuncios.plataforma": ["meta_ads", "google_ads"]
    },
    "_ordenados_pela_chave": ["previsto"],
    "_com_sem": ["resp", "origem", "etiqueta", "motivo", "previsto", "tipo", "prof", "campanha", "canal"],
    "_de_valor": ["soma", "media", "prev"]
  }'::jsonb;
$f$;

comment on function public.fn_mia_relatorio_catalogo() is
  'MIA (9030): o que cada fonte do motor de relatorios mede, agrupa e filtra. Espelhado em lib/paineis/catalogo.ts e conferido pelo invariante.';

-- ── 2. o período, no fuso da empresa ────────────────────────────────────────
--
-- "Hoje" e "este mês" viram à meia-noite de QUEM USA (decisão do protótipo:
-- o fuso da empresa). A janela é semiaberta, [inicio, fim), e as duas pontas
-- são a meia-noite local convertida para timestamptz.
--
-- `p_agora` existe para o teste congelar o relógio; o produto passa nulo.
create or replace function public.fn_mia_relatorio_janela(
  p_fuso text,
  p_periodo text,
  p_de date default null,
  p_ate date default null,
  p_futuro boolean default false,
  p_agora timestamptz default null
) returns jsonb
language plpgsql
stable
set search_path = ''
as $f$
declare
  v_hoje date := (coalesce(p_agora, now()) at time zone p_fuso)::date;
  v_de date;
  v_ate date;
begin
  case coalesce(p_periodo, '30')
    when 'hoje' then v_de := v_hoje; v_ate := v_hoje;
    when '7' then v_de := v_hoje - 6; v_ate := v_hoje;
    when '30' then v_de := v_hoje - 29; v_ate := v_hoje;
    when '90' then v_de := v_hoje - 89; v_ate := v_hoje;
    when 'mes' then
      v_de := date_trunc('month', v_hoje)::date;
      v_ate := case when p_futuro
                    then (date_trunc('month', v_hoje) + interval '1 month' - interval '1 day')::date
                    else v_hoje end;
    when 'mesp' then
      v_de := (date_trunc('month', v_hoje) - interval '1 month')::date;
      v_ate := (date_trunc('month', v_hoje) - interval '1 day')::date;
    when 'pers' then
      if p_de is null or p_ate is null then
        raise exception 'periodo_personalizado_sem_datas' using errcode = '22023';
      end if;
      v_de := least(p_de, p_ate);
      v_ate := greatest(p_de, p_ate);
      if v_ate - v_de > 3660 then
        raise exception 'periodo_longo_demais: no maximo dez anos' using errcode = '22023';
      end if;
    when 'tudo' then
      return jsonb_build_object(
        'periodo', 'tudo', 'de', null, 'ate', null, 'inicio', null, 'fim', null,
        'fuso', p_fuso, 'hoje', v_hoje, 'futuro', p_futuro, 'dias', null
      );
    else
      raise exception 'periodo_desconhecido: %', p_periodo using errcode = '22023';
  end case;
  return jsonb_build_object(
    'periodo', coalesce(p_periodo, '30'),
    'de', v_de,
    'ate', v_ate,
    'inicio', (v_de::timestamp at time zone p_fuso),
    'fim', ((v_ate + 1)::timestamp at time zone p_fuso),
    'fuso', p_fuso,
    'hoje', v_hoje,
    'futuro', p_futuro,
    'dias', v_ate - v_de + 1
  );
end;
$f$;

comment on function public.fn_mia_relatorio_janela(text, text, date, date, boolean, timestamptz) is
  'MIA (9030): o periodo (hoje, 7, 30, 90, mes, mesp, pers, tudo) virado em dias e em janela semiaberta [inicio, fim) no fuso da empresa. Em "mes", as fontes de data marcada (futuro) vao ate o fim do mes; as outras, ate hoje.';

-- O período anterior, para "comparar com o período anterior". "Este mês" até
-- hoje compara com o mesmo trecho do mês passado; o mês inteiro, com o mês
-- passado inteiro; os demais, com a mesma quantidade de dias logo antes.
create or replace function public.fn_mia_relatorio_janela_anterior(p_janela jsonb)
returns table (de date, ate date)
language plpgsql
immutable
set search_path = ''
as $f$
declare
  v_de date := (p_janela->>'de')::date;
  v_ate date := (p_janela->>'ate')::date;
  v_inicio_mes date;
begin
  if v_de is null or v_ate is null then
    return;
  end if;
  if p_janela->>'periodo' = 'mes' then
    v_inicio_mes := (v_de - interval '1 month')::date;
    if coalesce((p_janela->>'futuro')::boolean, false) then
      de := v_inicio_mes;
      ate := (v_de - 1);
    else
      de := v_inicio_mes;
      ate := least(v_inicio_mes + (v_ate - v_de), v_de - 1);
    end if;
  elsif p_janela->>'periodo' = 'mesp' then
    de := (v_de - interval '1 month')::date;
    ate := v_de - 1;
  else
    ate := v_de - 1;
    de := ate - (v_ate - v_de);
  end if;
  return next;
end;
$f$;

comment on function public.fn_mia_relatorio_janela_anterior(jsonb) is
  'MIA (9030): o periodo anterior de uma janela de fn_mia_relatorio_janela, para a comparacao. Vazio quando a janela e "tudo".';

-- ── 3. a situação da obrigação, no banco ────────────────────────────────────
--
-- A porta FIEL de `situacao()` em lib/obrigacoes/situacao.ts — que continua
-- sendo o lugar único da regra para a tela, a automação e o MCP. Esta cópia
-- existe só para o motor contar por situação no banco; o invariante roda as
-- duas sobre a mesma matriz de casos e reprova se divergirem.
create or replace function public.fn_mia_obrigacao_situacao(
  p_categoria text,
  p_proxima_em date,
  p_feita_em date,
  p_valido_ate date,
  p_recebido_em date,
  p_pedido_em date,
  p_avisos_dias integer[],
  p_hoje date
) returns text
language sql
immutable
set search_path = ''
as $f$
  with aviso as (
    select case when coalesce(array_length(p_avisos_dias, 1), 0) > 0
                then (select max(a) from unnest(p_avisos_dias) a)
                else 30 end as maior
  )
  select case
    when p_categoria = 'atividade' then
      case
        when p_proxima_em is null then 'feita'
        when (p_proxima_em - p_hoje) <= (select maior from aviso) then 'pendente'
        when p_feita_em is not null then 'feita'
        else 'pendente'
      end
    when p_valido_ate is not null then
      case
        when (p_valido_ate - p_hoje) < 0 then 'vencido'
        when (p_valido_ate - p_hoje) <= (select maior from aviso) then 'vencendo'
        else 'valido'
      end
    when p_recebido_em is not null then 'recebido'
    when p_pedido_em is not null then 'pedido'
    else 'a_pedir'
  end;
$f$;

comment on function public.fn_mia_obrigacao_situacao(text, date, date, date, date, date, integer[], date) is
  'MIA (9030): a situacao de uma obrigacao num dia (a_pedir, pedido, recebido, valido, vencendo, vencido, pendente, feita). Porta fiel de situacao() em lib/obrigacoes/situacao.ts, que segue sendo a regra da tela; o invariante prova as duas iguais.';

-- ── 4. anúncios: o definer estreito ─────────────────────────────────────────
--
-- `ad_conversion_dispatches` é só do servidor. Quem pode ver o que foi
-- informado à Meta e ao Google é gestor ou administrador (o piso da tela de
-- Conversões e de Meta Ads); a plataforma (sem `auth.uid()`) também. Quem não
-- pode recebe zero linhas e o motor já recusou antes, com a frase.
--
-- Devolve só o que o painel conta: plataforma, evento (a etapa pelo nome),
-- situação, data e a campanha do negócio de origem. Nada de contato, telefone,
-- valor ou título.
create or replace function public.fn_mia_relatorio_linhas_de_anuncios(
  p_org uuid,
  p_inicio timestamptz,
  p_fim timestamptz
) returns setof public.mia_relatorio_linha
language plpgsql
stable
security definer
set search_path = ''
as $f$
begin
  if auth.uid() is not null
     and not public.fn_is_platform_admin()
     and not public.fn_role_at_least(p_org, 'manager') then
    return;
  end if;
  return query
  select
    d.id,
    d.attempted_at,
    jsonb_build_object(
      'plataforma', d.platform,
      'evento', case
                  when d.event_name = 'Purchase' then 'compra'
                  when d.event_name = 'QualifiedLead' then 'qualificado'
                  when d.event_name ~ '^(Meta)?Etapa:' then 'etapa:' || split_part(d.event_name, ':', 2)
                  else d.event_name
                end,
      'campanha', nullif(btrim(coalesce(
                    l.source_metadata->>'campaign_name',
                    l.source_metadata->>'campaign',
                    l.source_metadata->>'utm_campaign')), '')
    ),
    jsonb_build_object('evento', s.name),
    null::bigint,
    null::text,
    d.status,
    null::numeric,
    null::numeric,
    null::numeric,
    null::numeric,
    d.status = 'sent'
  from public.ad_conversion_dispatches d
  left join public.crm_leads l
    on l.id = d.lead_id and l.organization_id = d.organization_id
  left join public.crm_stages s
    on d.event_name ~ '^(Meta)?Etapa:[0-9a-fA-F-]{36}$'
   and s.id = split_part(d.event_name, ':', 2)::uuid
   and s.organization_id = d.organization_id
  where d.organization_id = p_org
    and d.status in ('sent', 'error')
    and d.attempted_at >= p_inicio
    and d.attempted_at < p_fim;
end;
$f$;

comment on function public.fn_mia_relatorio_linhas_de_anuncios(uuid, timestamptz, timestamptz) is
  'MIA (9030): as linhas da fonte "anuncios" do motor de relatorios: o que o sistema informou a Meta e ao Google (enviado ou recusado; o que nem saiu fica de fora) por plataforma, evento e campanha, sem dado de pessoa. Definer porque ad_conversion_dispatches e so do servidor; confere gestor ou administrador (ou a plataforma) e, para os outros, devolve zero linhas.';

revoke all on function public.fn_mia_relatorio_linhas_de_anuncios(uuid, timestamptz, timestamptz) from public;
revoke execute on function public.fn_mia_relatorio_linhas_de_anuncios(uuid, timestamptz, timestamptz) from anon;
grant execute on function public.fn_mia_relatorio_linhas_de_anuncios(uuid, timestamptz, timestamptz)
  to authenticated, service_role;

-- ── 5. as linhas de cada fonte ──────────────────────────────────────────────
--
-- A REGRA DE DATA (decisão do protótipo): negócio ganho ou perdido conta pela
-- data em que fechou; aberto, pela data em que entrou. Conversa conta pela
-- primeira mensagem do cliente DENTRO do período (é quando aquele atendimento
-- começou para o período). Contato, pela entrada na base. Agenda, pelo dia
-- marcado. Follow-up, pelo dia em que a pessoa entrou na régua. Obrigação, pelo
-- vencimento (a próxima data, na atividade). Anúncio, pelo dia em que foi
-- informado.
create or replace function public.fn_mia_relatorio_linhas(
  p_org uuid,
  p_fonte text,
  p_inicio timestamptz,
  p_fim timestamptz,
  p_filtros jsonb,
  p_agora timestamptz,
  p_fuso text
) returns setof public.mia_relatorio_linha
language plpgsql
stable
set search_path = ''
as $f$
declare
  v_agora timestamptz := coalesce(p_agora, now());
  v_hoje date := (coalesce(p_agora, now()) at time zone p_fuso)::date;
  v_funil uuid := nullif(coalesce(p_filtros, '{}'::jsonb)->>'funil', '')::uuid;
  v_so_receita boolean := coalesce((coalesce(p_filtros, '{}'::jsonb)->>'so_receita')::boolean, false);
  v_tudo boolean := p_inicio = '-infinity'::timestamptz;
begin
  if p_fonte = 'negocios' then
    return query
    with primeira as (
      -- A primeira etapa de cada funil: aonde chegou, no mínimo, o perdido
      -- sem a etapa de onde saiu gravada.
      select st.pipeline_id, min(st.position) as posicao
        from public.crm_stages st
       where st.organization_id = p_org and not st.is_archived and not st.is_lost
       group by st.pipeline_id
    )
    select
      l.id,
      case when l.status = 'open' then l.created_at else l.closed_at end,
      jsonb_build_object(
        'etapa', l.stage_id::text,
        'situacao', case l.status when 'open' then 'aberto' when 'won' then 'ganho' else 'perdido' end,
        'resp', l.owner_user_id::text,
        'origem', nullif(btrim(l.source), ''),
        'etiqueta', to_jsonb(coalesce(l.tags, '{}'::text[])),
        'motivo', case when l.status = 'lost' then nullif(btrim(l.lost_reason), '') end,
        'previsto', to_char(l.expected_close_date, 'YYYY-MM'),
        'funil', l.pipeline_id::text
      ),
      jsonb_build_object('etapa', s.name, 'funil', p.name, 'ordem_etapa', s.position),
      l.value_cents,
      nullif(btrim(l.currency), ''),
      case l.status when 'open' then 'aberto' when 'won' then 'ganho' else 'perdido' end,
      -- x1: dias na etapa (até hoje, ou até fechar)
      round((extract(epoch from (coalesce(l.closed_at, v_agora) - coalesce(l.stage_changed_at, l.created_at))) / 86400.0)::numeric, 2),
      -- x2: dias do primeiro contato ao fechamento (só os ganhos usam)
      case when l.status = 'won'
           then round((extract(epoch from (l.closed_at - l.created_at)) / 86400.0)::numeric, 2) end,
      -- x3: até onde o negócio chegou no funil (a posição da etapa). Ganho
      -- chegou a todas; perdido, à etapa de onde saiu; aberto, à atual.
      case
        when l.status = 'won' then 1e12::numeric
        when l.status = 'lost' then coalesce(lf.position, case when not s.is_lost then s.position end, pr.posicao)
        else s.position
      end,
      -- prob: a mesma regra de lib/leads/previsao.ts (upstream #1535): etapa de
      -- ganho vale 100 e de perda 0; a fonte "ia_quando_houver" do funil usa a
      -- nota da IA quando existe; sem calibração, nula (balde "sem probabilidade").
      case
        when s.is_won then 100::numeric
        when s.is_lost then 0::numeric
        when (p.settings #>> '{previsao,fonte}') = 'ia_quando_houver' and sc.ai_probability is not null
          then sc.ai_probability::numeric
        else s.win_probability::numeric
      end,
      l.status = 'won'
    from public.crm_leads l
    join public.crm_stages s on s.id = l.stage_id and s.organization_id = l.organization_id
    join public.crm_pipelines p on p.id = l.pipeline_id and p.organization_id = l.organization_id
    left join public.crm_stages lf
      on lf.id = l.lost_from_stage_id and lf.pipeline_id = l.pipeline_id
    left join primeira pr on pr.pipeline_id = l.pipeline_id
    left join public.crm_lead_scores sc
      on sc.lead_id = l.id and sc.organization_id = l.organization_id
    where l.organization_id = p_org
      -- A troca de funil encerra a origem como perdida com este motivo, e não
      -- é perda (a mesma régua de lib/metrics/perdas.ts): o negócio segue vivo
      -- no outro funil.
      and coalesce(l.lost_reason, '') <> 'moved_to_another_pipeline'
      and (v_funil is null or l.pipeline_id = v_funil)
      -- Só os funis em que vencer é receita (crm_pipelines.settings.vitoria_e_receita,
      -- a mesma régua da meta em app/api/v1/metas/route.ts).
      and (not v_so_receita or coalesce((p.settings->>'vitoria_e_receita')::boolean, true))
      and (
        (l.status = 'open' and l.created_at >= p_inicio and l.created_at < p_fim)
        or (l.status <> 'open' and l.closed_at >= p_inicio and l.closed_at < p_fim)
      );

  elsif p_fonte = 'conversas' then
    -- A conversa do período é a que teve mensagem do cliente no período. Quem
    -- respondeu decide o grupo: uma pessoa da equipe (mensagem com
    -- `sent_by_user_id`, ou do celular) → "equipe"; só o agente (`sent_via =
    -- 'ai'`) → "agente"; ninguém → "sem_resposta". O tempo de resposta é da
    -- primeira mensagem do cliente no período até a primeira resposta de quem
    -- atendeu (a régua do upstream em fn_attendant_metrics: a da pessoa conta
    -- desde a primeira mensagem do cliente).
    return query
    select
      c.id,
      f.primeira_entrada,
      jsonb_build_object(
        'quem', case when r.primeira_humana is not null then 'equipe'
                     when r.primeira_ia is not null then 'agente'
                     else 'sem_resposta' end,
        'canal', c.channel,
        'resp', c.assigned_to_user_id::text,
        'etiqueta', to_jsonb(coalesce(c.tags, '{}'::text[]))
      ),
      '{}'::jsonb,
      null::bigint,
      null::text,
      null::text,
      case
        when r.primeira_humana is not null
          then round(extract(epoch from (r.primeira_humana - f.primeira_entrada))::numeric)
        when r.primeira_ia is not null
          then round(extract(epoch from (r.primeira_ia - f.primeira_entrada))::numeric)
      end,
      null::numeric,
      null::numeric,
      null::numeric,
      (r.primeira_humana is null and r.primeira_ia is not null)
    from public.conversations c
    cross join lateral (
      select min(m.sent_at) as primeira_entrada
        from public.messages m
       where m.conversation_id = c.id
         and m.direction = 'inbound'
         and m.sent_at >= p_inicio and m.sent_at < p_fim
    ) f
    cross join lateral (
      select
        min(m.sent_at) filter (where m.sent_by_user_id is not null or m.sent_via = 'external_device') as primeira_humana,
        min(m.sent_at) filter (where m.sent_via = 'ai') as primeira_ia
      from public.messages m
      where m.conversation_id = c.id
        and m.direction = 'outbound'
        and m.sent_at >= f.primeira_entrada and m.sent_at < p_fim
    ) r
    where c.organization_id = p_org
      and not c.is_group
      -- Corte barato antes do lateral: a conversa tocada depois do começo do
      -- período. `greatest` ignora o nulo, e a data de criação segura a conversa
      -- de um caminho que não carimbou `last_inbound_at`.
      and greatest(c.last_inbound_at, c.last_message_at, c.created_at) >= p_inicio
      and c.created_at < p_fim
      and f.primeira_entrada is not null;

  elsif p_fonte = 'contatos' then
    return query
    select
      ct.id,
      ct.created_at,
      jsonb_build_object(
        'origem', nullif(btrim(ct.source), ''),
        'canal', cv.channel,
        'etiqueta', to_jsonb(coalesce(ct.tags, '{}'::text[])),
        'resp', ct.carteira_user_id::text
      ),
      '{}'::jsonb,
      null::bigint, null::text, null::text,
      null::numeric, null::numeric, null::numeric, null::numeric,
      false
    from public.contacts ct
    left join lateral (
      select c.channel from public.conversations c
       where c.contact_id = ct.id and c.organization_id = p_org
       order by c.created_at
       limit 1
    ) cv on true
    where ct.organization_id = p_org
      and ct.is_merged_into is null
      and not ct.is_personal
      and ct.kind = 'person'
      and ct.created_at >= p_inicio and ct.created_at < p_fim;

  elsif p_fonte = 'agenda' then
    return query
    select
      a.id,
      a.starts_at,
      jsonb_build_object(
        'situacao', case a.status when 'pending' then 'marcado' when 'confirmed' then 'confirmado'
                                  when 'completed' then 'compareceu' when 'no_show' then 'faltou'
                                  else 'desmarcou' end,
        'tipo', a.event_type_id::text,
        'prof', a.owner_user_id::text,
        'resp', case when a.created_by_kind = 'ai' and a.created_by_agent_id is not null
                     then 'ia:' || a.created_by_agent_id::text
                     else a.created_by_user_id::text end
      ),
      jsonb_build_object(
        'tipo', et.name,
        'resp', case when a.created_by_kind = 'ai' then ag.name end
      ),
      null::bigint, null::text,
      case a.status when 'pending' then 'marcado' when 'confirmed' then 'confirmado'
                    when 'completed' then 'compareceu' when 'no_show' then 'faltou'
                    else 'desmarcou' end,
      null::numeric, null::numeric, null::numeric, null::numeric,
      a.status = 'completed'
    from public.calendar_appointments a
    left join public.calendar_event_types et
      on et.id = a.event_type_id and et.organization_id = a.organization_id
    left join public.ai_agents ag
      on ag.id = a.created_by_agent_id and ag.organization_id = a.organization_id
    where a.organization_id = p_org
      and a.starts_at >= p_inicio and a.starts_at < p_fim;

  elsif p_fonte = 'followup' then
    -- Quem RECEBEU ao menos uma mensagem da régua (o evento `action_sent`), pelo
    -- dia em que entrou nela. As réguas do funil (`crm_automation`) e os
    -- roteiros de atendimento ficam de fora: follow-up é a mensagem para quem
    -- parou de responder.
    return query
    select
      e.id,
      e.started_at,
      jsonb_build_object(
        'resultado', case e.outcome
                       when 'converted' then 'fechou'
                       when 'replied' then 'respondeu'
                       when 'opted_out' then 'parou'
                       when 'handoff' then 'equipe'
                       when 'exhausted' then 'sem_resposta'
                       else case when e.status in ('completed', 'cancelled', 'dead') then 'encerrado'
                                 else 'andamento' end
                     end,
        'fluxo', e.pointer_id::text
      ),
      jsonb_build_object('fluxo', fp.name),
      null::bigint, null::text, e.outcome,
      null::numeric, null::numeric, null::numeric, null::numeric,
      coalesce(e.outcome in ('replied', 'converted'), false)
    from public.followup_enrollments e
    join public.followup_flow_pointers fp
      on fp.id = e.pointer_id and fp.organization_id = e.organization_id and fp.surface = 'followup'
    where e.organization_id = p_org
      and e.started_at >= p_inicio and e.started_at < p_fim
      and exists (
        select 1 from public.followup_enrollment_events ev
         where ev.enrollment_id = e.id and ev.event_type = 'action_sent'
      );

  elsif p_fonte = 'obrigacoes' then
    return query
    select
      o.id,
      case when v.vence is null then null
           else (v.vence::timestamp at time zone p_fuso) end,
      jsonb_build_object(
        'situacao', v.sit,
        'tipo', coalesce(o.tipo_id::text, 'nome:' || o.nome),
        'resp', o.responsavel_user_id::text,
        'categoria', o.categoria
      ),
      jsonb_build_object('tipo', coalesce(t.nome, o.nome)),
      null::bigint, null::text, v.sit,
      null::numeric, null::numeric, null::numeric, null::numeric,
      v.sit in ('valido', 'recebido', 'feita')
    from public.mia_obrigacoes o
    left join public.mia_obrigacoes_tipos t
      on t.id = o.tipo_id and t.organization_id = o.organization_id
    cross join lateral (
      select
        case when o.categoria = 'atividade' then o.proxima_em else coalesce(o.valido_ate, o.prazo_em) end as vence,
        public.fn_mia_obrigacao_situacao(o.categoria, o.proxima_em, o.feita_em, o.valido_ate,
                                         o.recebido_em, o.pedido_em, o.avisos_dias, v_hoje) as sit
    ) v
    where o.organization_id = p_org
      and o.arquivado_em is null
      and (
        (v_tudo and v.vence is null)
        or (v.vence is not null
            and (v.vence::timestamp at time zone p_fuso) >= p_inicio
            and (v.vence::timestamp at time zone p_fuso) < p_fim)
      );

  elsif p_fonte = 'anuncios' then
    return query
    select * from public.fn_mia_relatorio_linhas_de_anuncios(p_org, p_inicio, p_fim);

  else
    raise exception 'fonte_desconhecida: %', p_fonte using errcode = '22023';
  end if;
end;
$f$;

comment on function public.fn_mia_relatorio_linhas(uuid, text, timestamptz, timestamptz, jsonb, timestamptz, text) is
  'MIA (9030): as linhas de uma fonte do motor de relatorios no periodo [p_inicio, p_fim), com a regra de data do prototipo. security invoker: cada fonte le pela RLS de quem chama, e toda leitura filtra organization_id = p_org.';

-- ── 6. as chaves de agrupamento de uma linha ────────────────────────────────
--
-- Uma linha cai em UMA chave por agrupamento, menos as etiquetas: o negócio com
-- duas etiquetas conta em cada uma (o total do relatório conta uma vez só,
-- decisão do protótipo). Ausência vira `__sem`; sem agrupamento, `__tudo`. As
-- de tempo são o dia, a segunda-feira da semana e o mês, no fuso da empresa.
create or replace function public.fn_mia_relatorio_chaves(
  p_dims jsonb,
  p_momento timestamptz,
  p_dim text,
  p_fuso text
) returns setof text
language plpgsql
stable
set search_path = ''
as $f$
declare
  v jsonb;
  k text;
  achou boolean := false;
begin
  if p_dim is null then
    return next '__tudo';
    return;
  end if;
  if p_dim in ('mes', 'semana', 'dia') then
    if p_momento is null or p_momento in ('-infinity'::timestamptz, 'infinity'::timestamptz) then
      return next '__sem';
    elsif p_dim = 'mes' then
      return next to_char(p_momento at time zone p_fuso, 'YYYY-MM');
    elsif p_dim = 'semana' then
      return next to_char(date_trunc('week', p_momento at time zone p_fuso), 'YYYY-MM-DD');
    else
      return next to_char(p_momento at time zone p_fuso, 'YYYY-MM-DD');
    end if;
    return;
  end if;
  v := p_dims -> p_dim;
  if v is not null and jsonb_typeof(v) = 'array' then
    for k in select distinct nullif(btrim(e), '') from jsonb_array_elements_text(v) e loop
      if k is not null then
        achou := true;
        return next k;
      end if;
    end loop;
    if not achou then
      return next '__sem';
    end if;
    return;
  end if;
  return next coalesce(nullif(btrim(p_dims ->> p_dim), ''), '__sem');
end;
$f$;

comment on function public.fn_mia_relatorio_chaves(jsonb, timestamptz, text, text) is
  'MIA (9030): as chaves de um agrupamento para uma linha do motor de relatorios (uma por linha; uma por etiqueta nas etiquetas). Ausencia vira __sem; sem agrupamento, __tudo; tempo e dia, segunda-feira da semana ou mes no fuso da empresa.';

-- ── 7. o filtro ─────────────────────────────────────────────────────────────
--
-- `{"resp": "<uuid>"}` deixa passar a linha cuja chave daquele agrupamento é o
-- valor; `"__sem"` pede a ausência ("Sem responsável"). Nas etiquetas, a linha
-- passa se tiver a etiqueta. `so_receita` não é chave de linha: a fonte aplica.
create or replace function public.fn_mia_relatorio_passa(p_dims jsonb, p_filtros jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $f$
  select coalesce(bool_and(
    case
      when f.key = 'so_receita' then true
      when jsonb_typeof(p_dims -> f.key) = 'array' then
        case when (f.value #>> '{}') = '__sem'
             then jsonb_array_length(p_dims -> f.key) = 0
             else (p_dims -> f.key) ? (f.value #>> '{}') end
      else
        case when (f.value #>> '{}') = '__sem'
             then nullif(btrim(p_dims ->> f.key), '') is null
             else (p_dims ->> f.key) is not distinct from (f.value #>> '{}') end
    end
  ), true)
  from jsonb_each(coalesce(p_filtros, '{}'::jsonb)) f;
$f$;

comment on function public.fn_mia_relatorio_passa(jsonb, jsonb) is
  'MIA (9030): a linha do motor de relatorios passa nos filtros? Um valor por chave; "__sem" pede a ausencia; nas etiquetas, ter a etiqueta.';

-- ── 8. as medidas de um grupo ───────────────────────────────────────────────
--
-- O MESMO registro nunca conta duas vezes num grupo (`distinct on`): é o que
-- faz o "Outros" e o total recalcularem sobre as linhas, em vez de somar
-- grupos (mediana e taxa não se somam). Dinheiro só na moeda da empresa: o que
-- vier noutra moeda fica fora da soma e volta contado em `fora_da_moeda`
-- (moeda diferente não soma, a régua do upstream em lib/metrics/perdas.ts).
-- Sem moeda no negócio vale a da empresa. `p_valores = false` devolve nulo em
-- toda medida de dinheiro.
create or replace function public.fn_mia_relatorio_medir(
  p_linhas public.mia_relatorio_linha[],
  p_medidas text[],
  p_moeda text,
  p_valores boolean
) returns jsonb
language sql
stable
set search_path = ''
as $f$
  with r as (
    select distinct on (u.registro) u.*
      from unnest(coalesce(p_linhas, '{}'::public.mia_relatorio_linha[])) u
     order by u.registro
  ),
  a as (
    select
      count(*)::bigint as n,
      count(*) filter (where r.ok)::bigint as n_ok,
      coalesce(sum(r.valor_cents) filter (where coalesce(r.moeda, p_moeda) = p_moeda), 0)::bigint as soma,
      avg(r.valor_cents) filter (where coalesce(r.moeda, p_moeda) = p_moeda and r.valor_cents is not null) as media,
      count(*) filter (where r.sit = 'ganho')::bigint as ganhos,
      count(*) filter (where r.sit in ('ganho', 'perdido'))::bigint as fechados,
      avg(r.x1) as media_x1,
      avg(r.x2) filter (where r.sit = 'ganho') as tfechar,
      coalesce(sum(round(r.valor_cents * r.prob / 100.0))
               filter (where r.sit = 'aberto' and r.prob is not null and r.valor_cents is not null
                             and coalesce(r.moeda, p_moeda) = p_moeda), 0)::bigint as prev,
      count(*) filter (where r.sit = 'aberto' and r.prob is null)::bigint as sem_prob,
      percentile_cont(0.5) within group (order by r.x1) as p50,
      percentile_cont(0.9) within group (order by r.x1) as p90,
      count(*) filter (where r.sit = 'compareceu')::bigint as compareceu,
      count(*) filter (where r.sit in ('compareceu', 'faltou'))::bigint as presenca,
      count(*) filter (where r.valor_cents is not null and coalesce(r.moeda, p_moeda) <> p_moeda)::bigint as fora
    from r
  )
  select jsonb_build_object(
    'n', a.n,
    'n_ok', a.n_ok,
    'fora_da_moeda', a.fora,
    'valores', coalesce((
      select jsonb_object_agg(m.medida, case m.medida
        when 'qtd' then to_jsonb(a.n)
        when 'chegaram' then to_jsonb(a.n)
        when 'soma' then case when p_valores then to_jsonb(a.soma) else 'null'::jsonb end
        when 'media' then case when p_valores and a.media is not null then to_jsonb(round(a.media)) else 'null'::jsonb end
        when 'prev' then case when p_valores then to_jsonb(a.prev) else 'null'::jsonb end
        when 'conv' then case when a.fechados > 0 then to_jsonb(round(a.ganhos * 100.0 / a.fechados, 1)) else 'null'::jsonb end
        when 'tetapa' then coalesce(to_jsonb(round(a.media_x1, 1)), 'null'::jsonb)
        when 'tfechar' then coalesce(to_jsonb(round(a.tfechar, 1)), 'null'::jsonb)
        when 'sem_prob' then to_jsonb(a.sem_prob)
        when 'tresp' then coalesce(to_jsonb(round(a.p50::numeric)), 'null'::jsonb)
        when 'tresp90' then coalesce(to_jsonb(round(a.p90::numeric)), 'null'::jsonb)
        when 'comp' then case when a.presenca > 0 then to_jsonb(round(a.compareceu * 100.0 / a.presenca, 1)) else 'null'::jsonb end
        when 'resolv' then case when a.n > 0 then to_jsonb(round(a.n_ok * 100.0 / a.n, 1)) else 'null'::jsonb end
        when 'taxa' then case when a.n > 0 then to_jsonb(round(a.n_ok * 100.0 / a.n, 1)) else 'null'::jsonb end
        when 'emdia' then case when a.n > 0 then to_jsonb(round(a.n_ok * 100.0 / a.n, 1)) else 'null'::jsonb end
        when 'aceito' then case when a.n > 0 then to_jsonb(round(a.n_ok * 100.0 / a.n, 1)) else 'null'::jsonb end
        else 'null'::jsonb
      end)
      from unnest(p_medidas) m(medida)
    ), '{}'::jsonb)
  )
  from a;
$f$;

comment on function public.fn_mia_relatorio_medir(public.mia_relatorio_linha[], text[], text, boolean) is
  'MIA (9030): as medidas de um grupo de linhas do motor de relatorios, cada registro uma vez. Dinheiro em centavos, so na moeda da empresa (o resto em fora_da_moeda), nulo quando p_valores e false. Taxas em pontos percentuais (0 a 100); tempos de resposta em segundos; dias com uma casa.';

-- ── 9. o motor ──────────────────────────────────────────────────────────────
create or replace function public.fn_mia_relatorio(
  p_org uuid,
  p_fonte text,
  p_medidas text[],
  p_dim1 text default null,
  p_dim2 text default null,
  p_filtros jsonb default '{}'::jsonb,
  p_periodo text default '30',
  p_de date default null,
  p_ate date default null,
  p_valores boolean default true,
  p_comparar boolean default false,
  p_agora timestamptz default null
) returns jsonb
language plpgsql
stable
set search_path = ''
as $f$
declare
  v_catalogo jsonb := public.fn_mia_relatorio_catalogo();
  v_fonte jsonb := v_catalogo -> p_fonte;
  v_tempo jsonb := v_catalogo -> '_tempo';
  v_com_sem jsonb := v_catalogo -> '_com_sem';
  v_filtros jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_medidas text[];
  v_primeira text;
  v_chave text;
  v_fuso text;
  v_moeda text;
  v_janela jsonb;
  v_inicio timestamptz;
  v_fim timestamptz;
  v_funil uuid;
  v_funil_info jsonb;
  v_linhas public.mia_relatorio_linha[];
  v_total jsonb;
  v_grupos jsonb := '[]'::jsonb;
  v_dobrados text[] := '{}';
  v_series jsonb := null;
  v_series_chaves text[] := null;
  v_series_dobradas text[] := '{}';
  v_universo1 jsonb;
  v_universo2 jsonb;
  v_meta jsonb := null;
  v_soma_real bigint;
  v_alvo numeric;
  v_meses_sem_meta int;
  v_meses int;
  v_anterior jsonb := null;
  v_ant record;
  v_resposta jsonb;
begin
  -- ── quem pergunta ──
  if auth.uid() is not null
     and not public.fn_is_platform_admin()
     and public.fn_user_role_in_org(p_org) is null then
    raise exception 'sem_vinculo_com_a_organizacao' using errcode = '42501';
  end if;

  -- ── o pedido ──
  if v_fonte is null or left(p_fonte, 1) = '_' then
    raise exception 'fonte_desconhecida: %', p_fonte using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct m order by m), '{}') into v_medidas
    from unnest(coalesce(p_medidas, '{}')) m where m is not null;
  if cardinality(v_medidas) = 0 or cardinality(v_medidas) > 6 then
    raise exception 'medidas: de uma a seis' using errcode = '22023';
  end if;
  foreach v_chave in array v_medidas loop
    if not (v_fonte -> 'medidas') ? v_chave then
      raise exception 'medida_desconhecida_para_a_fonte: % em %', v_chave, p_fonte using errcode = '22023';
    end if;
  end loop;
  v_primeira := coalesce(p_medidas[1], v_medidas[1]);
  if p_dim1 is not null and not (v_fonte -> 'dims') ? p_dim1 then
    raise exception 'agrupamento_desconhecido_para_a_fonte: % em %', p_dim1, p_fonte using errcode = '22023';
  end if;
  if p_dim2 is not null and (p_dim1 is null or not (v_fonte -> 'dims') ? p_dim2 or p_dim2 = p_dim1) then
    raise exception 'segundo_agrupamento_invalido: %', p_dim2 using errcode = '22023';
  end if;
  for v_chave in select jsonb_object_keys(v_filtros) loop
    if not (v_fonte -> 'filtros') ? v_chave then
      raise exception 'filtro_desconhecido_para_a_fonte: % em %', v_chave, p_fonte using errcode = '22023';
    end if;
  end loop;
  if 'chegaram' = any(v_medidas)
     and (cardinality(v_medidas) > 1 or p_dim1 is distinct from 'etapa' or p_dim2 is not null) then
    raise exception 'chegaram_so_sozinha_agrupando_por_etapa' using errcode = '22023';
  end if;

  -- Anúncios: o que foi informado à Meta e ao Google é de gestor e
  -- administrador (o piso das telas de Conversões e de Meta Ads).
  if p_fonte = 'anuncios' and auth.uid() is not null
     and not public.fn_is_platform_admin()
     and not public.fn_role_at_least(p_org, 'manager') then
    raise exception 'anuncios_so_para_gestor_ou_administrador' using errcode = '42501';
  end if;

  -- ── a empresa: fuso e moeda ──
  select coalesce(nullif(btrim(o.timezone), ''), 'America/Sao_Paulo'),
         coalesce(nullif(btrim(o.currency), ''), 'BRL')
    into v_fuso, v_moeda
    from public.organizations o
   where o.id = p_org;
  if v_fuso is null then
    raise exception 'organizacao_inexistente' using errcode = '22023';
  end if;

  -- ── o período ──
  v_janela := public.fn_mia_relatorio_janela(v_fuso, p_periodo, p_de, p_ate,
                                             coalesce((v_fonte->>'futuro')::boolean, false), p_agora);
  v_inicio := coalesce((v_janela->>'inicio')::timestamptz, '-infinity'::timestamptz);
  v_fim := coalesce((v_janela->>'fim')::timestamptz, 'infinity'::timestamptz);
  if v_janela->>'periodo' <> 'tudo' then
    if (p_dim1 = 'dia' or p_dim2 = 'dia') and (v_janela->>'dias')::int > 400 then
      raise exception 'agrupar_por_dia_ate_400_dias' using errcode = '22023';
    end if;
    if (p_dim1 = 'semana' or p_dim2 = 'semana') and (v_janela->>'dias')::int > 1830 then
      raise exception 'agrupar_por_semana_ate_cinco_anos' using errcode = '22023';
    end if;
  end if;

  -- ── o funil (negócios por etapa, ou filtrados por funil) ──
  if p_fonte = 'negocios'
     and (p_dim1 = 'etapa' or p_dim2 = 'etapa' or v_filtros ? 'funil') then
    v_funil := nullif(v_filtros->>'funil', '')::uuid;
    if v_funil is null then
      select p.id into v_funil
        from public.crm_pipelines p
       where p.organization_id = p_org and not p.is_archived
       order by p.is_default desc, p.position, p.created_at
       limit 1;
    end if;
    select jsonb_build_object('id', p.id, 'nome', p.name, 'vocabulario', p.vocabulary)
      into v_funil_info
      from public.crm_pipelines p
     where p.id = v_funil and p.organization_id = p_org;
    if v_funil_info is null then
      raise exception 'funil_inexistente' using errcode = '22023';
    end if;
    v_filtros := v_filtros || jsonb_build_object('funil', v_funil::text);
  end if;

  -- ── as linhas ──
  select array_agg(l)
    into v_linhas
    from public.fn_mia_relatorio_linhas(p_org, p_fonte, v_inicio, v_fim, v_filtros, p_agora, v_fuso) l
   where public.fn_mia_relatorio_passa(l.dims, v_filtros);
  v_linhas := coalesce(v_linhas, '{}');

  -- ── o total (cada registro uma vez, mesmo com etiquetas) ──
  v_total := public.fn_mia_relatorio_medir(v_linhas, v_medidas, v_moeda, p_valores);

  -- ── "chegaram até a etapa": o funil ──
  if 'chegaram' = any(v_medidas) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'chave', s.id::text,
             'rotulo', s.name,
             'ordem', s.position,
             'sem', false,
             'outros', false,
             'n', x.n,
             'n_ok', 0,
             'valores', jsonb_build_object('chegaram', x.n),
             'ganho', s.is_won
           ) order by s.position, s.name), '[]'::jsonb)
      into v_grupos
      from public.crm_stages s
      cross join lateral (
        select count(distinct u.registro)::bigint as n
          from unnest(v_linhas) u
         where u.x3 >= s.position
      ) x
     where s.pipeline_id = v_funil and s.organization_id = p_org
       and not s.is_archived and not s.is_lost;
  elsif p_dim1 is not null then
    -- O universo: as chaves que aparecem mesmo com zero.
    v_universo1 := case
      when v_tempo ? p_dim1 and v_janela->>'periodo' <> 'tudo' then (
        select jsonb_agg(to_char(g, case p_dim1 when 'mes' then 'YYYY-MM' else 'YYYY-MM-DD' end) order by g)
          from generate_series(
                 case p_dim1 when 'mes' then date_trunc('month', (v_janela->>'de')::date)
                             when 'semana' then date_trunc('week', (v_janela->>'de')::date)
                             else (v_janela->>'de')::date end,
                 (v_janela->>'ate')::date,
                 case p_dim1 when 'mes' then interval '1 month' when 'semana' then interval '1 week'
                             else interval '1 day' end) g)
      when p_dim1 = 'etapa' then (
        select jsonb_agg(s.id::text order by s.position, s.name)
          from public.crm_stages s
         where s.pipeline_id = v_funil and s.organization_id = p_org and not s.is_archived)
      else coalesce(v_catalogo -> '_naturais' -> (p_fonte || '.' || p_dim1), '[]'::jsonb)
    end;
    if v_com_sem ? p_dim1 then
      v_universo1 := coalesce(v_universo1, '[]'::jsonb) || '["__sem"]'::jsonb;
    end if;

    -- Os grupos do primeiro agrupamento.
    with e as (
      select u as linha, k
        from unnest(v_linhas) u
        cross join lateral public.fn_mia_relatorio_chaves(u.dims, u.momento, p_dim1, v_fuso) k
    ),
    todas as (
      select k from e
      union
      select jsonb_array_elements_text(coalesce(v_universo1, '[]'::jsonb))
    ),
    g as (
      select t.k,
             public.fn_mia_relatorio_medir(
               coalesce(array_agg(e.linha) filter (where e.k is not null), '{}'),
               v_medidas, v_moeda, p_valores) as m,
             max((e.linha).rotulos ->> p_dim1) as rotulo,
             max(((e.linha).rotulos ->> 'ordem_etapa')::numeric) filter (where p_dim1 = 'etapa') as ordem
        from todas t
        left join e on e.k = t.k
       group by t.k
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'chave', g.k,
             'rotulo', g.rotulo,
             'ordem', g.ordem,
             'sem', g.k = '__sem',
             'outros', false,
             'n', (g.m->>'n')::bigint,
             'n_ok', (g.m->>'n_ok')::bigint,
             'valores', g.m->'valores'
           )), '[]'::jsonb)
      into v_grupos
      from g;

    -- Etapa: o nome e a posição de quem não teve linha nenhuma.
    if p_dim1 = 'etapa' then
      select coalesce(jsonb_agg(
               x || jsonb_build_object('rotulo', coalesce(x->>'rotulo', s.name), 'ordem', s.position)
             ), '[]'::jsonb)
        into v_grupos
        from jsonb_array_elements(v_grupos) x
        left join public.crm_stages s
          on s.id::text = x->>'chave' and s.organization_id = p_org;
    end if;

    -- Mais de 12 grupos, num agrupamento sem ordem própria: os 11 maiores
    -- ficam, o "Sem …" fica sempre, e o resto vira "Outros" — recalculado sobre
    -- as linhas, nunca somado (mediana e taxa não se somam).
    if not (v_tempo ? p_dim1)
       and not (v_catalogo -> '_naturais' ? (p_fonte || '.' || p_dim1))
       and not (v_catalogo -> '_ordenados_pela_chave' ? p_dim1)
       and p_dim1 <> 'etapa'
       and jsonb_array_length(v_grupos) > 12 then
      with ranq as (
        select x->>'chave' as k,
               row_number() over (
                 order by ((x->'valores'->>v_primeira)::numeric) desc nulls last,
                          (x->>'n')::bigint desc,
                          coalesce(x->>'rotulo', x->>'chave')) as rn
          from jsonb_array_elements(v_grupos) x
         where x->>'chave' <> '__sem'
      ),
      sem as (
        select count(*)::int as n from jsonb_array_elements(v_grupos) x where x->>'chave' = '__sem'
      )
      select coalesce(array_agg(r.k), '{}')
        into v_dobrados
        from ranq r, sem
       where r.rn > 11 - sem.n;

      if cardinality(v_dobrados) > 0 then
        select v_grupos_sem.lista || jsonb_build_array(jsonb_build_object(
                 'chave', '__outros',
                 'rotulo', null,
                 'ordem', null,
                 'sem', false,
                 'outros', true,
                 'quantos', cardinality(v_dobrados),
                 'n', (o.m->>'n')::bigint,
                 'n_ok', (o.m->>'n_ok')::bigint,
                 'valores', o.m->'valores'
               ))
          into v_grupos
          from (
            select coalesce(jsonb_agg(x), '[]'::jsonb) as lista
              from jsonb_array_elements(v_grupos) x
             where not (x->>'chave' = any(v_dobrados))
          ) v_grupos_sem,
          lateral (
            select public.fn_mia_relatorio_medir(coalesce(array_agg(u), '{}'), v_medidas, v_moeda, p_valores) as m
              from unnest(v_linhas) u
             where exists (
               select 1 from public.fn_mia_relatorio_chaves(u.dims, u.momento, p_dim1, v_fuso) k
                where k = any(v_dobrados))
          ) o;
      end if;
    end if;

    -- A ordem: tempo e "pela chave" em ordem crescente; etapa pela posição;
    -- naturais pela ordem do catálogo; o resto pelo tamanho. "Outros" e "Sem …"
    -- por último, nesta ordem.
    select coalesce(jsonb_agg(x order by
             (x->>'chave' = '__sem'),
             (x->>'chave' = '__outros'),
             case when p_dim1 = 'etapa' then (x->>'ordem')::numeric end,
             case when v_catalogo -> '_naturais' ? (p_fonte || '.' || p_dim1)
                  then (select i from jsonb_array_elements_text(v_catalogo -> '_naturais' -> (p_fonte || '.' || p_dim1))
                                 with ordinality n(v, i) where n.v = x->>'chave') end,
             case when v_tempo ? p_dim1 or v_catalogo -> '_ordenados_pela_chave' ? p_dim1
                  then x->>'chave' end,
             ((x->'valores'->>v_primeira)::numeric) desc nulls last,
             (x->>'n')::bigint desc,
             coalesce(x->>'rotulo', x->>'chave')
           ), '[]'::jsonb)
      into v_grupos
      from jsonb_array_elements(v_grupos) x;

    -- ── o segundo agrupamento: as séries ──
    if p_dim2 is not null then
      v_universo2 := case
        when v_tempo ? p_dim2 then '[]'::jsonb
        when p_dim2 = 'etapa' then (
          select jsonb_agg(s.id::text order by s.position, s.name)
            from public.crm_stages s
           where s.pipeline_id = v_funil and s.organization_id = p_org and not s.is_archived)
        else coalesce(v_catalogo -> '_naturais' -> (p_fonte || '.' || p_dim2), '[]'::jsonb)
      end;
      -- As séries que ficam: até 8 (7 maiores + "Outros"); "Sem …" sempre.
      with e2 as (
        select distinct u.registro, k2
          from unnest(v_linhas) u
          cross join lateral public.fn_mia_relatorio_chaves(u.dims, u.momento, p_dim2, v_fuso) k2
      ),
      contagem as (
        select k2, count(*) as n from e2 group by k2
        union all
        select jsonb_array_elements_text(coalesce(v_universo2, '[]'::jsonb)), 0
      ),
      somadas as (
        select k2, sum(n) as n from contagem group by k2
      ),
      ranq as (
        select k2, n, row_number() over (order by n desc, k2) as rn from somadas where k2 <> '__sem'
      )
      select
        coalesce(array_agg(k2) filter (where k2 = '__sem' or not (
          (select count(*) from somadas) > 8
          and not (v_tempo ? p_dim2)
          and not (v_catalogo -> '_naturais' ? (p_fonte || '.' || p_dim2))
          and p_dim2 <> 'etapa'
          and coalesce((select rn from ranq r where r.k2 = s.k2), 0) > 7 - (select count(*) from somadas where k2 = '__sem')
        )), '{}'),
        coalesce(array_agg(k2) filter (where k2 <> '__sem' and (
          (select count(*) from somadas) > 8
          and not (v_tempo ? p_dim2)
          and not (v_catalogo -> '_naturais' ? (p_fonte || '.' || p_dim2))
          and p_dim2 <> 'etapa'
          and coalesce((select rn from ranq r where r.k2 = s.k2), 0) > 7 - (select count(*) from somadas where k2 = '__sem')
        )), '{}')
        into v_series_chaves, v_series_dobradas
        from somadas s;

      -- As células: cada grupo final × cada série final.
      with e as (
        select u as linha,
               case when k1 = any(v_dobrados) then '__outros' else k1 end as k1,
               case when k2 = any(v_series_dobradas) then '__outros' else k2 end as k2
          from unnest(v_linhas) u
          cross join lateral public.fn_mia_relatorio_chaves(u.dims, u.momento, p_dim1, v_fuso) k1
          cross join lateral public.fn_mia_relatorio_chaves(u.dims, u.momento, p_dim2, v_fuso) k2
      ),
      celulas as (
        select e.k1, e.k2,
               public.fn_mia_relatorio_medir(array_agg(e.linha), v_medidas, v_moeda, p_valores) as m,
               max((e.linha).rotulos ->> p_dim2) as rotulo2
          from e
         group by e.k1, e.k2
      ),
      por_grupo as (
        select c.k1, jsonb_object_agg(c.k2, jsonb_build_object(
                 'n', (c.m->>'n')::bigint, 'n_ok', (c.m->>'n_ok')::bigint, 'valores', c.m->'valores')) as series
          from celulas c
         group by c.k1
      )
      select coalesce(jsonb_agg(x || jsonb_build_object('series', coalesce(pg.series, '{}'::jsonb))
               order by n.i), '[]'::jsonb)
        into v_grupos
        from jsonb_array_elements(v_grupos) with ordinality n(x, i)
        left join por_grupo pg on pg.k1 = n.x->>'chave';

      -- A lista das séries, na ordem: natural, tempo e pela chave crescentes; o
      -- resto pelo tamanho; "Outros" e "Sem …" por último.
      with e2 as (
        select distinct u.registro,
               case when k2 = any(v_series_dobradas) then '__outros' else k2 end as k2,
               (u.rotulos ->> p_dim2) as rotulo
          from unnest(v_linhas) u
          cross join lateral public.fn_mia_relatorio_chaves(u.dims, u.momento, p_dim2, v_fuso) k2
      ),
      lista as (
        select k as k2 from unnest(v_series_chaves) k
        union
        select '__outros' where cardinality(v_series_dobradas) > 0
      ),
      info as (
        select l.k2, count(distinct e2.registro) as n, max(e2.rotulo) as rotulo
          from lista l left join e2 on e2.k2 = l.k2
         group by l.k2
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'chave', i.k2,
               'rotulo', coalesce(i.rotulo, case when p_dim2 = 'etapa' then
                           (select s.name from public.crm_stages s where s.id::text = i.k2 and s.organization_id = p_org) end),
               'sem', i.k2 = '__sem',
               'outros', i.k2 = '__outros',
               'quantos', case when i.k2 = '__outros' then cardinality(v_series_dobradas) end,
               'n', i.n
             ) order by
               (i.k2 = '__sem'), (i.k2 = '__outros'),
               case when p_dim2 = 'etapa' then
                 (select s.position from public.crm_stages s where s.id::text = i.k2 and s.organization_id = p_org) end,
               case when v_catalogo -> '_naturais' ? (p_fonte || '.' || p_dim2)
                    then (select o from jsonb_array_elements_text(v_catalogo -> '_naturais' -> (p_fonte || '.' || p_dim2))
                                   with ordinality q(v, o) where q.v = i.k2) end,
               case when v_tempo ? p_dim2 or v_catalogo -> '_ordenados_pela_chave' ? p_dim2 then i.k2 end,
               i.n desc,
               i.k2), '[]'::jsonb)
        into v_series
        from info i;
    end if;
  end if;

  -- ── a meta (soma dos ganhos) ──
  --
  -- A meta é de faturamento: só faz sentido na soma do valor dos ganhos
  -- (decisão do protótipo). Em "Este mês" vale a meta do mês inteiro, e o bloco
  -- diz quanto do mês já correu; nos outros períodos a meta é proporcional aos
  -- dias de cada mês que o período toca. É a meta da empresa inteira
  -- (`sales_targets`, receita_total, sem pessoa nem agente). A fração usa o
  -- realizado mesmo quando o dinheiro não sai (`p_valores = false`): a pessoa
  -- vê "62% da meta" sem ver nem o alvo nem o realizado.
  if p_fonte = 'negocios' and 'soma' = any(v_medidas)
     and v_filtros->>'situacao' = 'ganho' and v_janela->>'periodo' <> 'tudo' then
    select coalesce(sum(r.valor_cents), 0)
      into v_soma_real
      from (select distinct on (u.registro) u.* from unnest(v_linhas) u order by u.registro) r
     where coalesce(r.moeda, v_moeda) = v_moeda;

    select
      case when v_janela->>'periodo' = 'mes' then max(a.alvo_cents)::numeric
           else sum(a.alvo_cents::numeric * a.dias_no_periodo / a.dias_do_mes) end,
      count(*) filter (where a.alvo_cents is null),
      count(*)
      into v_alvo, v_meses_sem_meta, v_meses
      from (
        select me.mes,
               t.alvo_cents,
               ((me.mes + interval '1 month')::date - me.mes) as dias_do_mes,
               (least((v_janela->>'ate')::date, (me.mes + interval '1 month' - interval '1 day')::date)
                - greatest((v_janela->>'de')::date, me.mes) + 1) as dias_no_periodo
          from (
            select date_trunc('month', g)::date as mes
              from generate_series(date_trunc('month', (v_janela->>'de')::date),
                                   (v_janela->>'ate')::date, interval '1 month') g
          ) me
          left join public.sales_targets t
            on t.organization_id = p_org and t.periodo = me.mes and t.metrica = 'receita_total'
           and t.user_id is null and t.agent_id is null
      ) a;

    -- Sem nenhuma meta cadastrada no período, não há meta: o bloco sai nulo.
    if v_alvo is not null and v_alvo > 0 then
      v_meta := jsonb_build_object(
        'alvo_cents', case when p_valores then round(v_alvo) end,
        'proporcional', v_janela->>'periodo' <> 'mes',
        'meses_sem_meta', v_meses_sem_meta,
        'fracao', round(v_soma_real::numeric / v_alvo, 4),
        'corrido', case when v_janela->>'periodo' = 'mes' then
                     round((((v_janela->>'hoje')::date - (v_janela->>'de')::date + 1)::numeric)
                           / (((v_janela->>'de')::date + interval '1 month')::date - (v_janela->>'de')::date), 4)
                   end
      );
    end if;
  end if;

  -- ── o período anterior ──
  if p_comparar and v_janela->>'periodo' <> 'tudo' then
    select * into v_ant from public.fn_mia_relatorio_janela_anterior(v_janela);
    if v_ant.de is not null then
      v_anterior := public.fn_mia_relatorio(
        p_org, p_fonte, v_medidas, p_dim1, null,
        v_filtros, 'pers', v_ant.de, v_ant.ate, p_valores, false, p_agora);
      v_anterior := jsonb_build_object(
        'janela', v_anterior->'janela',
        'total', v_anterior->'total',
        'grupos', coalesce((
          select jsonb_object_agg(x->>'chave', jsonb_build_object('n', x->'n', 'valores', x->'valores'))
            from jsonb_array_elements(v_anterior->'grupos') x), '{}'::jsonb)
      );
    end if;
  end if;

  v_resposta := jsonb_build_object(
    'fonte', p_fonte,
    'medidas', to_jsonb(v_medidas),
    'dim1', p_dim1,
    'dim2', p_dim2,
    'filtros', v_filtros,
    'janela', v_janela,
    'moeda', v_moeda,
    'valores', p_valores,
    'total', jsonb_build_object('n', (v_total->>'n')::bigint, 'n_ok', (v_total->>'n_ok')::bigint,
                                'valores', v_total->'valores'),
    'fora_da_moeda', (v_total->>'fora_da_moeda')::bigint,
    'grupos', v_grupos,
    'series', v_series,
    'dobrados', to_jsonb(v_dobrados),
    'funil', v_funil_info,
    'meta', v_meta,
    'anterior', v_anterior
  );
  return v_resposta;
end;
$f$;

comment on function public.fn_mia_relatorio(uuid, text, text[], text, text, jsonb, text, date, date, boolean, boolean, timestamptz) is
  'MIA (9030): o motor de conta dos paineis prontos e do montador de relatorios. Fonte + medidas (1 a 6) + ate dois agrupamentos + filtros + periodo, somados no banco (sem o teto de 1000 linhas), no fuso e na moeda da empresa, com a regra de data do prototipo. security invoker: cada um ve o que a RLS ja deixa ver; quem nao e membro da organizacao e recusado (42501); a plataforma (service_role) chama com a organizacao resolvida no servidor. p_valores = false esconde o dinheiro.';

-- ── 10. quem executa ────────────────────────────────────────────────────────
--
-- As DUAS origens de EXECUTE fechadas para anon (o default privileges do
-- baseline, que dá direto; o grant a PUBLIC do Postgres, que ele herda). Quem
-- usa é a sessão do cliente (a tela) e a plataforma (o link do dono e o MCP).
revoke all on function public.fn_mia_relatorio_catalogo() from public;
revoke execute on function public.fn_mia_relatorio_catalogo() from anon;
grant execute on function public.fn_mia_relatorio_catalogo() to authenticated, service_role;

revoke all on function public.fn_mia_relatorio_janela(text, text, date, date, boolean, timestamptz) from public;
revoke execute on function public.fn_mia_relatorio_janela(text, text, date, date, boolean, timestamptz) from anon;
grant execute on function public.fn_mia_relatorio_janela(text, text, date, date, boolean, timestamptz) to authenticated, service_role;

revoke all on function public.fn_mia_relatorio_janela_anterior(jsonb) from public;
revoke execute on function public.fn_mia_relatorio_janela_anterior(jsonb) from anon;
grant execute on function public.fn_mia_relatorio_janela_anterior(jsonb) to authenticated, service_role;

revoke all on function public.fn_mia_obrigacao_situacao(text, date, date, date, date, date, integer[], date) from public;
revoke execute on function public.fn_mia_obrigacao_situacao(text, date, date, date, date, date, integer[], date) from anon;
grant execute on function public.fn_mia_obrigacao_situacao(text, date, date, date, date, date, integer[], date) to authenticated, service_role;

revoke all on function public.fn_mia_relatorio_linhas(uuid, text, timestamptz, timestamptz, jsonb, timestamptz, text) from public;
revoke execute on function public.fn_mia_relatorio_linhas(uuid, text, timestamptz, timestamptz, jsonb, timestamptz, text) from anon;
grant execute on function public.fn_mia_relatorio_linhas(uuid, text, timestamptz, timestamptz, jsonb, timestamptz, text) to authenticated, service_role;

revoke all on function public.fn_mia_relatorio_chaves(jsonb, timestamptz, text, text) from public;
revoke execute on function public.fn_mia_relatorio_chaves(jsonb, timestamptz, text, text) from anon;
grant execute on function public.fn_mia_relatorio_chaves(jsonb, timestamptz, text, text) to authenticated, service_role;

revoke all on function public.fn_mia_relatorio_passa(jsonb, jsonb) from public;
revoke execute on function public.fn_mia_relatorio_passa(jsonb, jsonb) from anon;
grant execute on function public.fn_mia_relatorio_passa(jsonb, jsonb) to authenticated, service_role;

revoke all on function public.fn_mia_relatorio_medir(public.mia_relatorio_linha[], text[], text, boolean) from public;
revoke execute on function public.fn_mia_relatorio_medir(public.mia_relatorio_linha[], text[], text, boolean) from anon;
grant execute on function public.fn_mia_relatorio_medir(public.mia_relatorio_linha[], text[], text, boolean) to authenticated, service_role;

revoke all on function public.fn_mia_relatorio(uuid, text, text[], text, text, jsonb, text, date, date, boolean, boolean, timestamptz) from public;
revoke execute on function public.fn_mia_relatorio(uuid, text, text[], text, text, jsonb, text, date, date, boolean, boolean, timestamptz) from anon;
grant execute on function public.fn_mia_relatorio(uuid, text, text[], text, text, jsonb, text, date, date, boolean, boolean, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
