/**
 * FORK MIA — as CONVERSÕES de um cliente, pelas ferramentas do MCP de plataforma
 * (docs/fork/conversoes-da-meta.md e docs/fork/mcp-de-implantacao.md).
 *
 * ── O caminho da tela que isto usa ────────────────────────────────────────
 *
 *   regras da Meta      `gravarRegrasDeConversaoMeta`
 *                       (`lib/conversoes/gravar-regras-meta.ts`), o miolo tirado
 *                       da ação `salvarRegrasDeConversaoMeta` do upstream (0524):
 *                       desde a .72 a régua da Meta é a DELE, na tabela dele
 *                       (`meta_ads_conversion_rules`)
 *   regras do Google    `gravarRegrasDeConversaoGoogle`
 *                       (`lib/conversoes/gravar-regras-google.ts`), o miolo tirado
 *                       da ação `salvarRegrasDeConversaoGoogle`
 *   leads de formulário `definirChaveDeFormulario` (`lib/conversoes-meta/config.ts`)
 *   diagnóstico         `diagnosticarConexaoDaMeta`
 *
 * ── Montar não é ligar ────────────────────────────────────────────────────
 *
 * GARANTIR grava a regra DESLIGADA e nunca mexe no "ligada": é montagem
 * (`implantar_configuracao`). LIGAR faz o sistema passar a mandar evento de
 * cliente para a plataforma de anúncio, e é `colocar_no_ar`. Regra ligada não é
 * editada por aqui (a mudança valeria no próximo negócio): desliga, ajusta e
 * religa. É a mesma separação das automações.
 *
 * ── O que NÃO entra ───────────────────────────────────────────────────────
 *
 * Credencial. O identificador do destino de conversões e o token da Meta, e a
 * autorização do Google, continuam só pela tela (Configurações › Conversões).
 * Nenhuma função daqui recebe, lê para devolver, nem registra token.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { lerEstadoDaConexao, MOTIVO_LEGIVEL } from "@/lib/conversoes/estado-da-conexao";
import { gravarRegrasDeConversaoGoogle, type RegraGoogleParaGravar } from "@/lib/conversoes/gravar-regras-google";
import { gravarRegrasDeConversaoMeta, type RegraMetaParaGravar } from "@/lib/conversoes/gravar-regras-meta";
import { situacaoDaLinha } from "@/lib/conversoes/historico";
import {
  eventoDaEtapa,
  listarRegrasGoogle,
  VALORES_DE_CATEGORIA,
  type CanalDeEntrada,
  type CategoriaDeConversao,
  type RegraDeConversaoGoogle,
} from "@/lib/conversoes/regras-google";
import {
  eventoDaEtapaMeta,
  eventoRecomendadoParaMeta,
  EVENTOS_DA_META,
  listarRegrasMeta,
  rotuloDoEventoDaMeta,
  type EventoDaMeta,
  type RegraDeConversaoMeta,
} from "@/lib/conversoes/regras-meta";
import { definirChaveDeFormulario, lerChaveDeFormulario, type QuemSalva } from "@/lib/conversoes-meta/config";
import { diagnosticarConexaoDaMeta, diagnosticoEmFrases } from "@/lib/conversoes-meta/diagnostico";
import { VEREDITO_DO_DIAGNOSTICO } from "@/lib/conversoes-meta/diagnostico-frases";
import { rotuloDoEnvioDaMeta } from "@/lib/conversoes-meta/rotulo";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { lerEstadoDaConexaoGoogle } from "@/lib/plataformas-de-anuncio/google/estado-da-conexao";
import { lerIdentidadeDaMeta } from "@/lib/plataformas-de-anuncio/meta/identidade";

import { acharPorNomeOuId, type Desfecho, type Implantacao } from "./base";

const quem = (c: Implantacao): QuemSalva => ({
  organizationId: c.orgId,
  autorUserId: c.autorUserId,
  requestId: c.requestId,
  via: "mcp_plataforma",
});

/** Como a situação do livro-razão (a do upstream) é dita a quem não vê a tela. */
const ROTULO_DA_SITUACAO: Record<ReturnType<typeof situacaoDaLinha>, string> = {
  todas: "todas",
  entregue: "Enviado",
  falha: "Recusado pela plataforma",
  aguardando: "Aguardando",
  nao_enviado: "Não enviado",
};

// ── Os funis ────────────────────────────────────────────────────────────────

export interface FunilDaRegua {
  id: string;
  nome: string;
  /** As etapas ABERTAS, na ordem do funil. A primeira é onde o negócio nasce. */
  etapas: Array<{ id: string; nome: string }>;
  /** Os nomes das etapas de ganho e de perda: ficam fora da régua, e a resposta diz por quê. */
  ganho: string[];
  perda: string[];
}

