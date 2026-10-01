/**
 * FORK MIA — as CONVERSÕES de um cliente, pelas ferramentas do MCP de plataforma
 * (docs/fork/conversoes-da-meta.md e docs/fork/mcp-de-implantacao.md).
 *
 * ── O caminho da tela que isto usa ────────────────────────────────────────
 *
 *   regras da Meta      `salvarRegrasDaMeta` (`lib/conversoes-meta/regras.ts`),
 *                       a MESMA função da ação da tela
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
import { lerEstadoDaConexao } from "@/lib/conversoes/estado-da-conexao";
import { gravarRegrasDeConversaoGoogle, type RegraGoogleParaGravar } from "@/lib/conversoes/gravar-regras-google";
import {
  eventoDaEtapa,
  listarRegrasGoogle,
  VALORES_DE_CATEGORIA,
  type CanalDeEntrada,
  type CategoriaDeConversao,
  type RegraDeConversaoGoogle,
} from "@/lib/conversoes/regras-google";
import { definirChaveDeFormulario, lerChaveDeFormulario } from "@/lib/conversoes-meta/config";
import { diagnosticarConexaoDaMeta, diagnosticoEmFrases } from "@/lib/conversoes-meta/diagnostico";
import { VEREDITO_DO_DIAGNOSTICO } from "@/lib/conversoes-meta/diagnostico-frases";
import {
  eventoDaMeta,
  eventoRecomendado,
  EVENTOS_DA_META,
  passosDoFunil,
  rotuloDoEventoDaMetaNoLivro,
  type CanalDeEntradaDaMeta,
  type ChaveDoEventoDaMeta,
  type ModoDoValor,
  type RegraDaEtapa,
} from "@/lib/conversoes-meta/eventos";
import {
  lerFunisDaRegua,
  listarRegrasDaMeta,
  salvarRegrasDaMeta,
  type FunilDaRegua,
  type QuemSalva,
  type RegraDeConversaoMeta,
} from "@/lib/conversoes-meta/regras";
import { MOTIVO_DA_META_LEGIVEL, ROTULO_DA_SITUACAO, situacaoDoEnvio } from "@/lib/conversoes-meta/situacao";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { lerEstadoDaConexaoGoogle } from "@/lib/plataformas-de-anuncio/google/estado-da-conexao";

import { acharPorNomeOuId, type Desfecho, type Implantacao } from "./base";

const quem = (c: Implantacao): QuemSalva => ({
  organizationId: c.orgId,
  autorUserId: c.autorUserId,
  requestId: c.requestId,
  via: "mcp_plataforma",
});

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

function regraDaMetaEmTexto(r: RegraDaEtapa): Record<string, unknown> {
  const evento = eventoDaMeta(r.evento);
  return {
    ligada: r.ligada,
    evento: r.evento,
    evento_rotulo: evento.rotulo,
    nome_tecnico: evento.nomeTecnico,
    canal: r.canal,
    valor: r.modoDoValor,
    ...(r.modoDoValor === "valor_fixo" ? { valor_fixo_centavos: r.valorFixoCentavos } : {}),
  };
}

// ── LER ─────────────────────────────────────────────────────────────────────

/**
 * As conversões de um cliente: as conexões SEM segredo, as regras por funil das
 * duas plataformas, a chave dos formulários e os últimos envios.
 */