/**
 * Os funis vivos da organização com as etapas na ordem. Ganho é a compra e
 * perda não é conversão: nenhuma das duas é etapa da régua.
 */
async function lerFunisDaRegua(admin: SupabaseClient, organizationId: string): Promise<FunilDaRegua[]> {
  const [funis, etapas] = await Promise.all([
    admin
      .from("crm_pipelines")
      .select("id, name, position, is_archived")
      .eq("organization_id", organizationId)
      .order("position"),
    admin
      .from("crm_stages")
      .select("id, name, pipeline_id, position, is_won, is_lost, is_archived")
      .eq("organization_id", organizationId)
      .order("position"),
  ]);
  if (funis.error || etapas.error) throw new Error("Não foi possível ler os funis da organização.");

  type Etapa = {
    id: string;
    name: string;
    pipeline_id: string;
    is_won: boolean;
    is_lost: boolean;
    is_archived?: boolean | null;
  };
  const dasEtapas = ((etapas.data ?? []) as Etapa[]).filter((e) => e.is_archived !== true);

  return ((funis.data ?? []) as Array<{ id: string; name: string; is_archived?: boolean | null }>)
    .filter((f) => f.is_archived !== true)
    .map((f) => {
      const doFunil = dasEtapas.filter((e) => e.pipeline_id === f.id);
      return {
        id: f.id,
        nome: f.name,
        etapas: doFunil.filter((e) => !e.is_won && !e.is_lost).map((e) => ({ id: e.id, nome: e.name })),
        ganho: doFunil.filter((e) => e.is_won).map((e) => e.name),
        perda: doFunil.filter((e) => e.is_lost).map((e) => e.name),
      };
    });
}

async function funilDaRegua(c: Implantacao, referencia: string): Promise<FunilDaRegua> {
  const funis = await lerFunisDaRegua(c.admin, c.orgId);
  const funil = acharPorNomeOuId(funis, referencia, (f) => f.nome, {
    singular: "o funil",
    comoListar: "Veja os funis em plataforma_ver_conversoes ou plataforma_ver_funis.",
  });
  if (funil.etapas.length === 0) {
    throw new Recusa(
      `O funil «${funil.nome}» não tem etapa aberta. Conversão por etapa só existe em etapa aberta: ` +
        "ganho é a compra e perda não é conversão. Crie as etapas com plataforma_garantir_funil.",
    );
  }
  return funil;
}

function etapaDoFunil(funil: FunilDaRegua, referencia: string): { id: string; nome: string } {
  const fechada = [...funil.ganho, ...funil.perda].find(
    (nome) => nome.trim().toLowerCase() === referencia.trim().toLowerCase(),
  );
  if (fechada) {
    throw new Recusa(
      `«${fechada}» é etapa de ganho ou de perda do funil «${funil.nome}» e não entra na régua. ` +
        "Ganho é a compra (a plataforma recebe a venda quando o negócio é ganho) e perda não é conversão.",
    );
  }
  return acharPorNomeOuId(funil.etapas, referencia, (e) => e.nome, {
    singular: `a etapa aberta do funil «${funil.nome}»`,
    comoListar: "Confira os nomes em plataforma_ver_conversoes.",
  });
}

function regraDaMetaEmTexto(r: Pick<RegraDeConversaoMeta, "enabled" | "metaEvent">): Record<string, unknown> {
  return { ligada: r.enabled, evento: r.metaEvent, evento_rotulo: rotuloDoEventoDaMeta(r.metaEvent) };
}

// ── LER ─────────────────────────────────────────────────────────────────────

/**
 * As conversões de um cliente: as conexões SEM segredo, as regras por funil das
 * duas plataformas, a chave dos formulários e os últimos envios.
 */
export async function verConversoes(c: Implantacao, demonstracao: boolean): Promise<Record<string, unknown>> {
  const semana = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [meta, google, funis, regrasMeta, regrasGoogle, chave, identidade, envios, recusas] = await Promise.all([
    lerEstadoDaConexao(c.admin, c.orgId, "meta_ads"),
    lerEstadoDaConexaoGoogle(c.admin, c.orgId),
    lerFunisDaRegua(c.admin, c.orgId),
    listarRegrasMeta(c.admin, c.orgId),
    listarRegrasGoogle(c.admin, c.orgId),
    lerChaveDeFormulario(c.admin, c.orgId),
    // Upstream 1.70 (#2197): a Página ou a conta do WhatsApp Business que a Meta
    // cobra na venda vinda de anúncio clique-para-WhatsApp. A mesma leitura do envio.
    lerIdentidadeDaMeta(c.admin, c.orgId),
    c.admin
      .from("ad_conversion_dispatches")
      .select("lead_id, platform, event_name, meta_event_name, status, reason, detail, value_cents, attempted_at")
      .eq("organization_id", c.orgId)
      .order("attempted_at", { ascending: false })
      .limit(20),
    c.admin
      .from("ad_conversion_dispatches")
      .select("id, attempted_at")
      .eq("organization_id", c.orgId)
      .eq("status", "error")
      .order("attempted_at", { ascending: false })
      .limit(200),
  ]);
  if (envios.error) throw new Error(`não consegui ler os envios: ${envios.error.message}`);
  if (recusas.error) throw new Error(`não consegui ler as recusas: ${recusas.error.message}`);

  const metaPorEtapa = new Map(regrasMeta.map((r) => [r.stageId, r]));
  const googlePorEtapa = new Map(regrasGoogle.map((r) => [r.stageId, r]));
  const rotuloNoGoogle = new Map(regrasGoogle.map((r) => [r.eventName, r.label]));

  return {
    conexoes: {
      meta: {
        conectada: meta.conectada && Boolean(meta.datasetId) && meta.temToken,
        destino_de_conversoes: meta.datasetId,
        tem_token: meta.temToken,
        envio_ligado: meta.habilitada,
        modo_de_teste: Boolean(meta.testEventCode),
      },
      google: {
        conectada: google.temRefreshToken && Boolean(google.customerId),
        conta: google.customerId,
        envio_ligado: google.habilitada,
        tem_acao_de_venda: Boolean(google.conversionActionId),
      },
      // Identificador, não segredo: aparece aqui para o implantador saber se
      // falta. Quem preenche é a pessoa, junto da credencial.
      identidade_da_meta: {
        pagina_id: identidade.pageId,
        conta_do_whatsapp_business_id: identidade.whatsappBusinessAccountId,
        preenchida: identidade.pageId !== null || identidade.whatsappBusinessAccountId !== null,
        para_que:
          "A Meta recusa a venda vinda de anúncio clique-para-WhatsApp sem o ID da Página ou o da conta do WhatsApp Business. " +
          "Uma pessoa preenche em Configurações › Conversões, no cartão da identidade da Meta.",
      },
      como_conectar:
        "Credencial não entra por ferramenta: uma pessoa preenche em Configurações › Conversões (/app/settings/conversoes).",
    },
    leads_de_formulario_da_meta: { ligada: chave.ligada, desde: chave.desde },
    funis: funis.map((f) => ({
      id: f.id,
      funil: f.nome,
      etapas: f.etapas.map((e) => {
        const daMeta = metaPorEtapa.get(e.id);
        const doGoogle = googlePorEtapa.get(e.id);
        return {
          id: e.id,
          etapa: e.nome,
          meta: daMeta ? regraDaMetaEmTexto(daMeta) : null,
          recomendado_para_a_meta: eventoRecomendadoParaMeta(e.nome),
          google: doGoogle
            ? {
                ligada: doGoogle.enabled,
                nome: doGoogle.label,
                acao_de_conversao_id: doGoogle.googleActionId,
                categoria: doGoogle.category,
                canal: doGoogle.channel,
                incluir_em_conversoes: doGoogle.includedInConversions,
              }
            : null,
        };
      }),
      etapas_de_ganho: f.ganho,
      etapas_de_perda: f.perda,
    })),
    eventos_da_meta: EVENTOS_DA_META.map((e) => ({ evento: e.valor, rotulo: e.rotulo })),
    categorias_do_google: VALORES_DE_CATEGORIA,
    ultimos_envios: ((envios.data ?? []) as Array<Record<string, unknown>>).map((l) => {
      const situacao = situacaoDaLinha(String(l.status), (l.reason as string | null) ?? null);
      const evento = String(l.event_name);
      const motivo = (l.reason as string | null) ?? null;
      return {
        negocio_id: l.lead_id,
        plataforma: l.platform,
        evento:
          rotuloDoEnvioDaMeta(evento, (l.meta_event_name as string | null) ?? null) ??
          rotuloNoGoogle.get(evento) ??
          (evento === "QualifiedLead" ? "Lead qualificado" : evento),
        situacao: ROTULO_DA_SITUACAO[situacao],
        motivo:
          situacao === "falha"
            ? ((l.detail as string | null) ?? motivo)
            : motivo
              ? (MOTIVO_LEGIVEL[motivo] ?? motivo)
              : null,
        valor_centavos: l.value_cents,
        quando: l.attempted_at,
      };
    }),
    recusados_em_7_dias: ((recusas.data ?? []) as Array<{ attempted_at: string }>).filter(
      (l) => l.attempted_at >= semana,
    ).length,
    ...(demonstracao
      ? { empresa_de_demonstracao: "Esta é a empresa de demonstração: as regras podem ser montadas e ligadas, e nada é enviado." }
      : {}),
  };
}