export async function verConversoes(c: Implantacao, demonstracao: boolean): Promise<Record<string, unknown>> {
  const semana = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [meta, google, funis, regrasMeta, regrasGoogle, chave, envios, recusas] = await Promise.all([
    lerEstadoDaConexao(c.admin, c.orgId, "meta_ads"),
    lerEstadoDaConexaoGoogle(c.admin, c.orgId),
    lerFunisDaRegua(c.admin, c.orgId),
    listarRegrasDaMeta(c.admin, c.orgId),
    listarRegrasGoogle(c.admin, c.orgId),
    lerChaveDeFormulario(c.admin, c.orgId),
    c.admin
      .from("ad_conversion_dispatches")
      .select("lead_id, platform, event_name, status, reason, detail, value_cents, attempted_at")
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
      como_conectar:
        "Credencial não entra por ferramenta: uma pessoa preenche em Configurações › Conversões (/app/settings/conversoes).",
    },
    leads_de_formulario_da_meta: { ligada: chave.ligada, desde: chave.desde },
    funis: funis.map((f) => ({
      id: f.id,
      funil: f.nome,
      etapas: f.etapas.map((e, i) => {
        const daMeta = metaPorEtapa.get(e.id);
        const doGoogle = googlePorEtapa.get(e.id);
        return {
          id: e.id,
          etapa: e.nome,
          meta: daMeta ? regraDaMetaEmTexto(daMeta) : null,
          recomendado_para_a_meta: eventoRecomendado(e.nome, i === 0),
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
    eventos_da_meta: EVENTOS_DA_META.map((e) => ({
      evento: e.chave,
      rotulo: e.rotulo,
      nome_tecnico: e.nomeTecnico,
      na_lista_da_meta_para_anuncio_de_whatsapp: e.naListaDaMensagem,
    })),
    categorias_do_google: VALORES_DE_CATEGORIA,
    ultimos_envios: ((envios.data ?? []) as Array<Record<string, unknown>>).map((l) => {
      const situacao = situacaoDoEnvio(String(l.status), (l.reason as string | null) ?? null);
      const evento = String(l.event_name);
      const motivo = (l.reason as string | null) ?? null;
      return {
        negocio_id: l.lead_id,
        plataforma: l.platform,
        evento: rotuloDoEventoDaMetaNoLivro(evento) ?? rotuloNoGoogle.get(evento) ?? evento,
        situacao: ROTULO_DA_SITUACAO[situacao],
        motivo: situacao === "recusado" ? ((l.detail as string | null) ?? motivo) : motivo ? (MOTIVO_DA_META_LEGIVEL[motivo] ?? motivo) : null,
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
  regras?: Array<{
    etapa: string;
    evento: ChaveDoEventoDaMeta;
    canal?: CanalDeEntradaDaMeta;
    valor?: ModoDoValor;
    valor_fixo_centavos?: number;
  }>;
}

export async function garantirConversoesDaMeta(c: Implantacao, pedido: PedidoDeRegrasDaMeta) {
  if (!pedido.usar_recomendado && (pedido.regras ?? []).length === 0) {
    throw new Recusa(
      "Diga o que gravar: `usar_recomendado: true` (o sistema escolhe o evento pelo nome de cada etapa) " +
        "ou `regras`, com a etapa e o evento de cada uma. Os dois juntos também valem: `regras` vence o recomendado na etapa citada.",
    );
  }
  const funil = await funilDaRegua(c, pedido.funil);
  const existentes = new Map((await listarRegrasDaMeta(c.admin, c.orgId)).map((r) => [r.stageId, r]));

  // O estado pedido, etapa a etapa. `ligada` nunca vem do pedido: fica como está,
  // e regra nova nasce desligada.
  const pedidas = new Map<string, RegraDaEtapa>();
  if (pedido.usar_recomendado) {
    funil.etapas.forEach((etapa, i) => {
      const sugerido = eventoRecomendado(etapa.nome, i === 0);
      if (!sugerido) return;
      const antes = existentes.get(etapa.id);
      pedidas.set(
        etapa.id,
        antes && antes.evento === sugerido
          ? { ligada: antes.ligada, evento: antes.evento, canal: antes.canal, modoDoValor: antes.modoDoValor, valorFixoCentavos: antes.valorFixoCentavos }
          : { ligada: antes?.ligada ?? false, evento: sugerido, canal: antes?.canal ?? "todos", modoDoValor: "sem_valor", valorFixoCentavos: null },
      );
    });
  }
  const citadas = new Set<string>();
  for (const r of pedido.regras ?? []) {
    const etapa = etapaDoFunil(funil, r.etapa);
    if (citadas.has(etapa.id)) throw new Recusa(`A etapa «${etapa.nome}» aparece duas vezes em \`regras\`. Cada etapa tem uma regra só.`);
    citadas.add(etapa.id);
    const modo: ModoDoValor = r.valor ?? "sem_valor";
    if (modo === "valor_fixo" && !(r.valor_fixo_centavos && r.valor_fixo_centavos > 0)) {
      throw new Recusa(
        `A etapa «${etapa.nome}» pede valor fixo e não diz quanto. Informe \`valor_fixo_centavos\` (ex.: 15000 para R$ 150,00), ` +
          "ou troque `valor` para `sem_valor` ou `valor_do_negocio`.",
      );
    }
    pedidas.set(etapa.id, {
      ligada: existentes.get(etapa.id)?.ligada ?? false,
      evento: r.evento,
      canal: r.canal ?? "todos",
      modoDoValor: modo,
      valorFixoCentavos: modo === "valor_fixo" ? (r.valor_fixo_centavos ?? null) : null,
    });
  }

  // Regra LIGADA não é editada por aqui: a mudança valeria no próximo negócio.
  const ligadasQueMudariam = funil.etapas.filter((e) => {
    const antes = existentes.get(e.id);
    const depois = pedidas.get(e.id);
    return Boolean(
      antes?.ligada &&
        depois &&
        (antes.evento !== depois.evento ||
          antes.canal !== depois.canal ||
          antes.modoDoValor !== depois.modoDoValor ||
          antes.valorFixoCentavos !== depois.valorFixoCentavos),
    );
  });
  if (ligadasQueMudariam.length > 0) {
    throw new Recusa(
      `A regra da Meta está LIGADA em ${ligadasQueMudariam.map((e) => `«${e.nome}»`).join(", ")}: mudar o evento, o canal ou o valor de uma regra ligada ` +
        "passaria a valer no próximo negócio que entrar na etapa. Nada foi gravado. " +
        "Desligue com plataforma_ligar_conversoes (`ligada: false`), ajuste aqui e ligue de novo.",
    );
  }

  const resultado = await salvarRegrasDaMeta(
    c.admin,
    quem(c),
    [...pedidas.entries()].map(([stageId, r]) => ({ stageId, ...r })),
  );
  if (!resultado.ok) {
    throw new Recusa(`Não consegui gravar as regras da Meta (${resultado.erro}). Nada foi gravado. Tente de novo.`);
  }

  const desfechoPorEtapa = new Map(resultado.regras.map((r) => [r.stageId, r.desfecho]));
  const depois: Record<string, RegraDaEtapa | undefined> = {};
  for (const e of funil.etapas) depois[e.id] = pedidas.get(e.id) ?? existentes.get(e.id);
  const repetidos = passosDoFunil(funil.etapas, Object.fromEntries(
    // O aviso de repetido olha a régua como ficaria com tudo ligado.
    Object.entries(depois).map(([id, r]) => [id, r ? { ...r, ligada: true } : undefined]),
  )).filter((p) => p.repetido);

  return {
    funil: { id: funil.id, nome: funil.nome },
    etapas: funil.etapas.map((e) => {
      const regra = depois[e.id];
      return {
        etapa: e.nome,
        regra: regra ? regraDaMetaEmTexto(regra) : null,
        desfecho: (desfechoPorEtapa.get(e.id) ?? (regra ? "ja_estava" : null)) as Desfecho | null,
      };
    }),
    avisos: repetidos.map(
      (p) =>
        `O evento «${eventoDaMeta(p.evento).rotulo}» está em mais de uma etapa: só a primeira etapa em que o negócio entrar envia; «${p.etapa}» não envia de novo para o mesmo negócio.`,
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
    const existentes = new Map((await listarRegrasDaMeta(c.admin, c.orgId)).map((r) => [r.stageId, r]));
    const etapas = alvos ?? funil.etapas.filter((e) => existentes.has(e.id));
    const semRegra = etapas.filter((e) => !existentes.has(e.id));
    if (semRegra.length > 0 || etapas.length === 0) {
      throw new Recusa(
        (etapas.length === 0
          ? `O funil «${funil.nome}» ainda não tem regra da Meta em etapa nenhuma. `
          : `Não há regra da Meta em ${semRegra.map((e) => `«${e.nome}»`).join(", ")}. `) +
          "Crie as regras com plataforma_garantir_conversoes_da_meta (por exemplo, `usar_recomendado: true`) e ligue depois.",
      );
    }
    const resultado = await salvarRegrasDaMeta(
      c.admin,
      quem(c),
      etapas.map((e) => {
        const r = existentes.get(e.id) as RegraDeConversaoMeta;
        return {
          stageId: e.id,
          ligada: pedido.ligada,
          evento: r.evento,
          canal: r.canal,
          modoDoValor: r.modoDoValor,
          valorFixoCentavos: r.valorFixoCentavos,
        };
      }),
    );
    if (!resultado.ok) throw new Recusa(`Não consegui gravar (${resultado.erro}). Nada mudou. Tente de novo.`);
    const desfecho = new Map(resultado.regras.map((r) => [r.stageId, r.desfecho]));
    const meta = await lerEstadoDaConexao(c.admin, c.orgId, "meta_ads");
    return comAviso(
      {
        plataforma: "meta",
        funil: { id: funil.id, nome: funil.nome },
        etapas: etapas.map((e) => ({
          etapa: e.nome,
          evento: eventoDaMeta((existentes.get(e.id) as RegraDeConversaoMeta).evento).rotulo,
          ligada: pedido.ligada,
          desfecho: desfecho.get(e.id) === "ja_estava" ? "ja_estava" : "atualizou",
        })),
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
            "Os eventos de etapa com regra ligada e a venda também são informados à Meta para o lead que veio de formulário da Meta, " +
            "pelo identificador do lead guardado. Ligar não envia o passado: vale para o que acontecer a partir de agora.",
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