// ── GARANTIR as regras da Meta ──────────────────────────────────────────────

export interface PedidoDeRegrasDaMeta {
  funil: string;
  usar_recomendado?: boolean;
  regras?: Array<{ etapa: string; evento: EventoDaMeta }>;
}

/** A lista INTEIRA que a gravação da Meta pede (a tela do upstream manda todas), a partir do que já existe. */
function listaInteiraDaMeta(existentes: readonly RegraDeConversaoMeta[]): Map<string, RegraMetaParaGravar> {
  return new Map(
    existentes.map((r) => [r.stageId, { stage_id: r.stageId, enabled: r.enabled, meta_event: r.metaEvent }]),
  );
}

async function gravarMeta(c: Implantacao, lista: Map<string, RegraMetaParaGravar>): Promise<void> {
  const gravado = await gravarRegrasDeConversaoMeta(
    c.admin,
    { organizationId: c.orgId, autorUserId: c.autorUserId },
    [...lista.values()],
  );
  if (!gravado.ok) {
    throw new Recusa(
      gravado.error === "etapa_invalida"
        ? "Uma das etapas não existe mais ou foi fechada. Nada foi gravado. Confira em plataforma_ver_conversoes."
        : "Não consegui gravar as regras da Meta. Tente de novo.",
    );
  }
  void audit({
    action: "meta_ads_conversion_rules.updated",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "meta_ads_conversion_rules",
    resourceId: null,
    requestId: c.requestId,
    metadata: { ligadas: gravado.ligadas, desligadas: gravado.desligadas, via: "mcp_plataforma" },
  });
}

/**
 * A regra da Meta que nasce DESLIGADA: a gravação compartilhada (a do upstream)
 * não cria linha para etapa desligada que nunca existiu, e a ferramenta precisa
 * da linha para guardar o evento até alguém ligar. O `event_name` é o mesmo que a
 * gravação daria (`MetaEtapa:<uuid>`), então ligar depois não muda de nome.
 */
async function criarRegrasDesligadasDaMeta(
  c: Implantacao,
  lista: Map<string, RegraMetaParaGravar>,
  existentes: readonly RegraDeConversaoMeta[],
): Promise<void> {
  const jaExistiam = new Set(existentes.map((r) => r.stageId));
  const linhas = [...lista.values()]
    .filter((r) => !r.enabled && !jaExistiam.has(r.stage_id))
    .map((r) => ({
      organization_id: c.orgId,
      stage_id: r.stage_id,
      event_name: eventoDaEtapaMeta(r.stage_id),
      meta_event: r.meta_event,
      enabled: false,
      updated_by: c.autorUserId,
    }));
  if (linhas.length === 0) return;
  const { error } = await c.admin
    .from("meta_ads_conversion_rules")
    .upsert(linhas, { onConflict: "organization_id,stage_id" });
  if (error) throw new Error(`não consegui gravar as regras da Meta: ${error.message}`);
  void audit({
    action: "meta_ads_conversion_rules.updated",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "meta_ads_conversion_rules",
    resourceId: null,
    requestId: c.requestId,
    metadata: { ligadas: 0, desligadas: linhas.length, via: "mcp_plataforma" },
  });
}

export async function garantirConversoesDaMeta(c: Implantacao, pedido: PedidoDeRegrasDaMeta) {
  if (!pedido.usar_recomendado && (pedido.regras ?? []).length === 0) {
    throw new Recusa(
      "Diga o que gravar: `usar_recomendado: true` (o sistema escolhe o evento pelo nome de cada etapa) " +
        "ou `regras`, com a etapa e o evento de cada uma. Os dois juntos também valem: `regras` vence o recomendado na etapa citada.",
    );
  }
  const funil = await funilDaRegua(c, pedido.funil);
  const existentes = await listarRegrasMeta(c.admin, c.orgId);
  const antesPorEtapa = new Map(existentes.map((r) => [r.stageId, r]));

  // O evento pedido, etapa a etapa. `ligada` nunca vem do pedido: fica como
  // está, e regra nova nasce desligada.
  const pedidos = new Map<string, EventoDaMeta>();
  if (pedido.usar_recomendado) {
    for (const etapa of funil.etapas) {
      const sugerido = eventoRecomendadoParaMeta(etapa.nome);
      if (sugerido) pedidos.set(etapa.id, sugerido);
    }
  }
  const citadas = new Set<string>();
  for (const r of pedido.regras ?? []) {
    const etapa = etapaDoFunil(funil, r.etapa);
    if (citadas.has(etapa.id)) {
      throw new Recusa(`A etapa «${etapa.nome}» aparece duas vezes em \`regras\`. Cada etapa tem uma regra só.`);
    }
    citadas.add(etapa.id);
    pedidos.set(etapa.id, r.evento);
  }

  // Regra LIGADA não é editada por aqui: a mudança valeria no próximo negócio.
  const ligadasQueMudariam = funil.etapas.filter((e) => {
    const antes = antesPorEtapa.get(e.id);
    const depois = pedidos.get(e.id);
    return Boolean(antes?.enabled && depois && antes.metaEvent !== depois);
  });
  if (ligadasQueMudariam.length > 0) {
    throw new Recusa(
      `A regra da Meta está LIGADA em ${ligadasQueMudariam.map((e) => `«${e.nome}»`).join(", ")}: mudar o evento de uma regra ligada ` +
        "passaria a valer no próximo negócio que entrar na etapa. Nada foi gravado. " +
        "Desligue com plataforma_ligar_conversoes (`ligada: false`), ajuste aqui e ligue de novo.",
    );
  }

  const lista = listaInteiraDaMeta(existentes);
  const desfechos = new Map<string, Desfecho>();
  for (const [stageId, evento] of pedidos) {
    const antes = antesPorEtapa.get(stageId);
    desfechos.set(stageId, !antes ? "criou" : antes.metaEvent === evento ? "ja_estava" : "atualizou");
    lista.set(stageId, { stage_id: stageId, enabled: antes?.enabled ?? false, meta_event: evento });
  }

  // O que já existia e mudou passa pela gravação compartilhada com a tela (a
  // lista INTEIRA, para nenhuma outra regra ser desligada). A regra NOVA nasce
  // logo abaixo, pela mesma tabela, desligada.
  if ([...desfechos.values()].includes("atualizou")) await gravarMeta(c, lista);
  if ([...desfechos.values()].includes("criou")) await criarRegrasDesligadasDaMeta(c, lista, existentes);

  // O mesmo evento em duas etapas do funil: na régua do upstream a chave é a
  // etapa, então o negócio que passar pelas duas manda o evento DUAS vezes.
  const porEvento = new Map<string, string[]>();
  for (const e of funil.etapas) {
    const regra = lista.get(e.id);
    if (!regra) continue;
    porEvento.set(regra.meta_event, [...(porEvento.get(regra.meta_event) ?? []), e.nome]);
  }
  const repetidos = [...porEvento.entries()].filter(([, etapas]) => etapas.length > 1);

  return {
    funil: { id: funil.id, nome: funil.nome },
    etapas: funil.etapas.map((e) => {
      const regra = lista.get(e.id);
      return {
        etapa: e.nome,
        regra: regra ? regraDaMetaEmTexto({ enabled: regra.enabled, metaEvent: regra.meta_event }) : null,
        desfecho: (desfechos.get(e.id) ?? (regra ? "ja_estava" : null)) as Desfecho | null,
      };
    }),
    avisos: repetidos.map(
      ([evento, etapas]) =>
        `O evento «${rotuloDoEventoDaMeta(evento)}» está em ${etapas.map((n) => `«${n}»`).join(" e ")}: cada etapa envia o seu, ` +
        "então o negócio que passar pelas duas manda o mesmo evento à Meta duas vezes. Se não for o que você quer, troque o evento de uma delas.",
    ),
    proximo_passo:
      "As regras estão gravadas e as novas nasceram DESLIGADAS. Para a Meta passar a receber, plataforma_ligar_conversoes (operação colocar_no_ar). " +
      "Ligar não envia o passado: vale para os negócios que entrarem nas etapas a partir dali.",
  };
}

// ── GARANTIR as regras do Google ────────────────────────────────────────────

export interface PedidoDeRegrasDoGoogle {
  funil: string;
  regras: Array<{
    etapa: string;
    nome: string;
    acao_de_conversao_id: string;
    categoria?: CategoriaDeConversao;
    canal?: CanalDeEntrada;
    incluir_em_conversoes?: boolean;
  }>;
}

/** A lista INTEIRA que a gravação do Google pede, a partir do que já existe. */
function listaInteiraDoGoogle(existentes: readonly RegraDeConversaoGoogle[]): Map<string, RegraGoogleParaGravar> {
  return new Map(
    existentes.map((r) => [
      r.stageId,
      {
        stage_id: r.stageId,
        enabled: r.enabled,
        label: r.label,
        google_action_id: r.googleActionId,
        category: r.category,
        included_in_conversions: r.includedInConversions,
        channel: r.channel,
      },
    ]),
  );
}

async function gravarGoogle(c: Implantacao, lista: Map<string, RegraGoogleParaGravar>): Promise<void> {
  const gravado = await gravarRegrasDeConversaoGoogle(
    c.admin,
    { organizationId: c.orgId, autorUserId: c.autorUserId },
    [...lista.values()],
  );
  if (!gravado.ok) {
    throw new Recusa(
      gravado.error === "etapa_invalida"
        ? "Uma das etapas não existe mais ou foi fechada. Nada foi gravado. Confira em plataforma_ver_conversoes."
        : "Não consegui gravar as regras do Google. Tente de novo.",
    );
  }
  void audit({
    action: "google_ads_conversion_rules.updated",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "google_ads_conversion_rules",
    resourceId: null,
    requestId: c.requestId,
    metadata: { ligadas: gravado.ligadas, desligadas: gravado.desligadas, via: "mcp_plataforma" },
  });
}

export async function garantirConversoesDoGoogle(c: Implantacao, pedido: PedidoDeRegrasDoGoogle) {
  const funil = await funilDaRegua(c, pedido.funil);
  const existentes = await listarRegrasGoogle(c.admin, c.orgId);
  const lista = listaInteiraDoGoogle(existentes);
  const antesPorEtapa = new Map(existentes.map((r) => [r.stageId, r]));

  const desfechos: Array<{ etapa: string; desfecho: Desfecho; ligada: boolean }> = [];
  const citadas = new Set<string>();
  for (const r of pedido.regras) {
    const etapa = etapaDoFunil(funil, r.etapa);
    if (citadas.has(etapa.id)) throw new Recusa(`A etapa «${etapa.nome}» aparece duas vezes em \`regras\`. Cada etapa tem uma regra só.`);
    citadas.add(etapa.id);
    const antes = antesPorEtapa.get(etapa.id);
    const nova: RegraGoogleParaGravar = {
      stage_id: etapa.id,
      enabled: antes?.enabled ?? false,
      label: r.nome.trim(),
      google_action_id: r.acao_de_conversao_id.trim(),
      category: r.categoria ?? antes?.category ?? "DEFAULT",
      included_in_conversions: r.incluir_em_conversoes ?? antes?.includedInConversions ?? true,
      channel: r.canal ?? antes?.channel ?? "todos",
    };
    const igual =
      antes !== undefined &&
      antes.label === nova.label &&
      antes.googleActionId === nova.google_action_id &&
      antes.category === nova.category &&
      antes.includedInConversions === nova.included_in_conversions &&
      antes.channel === nova.channel;
    if (antes?.enabled && !igual) {
      throw new Recusa(
        `A regra do Google está LIGADA em «${etapa.nome}»: mudar a ação, o nome, a categoria ou o canal de uma regra ligada passaria a valer no próximo negócio. ` +
          "Nada foi gravado. Desligue com plataforma_ligar_conversoes (`ligada: false`), ajuste aqui e ligue de novo.",
      );
    }
    desfechos.push({ etapa: etapa.nome, desfecho: igual ? "ja_estava" : antes ? "atualizou" : "criou", ligada: nova.enabled });
    lista.set(etapa.id, nova);
  }

  // O que já existia e mudou passa pela gravação compartilhada com a tela. A
  // regra NOVA nasce desligada, e essa gravação não cria linha para etapa
  // desligada que nunca existiu (não há nome de evento a preservar): ela nasce
  // logo abaixo, pela mesma tabela, desligada.
  if (desfechos.some((d) => d.desfecho === "atualizou")) await gravarGoogle(c, lista);
  if (desfechos.some((d) => d.desfecho === "criou")) await criarRegrasDesligadasDoGoogle(c, lista, existentes);

  return {
    funil: { id: funil.id, nome: funil.nome },
    etapas: desfechos,
    proximo_passo:
      "As regras novas nasceram DESLIGADAS. Para o Google passar a receber, plataforma_ligar_conversoes com `plataforma: \"google\"` (operação colocar_no_ar).",
  };
}

/**
 * A regra do Google que nasce DESLIGADA: a gravação compartilhada não cria linha
 * para etapa desligada que nunca existiu, e a ferramenta precisa da linha para
 * guardar a ação e o nome até alguém ligar. O `event_name` é o mesmo que a
 * gravação daria (`Etapa:<uuid>`), então ligar depois não muda de nome.
 */
async function criarRegrasDesligadasDoGoogle(
  c: Implantacao,
  lista: Map<string, RegraGoogleParaGravar>,
  existentes: readonly RegraDeConversaoGoogle[],
): Promise<void> {
  const jaExistiam = new Set(existentes.map((r) => r.stageId));
  const linhas = [...lista.values()]
    .filter((r) => !r.enabled && !jaExistiam.has(r.stage_id))
    .map((r) => ({
      organization_id: c.orgId,
      stage_id: r.stage_id,
      event_name: eventoDaEtapa(r.stage_id),
      label: r.label,
      google_action_id: r.google_action_id,
      category: r.category,
      included_in_conversions: r.included_in_conversions,
      channel: r.channel,
      enabled: false,
      updated_by: c.autorUserId,
    }));
  if (linhas.length === 0) return;
  const { error } = await c.admin
    .from("google_ads_conversion_rules")
    .upsert(linhas, { onConflict: "organization_id,stage_id" });
  if (error) throw new Error(`não consegui gravar as regras do Google: ${error.message}`);
  void audit({
    action: "google_ads_conversion_rules.updated",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "google_ads_conversion_rules",
    resourceId: null,
    requestId: c.requestId,
    metadata: { ligadas: 0, desligadas: linhas.length, via: "mcp_plataforma" },
  });
}

// ── LIGAR ───────────────────────────────────────────────────────────────────

export interface PedidoDeLigarConversoes {
  plataforma: "meta" | "google";
  funil: string;
  etapas?: string[];
  ligada: boolean;
}

export async function ligarConversoes(c: Implantacao, pedido: PedidoDeLigarConversoes, demonstracao: boolean) {
  const funil = await funilDaRegua(c, pedido.funil);
  const alvos = pedido.etapas && pedido.etapas.length > 0 ? pedido.etapas.map((nome) => etapaDoFunil(funil, nome)) : null;

  const comAviso = (resposta: Record<string, unknown>, conexaoPronta: boolean, nome: string) => ({
    ...resposta,
    ...(demonstracao
      ? { aviso: "Empresa de demonstração: a regra fica ligada e nada é enviado, porque a conexão de conversões não existe nela." }
      : pedido.ligada && !conexaoPronta
        ? {
            aviso:
              `A conexão com ${nome} não está pronta ou está com o envio desligado: a regra fica ligada e nada sai até uma pessoa ` +
              "preencher e ligar a conexão em Configurações › Conversões (/app/settings/conversoes).",
          }
        : {}),
  });

  if (pedido.plataforma === "meta") {
    const existentes = await listarRegrasMeta(c.admin, c.orgId);
    const porEtapa = new Map(existentes.map((r) => [r.stageId, r]));
    const etapas = alvos ?? funil.etapas.filter((e) => porEtapa.has(e.id));
    const semRegra = etapas.filter((e) => !porEtapa.has(e.id));
    if (semRegra.length > 0 || etapas.length === 0) {
      throw new Recusa(
        (etapas.length === 0
          ? `O funil «${funil.nome}» ainda não tem regra da Meta em etapa nenhuma. `
          : `Não há regra da Meta em ${semRegra.map((e) => `«${e.nome}»`).join(", ")}. `) +
          "Crie as regras com plataforma_garantir_conversoes_da_meta (por exemplo, `usar_recomendado: true`) e ligue depois.",
      );
    }
    // A lista INTEIRA vai para a gravação compartilhada com a tela do upstream:
    // a regra que some da lista é desligada, então nenhuma pode faltar.
    const lista = listaInteiraDaMeta(existentes);
    const desfechos = etapas.map((e) => {
      const r = porEtapa.get(e.id) as RegraDeConversaoMeta;
      lista.set(e.id, { stage_id: e.id, enabled: pedido.ligada, meta_event: r.metaEvent });
      return {
        etapa: e.nome,
        evento: rotuloDoEventoDaMeta(r.metaEvent),
        ligada: pedido.ligada,
        desfecho: (r.enabled === pedido.ligada ? "ja_estava" : "atualizou") as Desfecho,
      };
    });
    if (desfechos.some((d) => d.desfecho !== "ja_estava")) await gravarMeta(c, lista);
    const meta = await lerEstadoDaConexao(c.admin, c.orgId, "meta_ads");
    return comAviso(
      {
        plataforma: "meta",
        funil: { id: funil.id, nome: funil.nome },
        etapas: desfechos,
        ...(pedido.ligada
          ? { vale_a_partir_de: "Vale para os negócios que entrarem nas etapas a partir de agora. Quem já está na etapa não é enviado." }
          : {}),
      },
      meta.conectada && Boolean(meta.datasetId) && meta.temToken && meta.habilitada,
      "a Meta",
    );
  }

  const existentes = await listarRegrasGoogle(c.admin, c.orgId);
  const porEtapa = new Map(existentes.map((r) => [r.stageId, r]));
  const etapas = alvos ?? funil.etapas.filter((e) => porEtapa.has(e.id));
  const semRegra = etapas.filter((e) => !porEtapa.has(e.id));
  if (semRegra.length > 0 || etapas.length === 0) {
    throw new Recusa(
      (etapas.length === 0
        ? `O funil «${funil.nome}» ainda não tem regra do Google em etapa nenhuma. `
        : `Não há regra do Google em ${semRegra.map((e) => `«${e.nome}»`).join(", ")}. `) +
        "Crie as regras com plataforma_garantir_conversoes_do_google e ligue depois.",
    );
  }
  const lista = listaInteiraDoGoogle(existentes);
  const desfechos = etapas.map((e) => {
    const r = porEtapa.get(e.id) as RegraDeConversaoGoogle;
    if (pedido.ligada && (!r.label.trim() || !/^\d+$/.test(r.googleActionId) || r.googleActionId === "0")) {
      throw new Recusa(
        `A regra do Google em «${e.nome}» não tem nome ou ação de conversão: sem isso o Google recusa o envio. ` +
          "Informe os dois em plataforma_garantir_conversoes_do_google e ligue depois. Nada mudou.",
      );
    }
    lista.set(e.id, { ...(lista.get(e.id) as RegraGoogleParaGravar), enabled: pedido.ligada });
    return { etapa: e.nome, nome: r.label, ligada: pedido.ligada, desfecho: (r.enabled === pedido.ligada ? "ja_estava" : "atualizou") as Desfecho };
  });
  if (desfechos.some((d) => d.desfecho !== "ja_estava")) await gravarGoogle(c, lista);
  const google = await lerEstadoDaConexaoGoogle(c.admin, c.orgId);
  return comAviso(
    {
      plataforma: "google",
      funil: { id: funil.id, nome: funil.nome },
      etapas: desfechos,
      ...(pedido.ligada
        ? { vale_a_partir_de: "Vale para os negócios que entrarem nas etapas a partir de agora. Movimento anterior a ligar não é enviado." }
        : {}),
    },
    google.temRefreshToken && Boolean(google.customerId) && google.habilitada,
    "o Google Ads",
  );
}

// ── A volta dos leads de formulário ─────────────────────────────────────────

export async function ligarLeadsDeFormularioDaMeta(c: Implantacao, ligar: boolean, demonstracao: boolean) {
  const resultado = await definirChaveDeFormulario(c.admin, quem(c), ligar);
  if (!resultado.ok) throw new Recusa("Não consegui gravar a chave dos leads de formulário. Nada mudou. Tente de novo.");
  const chave = await lerChaveDeFormulario(c.admin, c.orgId);
  return {
    leads_de_formulario_da_meta: { ligada: chave.ligada, desde: chave.desde },
    desfecho: resultado.desfecho,
    ...(ligar
      ? {
          o_que_passa_a_acontecer:
            "Os eventos de etapa com regra ligada (a régua da Meta, a mesma da tela) e a venda também são informados à Meta para o lead " +
            "que veio de formulário da Meta, pelo identificador do lead guardado. Ligar não envia o passado: vale para o que acontecer a partir de agora.",
        }
      : {}),
    ...(demonstracao ? { aviso: "Empresa de demonstração: a chave fica gravada e nada é enviado." } : {}),
  };
}

// ── O diagnóstico ───────────────────────────────────────────────────────────

/** `conferir` existe para o teste trocar a ida à Meta por um dublê. */
export async function diagnosticarConversoesDaMeta(
  admin: SupabaseClient,
  orgId: string,
  opcoes: Parameters<typeof diagnosticarConexaoDaMeta>[2] = {},
) {
  const diagnostico = await diagnosticarConexaoDaMeta(admin, orgId, opcoes);
  return {
    veredito: VEREDITO_DO_DIAGNOSTICO[diagnostico.veredito],
    em_ordem: diagnostico.veredito === "em_ordem",
    testado_em: diagnostico.testadoEm,
    conferencias: diagnosticoEmFrases(diagnostico),
    o_que_o_teste_faz:
      "Três leituras na Meta (o token, o destino de conversões e as permissões) e duas no histórico de envios. Nenhum evento é enviado.",
  };
}
