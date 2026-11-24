/**
 * FORK MIA (MIA-169) — as CONVERSÕES DO SITE pelo MCP de plataforma
 * (docs/fork/conversoes-da-meta.md, seção "Conversões do site", e
 * docs/fork/mcp-de-implantacao.md).
 *
 * As regras moram em `mia_regras_de_conversao_do_site` (9170) e o envio é o do
 * motor de sempre (`lib/conversoes/site.ts`). Valem SÓ na empresa dona da fonte
 * `CADASTRO_FONTE_DO_CRM` (a Time): é nela que o cadastro da MIA vira negócio, e
 * só ela usa a credencial do site, que vem do ambiente. Credencial não entra por
 * ferramenta, como no resto do MCP: aqui só se diz se a variável existe.
 *
 * Os tamanhos de estrago de sempre:
 *
 *   ver                 livre
 *   garantir            montagem (`implantar_configuracao`): nasce DESLIGADA
 *   ligar               `colocar_no_ar`: passa a mandar evento de quem se cadastrou
 *   testar              `colocar_no_ar`: manda UM evento com dado fictício (Ana
 *                       Exemplo) à Meta em modo de teste e ao Google só validando.
 *                       Não grava no livro-razão
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { MOTIVO_LEGIVEL } from "@/lib/conversoes/estado-da-conexao";
import { situacaoDaLinha } from "@/lib/conversoes/historico";
import {
  chaveDaRegraDoSite,
  codigoDeTesteDoSite,
  credencialDaMetaDoSite,
  idDaFonteDoCadastro,
  montarConversaoDoSite,
  orgDaFonteDoCadastro,
  TABELA_DAS_REGRAS_DO_SITE,
  VARIAVEL_DA_FONTE_DO_CADASTRO,
  VARIAVEL_DO_CODIGO_DE_TESTE,
  VARIAVEL_DO_DATASET_DO_SITE,
  VARIAVEL_DO_TOKEN_DO_SITE,
} from "@/lib/conversoes/site";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { lerCredencial } from "@/lib/plataformas-de-anuncio/credenciais";
import { EVENTOS_DE_SITE_COM_VALOR, EVENTOS_DE_SITE_DA_META, type EventoDeSiteDaMeta } from "@/lib/plataformas-de-anuncio/meta/evento-do-site";
import { transporteDe } from "@/lib/plataformas-de-anuncio/registry";
import type { ResultadoDeEnvio } from "@/lib/plataformas-de-anuncio/types";

import type { Desfecho, Implantacao } from "./base";
import { etapaDoFunil, funilDaRegua, lerFunisDaRegua, ROTULO_DA_SITUACAO } from "./conversoes";

export { EVENTOS_DE_SITE_DA_META };

interface LinhaDaRegra {
  id: string;
  stage_id: string;
  plataforma: "meta_ads" | "google_ads";
  evento_meta: string | null;
  google_acao_id: string | null;
  leva_valor: boolean;
  enabled: boolean;
}

async function lerRegras(admin: SupabaseClient, organizationId: string): Promise<LinhaDaRegra[]> {
  const { data, error } = await admin
    .from(TABELA_DAS_REGRAS_DO_SITE)
    .select("id, stage_id, plataforma, evento_meta, google_acao_id, leva_valor, enabled")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`não consegui ler as regras do site: ${error.message}`);
  return (data ?? []) as LinhaDaRegra[];
}

/** O que se pode dizer da configuração sem dizer nada dela (nunca o valor). */
function variaveis(ambiente: NodeJS.ProcessEnv = process.env) {
  return {
    fonte_do_cadastro: idDaFonteDoCadastro(ambiente) !== null,
    dataset_do_site: (ambiente[VARIAVEL_DO_DATASET_DO_SITE] ?? "").trim() !== "",
    token_do_site: (ambiente[VARIAVEL_DO_TOKEN_DO_SITE] ?? "").trim() !== "",
    codigo_de_teste: codigoDeTesteDoSite(ambiente) !== null,
  };
}

/** A empresa é a dona da fonte do cadastro? Recusa que ensina quando não é. */
async function exigirEmpresaDaFonte(c: Implantacao, demonstracao: boolean): Promise<void> {
  if (demonstracao) {
    throw new Recusa(
      "A empresa de demonstração não tem conversões do site: elas valem só na empresa onde o cadastro da MIA vira negócio " +
        `(a dona da fonte ${VARIAVEL_DA_FONTE_DO_CADASTRO}). Nada foi gravado nem enviado.`,
    );
  }
  const orgDaFonte = await orgDaFonteDoCadastro(c.admin);
  if (orgDaFonte === null) {
    throw new Recusa(
      `As conversões do site valem só na empresa dona da fonte ${VARIAVEL_DA_FONTE_DO_CADASTRO}, e essa variável não está configurada ` +
        "(ou aponta para uma fonte que não existe). Crie a fonte com plataforma_garantir_fonte_de_formulario e peça a quem cuida do servidor " +
        "para colar o id dela na variável. Nada foi gravado.",
    );
  }
  if (orgDaFonte !== c.orgId) {
    throw new Recusa(
      `Esta empresa não é a dona da fonte ${VARIAVEL_DA_FONTE_DO_CADASTRO}: as conversões do site valem só lá, ` +
        "porque é lá que o cadastro da MIA vira negócio e só lá a credencial do site é usada. Para o funil de um cliente, use " +
        "plataforma_garantir_conversoes_da_meta ou _do_google. Nada foi gravado.",
    );
  }
}

const rotuloDaRegra = (r: Pick<LinhaDaRegra, "plataforma" | "evento_meta" | "google_acao_id">) =>
  r.plataforma === "meta_ads" ? `Meta · ${r.evento_meta}` : `Google · ação ${r.google_acao_id}`;

// ── LER ─────────────────────────────────────────────────────────────────────

/** A seção `site` de plataforma_ver_conversoes. Sem segredo e sem dado pessoal. */
export async function verConversoesDoSite(c: Implantacao): Promise<Record<string, unknown>> {
  const config = variaveis();
  const orgDaFonte = await orgDaFonteDoCadastro(c.admin);
  const daFonte = orgDaFonte !== null && orgDaFonte === c.orgId;
  const [regras, funis] = await Promise.all([lerRegras(c.admin, c.orgId), lerFunisDaRegua(c.admin, c.orgId)]);
  const etapas = new Map(funis.flatMap((f) => f.etapas.map((e) => [e.id, { funil: f.nome, etapa: e.nome }] as const)));

  let ultimos: Array<Record<string, unknown>> = [];
  if (regras.length > 0) {
    const chaves = regras.map((r) => chaveDaRegraDoSite({ id: r.id, plataforma: r.plataforma }));
    const porChave = new Map(regras.map((r) => [chaveDaRegraDoSite({ id: r.id, plataforma: r.plataforma }), r]));
    const { data, error } = await c.admin
      .from("ad_conversion_dispatches")
      .select("event_name, platform, status, reason, attempted_at")
      .eq("organization_id", c.orgId)
      .in("event_name", chaves)
      .order("attempted_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(`não consegui ler os envios do site: ${error.message}`);
    ultimos = ((data ?? []) as Array<Record<string, unknown>>).map((l) => {
      const regra = porChave.get(String(l.event_name));
      const motivo = (l.reason as string | null) ?? null;
      const situacao = situacaoDaLinha(String(l.status), motivo);
      return {
        evento: regra ? rotuloDaRegra(regra) : String(l.event_name),
        plataforma: l.platform,
        situacao: ROTULO_DA_SITUACAO[situacao],
        // Só o slug traduzido: o detalhe pode citar o que a plataforma respondeu.
        motivo: motivo ? (MOTIVO_LEGIVEL[motivo] ?? motivo) : null,
        quando: l.attempted_at,
      };
    });
  }

  return {
    empresa_da_fonte_do_cadastro: daFonte,
    variaveis_configuradas: config,
    credencial_da_meta_do_site: daFonte && config.dataset_do_site && config.token_do_site ? "configurada" : "não configurada",
    modo_de_teste: config.codigo_de_teste,
    regras: regras.map((r) => ({
      id: r.id,
      ...(etapas.get(r.stage_id) ?? { funil: null, etapa: r.stage_id }),
      plataforma: r.plataforma === "meta_ads" ? "meta" : "google",
      ...(r.plataforma === "meta_ads" ? { evento: r.evento_meta } : { acao_de_conversao_id: r.google_acao_id }),
      leva_valor: r.leva_valor,
      ligada: r.enabled,
    })),
    ultimos_envios: ultimos,
    eventos_do_site: [...EVENTOS_DE_SITE_DA_META],
    para_que:
      "O cadastro e a assinatura da MIA viram negócio no funil desta empresa; cada etapa com regra do site manda um evento de SITE ao dataset do site na Meta " +
      "(credencial pelas variáveis do servidor, nunca pela tela) e a ação de conversão ao Google Ads (pela conexão da tela).",
  };
}

// ── GARANTIR ────────────────────────────────────────────────────────────────

export interface RegraDoSitePedida {
  etapa: string;
  plataforma: "meta" | "google";
  evento?: EventoDeSiteDaMeta;
  acao_de_conversao_id?: string;
  leva_valor?: boolean;
}

export interface PedidoDeRegrasDoSite {
  funil: string;
  regras: RegraDoSitePedida[];
}

export async function garantirConversoesDoSite(c: Implantacao, pedido: PedidoDeRegrasDoSite, demonstracao: boolean) {
  await exigirEmpresaDaFonte(c, demonstracao);
  const funil = await funilDaRegua(c, pedido.funil);
  const existentes = await lerRegras(c.admin, c.orgId);

  type Plano = { etapa: { id: string; nome: string }; linha: Omit<LinhaDaRegra, "id" | "enabled">; antes?: LinhaDaRegra; desfecho: Desfecho };
  const planos: Plano[] = [];
  const citadas = new Set<string>();
  for (const r of pedido.regras) {
    const etapa = etapaDoFunil(funil, r.etapa);
    const meta = r.plataforma === "meta";
    if (meta && !r.evento) {
      throw new Recusa(
        `A regra da Meta em «${etapa.nome}» precisa do \`evento\`: ${EVENTOS_DE_SITE_DA_META.join(", ")}. Nada foi gravado.`,
      );
    }
    if (!meta && !r.acao_de_conversao_id) {
      throw new Recusa(
        `A regra do Google em «${etapa.nome}» precisa da \`acao_de_conversao_id\` (o id numérico da ação na conta do Google Ads, ex.: a de cadastro ou a de compra). Nada foi gravado.`,
      );
    }
    if (meta && r.acao_de_conversao_id) {
      throw new Recusa(`A regra da Meta em «${etapa.nome}» não leva \`acao_de_conversao_id\` (isso é do Google). Nada foi gravado.`);
    }
    if (!meta && r.evento) {
      throw new Recusa(`A regra do Google em «${etapa.nome}» não leva \`evento\` (isso é da Meta). Nada foi gravado.`);
    }
    const comValor = meta && EVENTOS_DE_SITE_COM_VALOR.includes(r.evento!);
    if (comValor && r.leva_valor === false) {
      throw new Recusa(
        `${r.evento} vai à Meta com o valor, a moeda e o id do pedido, e sem valor ela recusa: em «${etapa.nome}», \`leva_valor\` tem de ser true (ou omita). Nada foi gravado.`,
      );
    }
    const linha = {
      stage_id: etapa.id,
      plataforma: meta ? ("meta_ads" as const) : ("google_ads" as const),
      evento_meta: meta ? r.evento! : null,
      google_acao_id: meta ? null : r.acao_de_conversao_id!.trim(),
      leva_valor: comValor ? true : (r.leva_valor ?? false),
    };
    const chave = `${linha.stage_id}|${linha.plataforma}|${linha.evento_meta ?? linha.google_acao_id}`;
    if (citadas.has(chave)) throw new Recusa(`A regra ${rotuloDaRegra(linha)} em «${etapa.nome}» aparece duas vezes em \`regras\`.`);
    citadas.add(chave);
    const antes = existentes.find(
      (e) =>
        e.stage_id === linha.stage_id &&
        e.plataforma === linha.plataforma &&
        (linha.plataforma === "meta_ads" ? e.evento_meta === linha.evento_meta : e.google_acao_id === linha.google_acao_id),
    );
    const igual = antes !== undefined && antes.leva_valor === linha.leva_valor;
    if (antes?.enabled && !igual) {
      throw new Recusa(
        `A regra ${rotuloDaRegra(linha)} está LIGADA em «${etapa.nome}»: mudar uma regra ligada valeria no próximo cadastro. ` +
          "Nada foi gravado. Desligue com plataforma_ligar_conversoes (`plataforma: \"site\"`, `ligada: false`), ajuste aqui e ligue de novo.",
      );
    }
    planos.push({ etapa, linha, antes, desfecho: igual ? "ja_estava" : antes ? "atualizou" : "criou" });
  }

  for (const p of planos) {
    if (p.desfecho === "ja_estava") continue;
    const escrita = p.antes
      ? c.admin.from(TABELA_DAS_REGRAS_DO_SITE).update({ leva_valor: p.linha.leva_valor }).eq("organization_id", c.orgId).eq("id", p.antes.id)
      : c.admin.from(TABELA_DAS_REGRAS_DO_SITE).insert({ organization_id: c.orgId, ...p.linha, enabled: false });
    const { error } = await escrita;
    if (error) throw new Error(`não consegui gravar a regra do site: ${error.message}`);
  }
  const mudou = planos.filter((p) => p.desfecho !== "ja_estava").length;
  if (mudou > 0) {
    void audit({
      action: "mia_regras_do_site.updated",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: TABELA_DAS_REGRAS_DO_SITE,
      resourceId: null,
      requestId: c.requestId,
      metadata: { gravadas: mudou, ligadas: 0, via: "mcp_plataforma" },
    });
  }

  return {
    funil: { id: funil.id, nome: funil.nome },
    regras: planos.map((p) => ({
      etapa: p.etapa.nome,
      regra: rotuloDaRegra(p.linha),
      leva_valor: p.linha.leva_valor,
      ligada: p.antes?.enabled ?? false,
      desfecho: p.desfecho,
    })),
    proximo_passo:
      "As regras novas nasceram DESLIGADAS. Prove com plataforma_testar_conversoes_do_site (com o código de teste da Meta no servidor) e só então ligue com " +
      "plataforma_ligar_conversoes (`plataforma: \"site\"`, operação colocar_no_ar), depois de confirmar com o humano.",
  };
}

// ── LIGAR ───────────────────────────────────────────────────────────────────

export async function ligarConversoesDoSite(
  c: Implantacao,
  pedido: { funil: string; etapas?: string[]; ligada: boolean },
  demonstracao: boolean,
) {
  await exigirEmpresaDaFonte(c, demonstracao);
  const funil = await funilDaRegua(c, pedido.funil);
  const alvos = pedido.etapas && pedido.etapas.length > 0 ? pedido.etapas.map((e) => etapaDoFunil(funil, e)) : funil.etapas;
  const ids = new Set(alvos.map((e) => e.id));
  const nomes = new Map(funil.etapas.map((e) => [e.id, e.nome]));
  const regras = (await lerRegras(c.admin, c.orgId)).filter((r) => ids.has(r.stage_id));
  const semRegra = (pedido.etapas ?? []).length > 0 ? alvos.filter((e) => !regras.some((r) => r.stage_id === e.id)) : [];
  if (regras.length === 0 || semRegra.length > 0) {
    throw new Recusa(
      (regras.length === 0
        ? `O funil «${funil.nome}» ainda não tem regra do site. `
        : `Não há regra do site em ${semRegra.map((e) => `«${e.nome}»`).join(", ")}. `) +
        "Crie as regras com plataforma_garantir_conversoes_do_site e ligue depois. Nada mudou.",
    );
  }
  const mudar = regras.filter((r) => r.enabled !== pedido.ligada);
  if (mudar.length > 0) {
    const { error } = await c.admin
      .from(TABELA_DAS_REGRAS_DO_SITE)
      .update({ enabled: pedido.ligada })
      .eq("organization_id", c.orgId)
      .in(
        "id",
        mudar.map((r) => r.id),
      );
    if (error) throw new Error(`não consegui ligar as regras do site: ${error.message}`);
    void audit({
      action: "mia_regras_do_site.updated",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: TABELA_DAS_REGRAS_DO_SITE,
      resourceId: null,
      requestId: c.requestId,
      metadata: { ligadas: pedido.ligada ? mudar.length : 0, desligadas: pedido.ligada ? 0 : mudar.length, via: "mcp_plataforma" },
    });
  }

  const config = variaveis();
  const credencialPronta = config.dataset_do_site && config.token_do_site;
  const temGoogle = regras.some((r) => r.plataforma === "google_ads");
  const google = temGoogle ? await lerCredencial(c.admin, c.orgId, "google_ads", { exigirAcaoDeVenda: false }) : null;
  const avisos = [
    ...(pedido.ligada && regras.some((r) => r.plataforma === "meta_ads") && !credencialPronta
      ? [`Falta ${VARIAVEL_DO_DATASET_DO_SITE} ou ${VARIAVEL_DO_TOKEN_DO_SITE} no servidor: as regras da Meta ficam ligadas e nada sai (o envio fica pendente com site_sem_credencial).`]
      : []),
    ...(pedido.ligada && config.codigo_de_teste
      ? [`${VARIAVEL_DO_CODIGO_DE_TESTE} está no servidor: os eventos da Meta vão para "Testar eventos" e não contam. Tire a variável depois do aceite.`]
      : []),
    ...(pedido.ligada && google && !google.ok
      ? ["A conexão do Google Ads desta empresa não está pronta ou está desligada (Configurações › Conversões): as regras do Google ficam ligadas e nada sai."]
      : []),
  ];

  return {
    plataforma: "site",
    funil: { id: funil.id, nome: funil.nome },
    regras: regras.map((r) => ({
      etapa: nomes.get(r.stage_id) ?? r.stage_id,
      regra: rotuloDaRegra(r),
      ligada: pedido.ligada,
      desfecho: (r.enabled === pedido.ligada ? "ja_estava" : "atualizou") as Desfecho,
    })),
    ...(pedido.ligada
      ? { vale_a_partir_de: "Vale para os negócios que entrarem nas etapas a partir de agora. Movimento anterior a ligar não é enviado." }
      : {}),
    ...(avisos.length > 0 ? { avisos } : {}),
  };
}

// ── TESTAR ──────────────────────────────────────────────────────────────────

/** A pessoa fictícia do teste. Nenhum dado de ninguém: domínio e endereços de documentação. */
export const PESSOA_DE_TESTE = {
  nome: "Ana Exemplo",
  email: "ana.exemplo@example.com",
  telefone: "5500900000000",
  ip: "203.0.113.10",
  navegador: "Mozilla/5.0 (X11; Linux x86_64) teste-das-conversoes-do-site",
  gclidFicticio: "teste-das-conversoes-do-site",
} as const;

export interface PedidoDeTesteDoSite {
  evento?: EventoDeSiteDaMeta;
  acao_de_conversao_id?: string;
  gclid?: string;
  valor_centavos?: number;
}

function emTexto(r: ResultadoDeEnvio): Record<string, unknown> {
  if (r.tipo === "ok") return { aceito: true };
  return { aceito: false, tipo: r.tipo, detalhe: r.detalhe };
}

/**
 * Manda UM evento de teste, com a Ana Exemplo, à Meta (só com o código de teste
 * no servidor) e, com uma ação, ao Google só validando (`validateOnly`). Não
 * grava no livro-razão nem mexe em regra: é a prova do aceite.
 */
export async function testarConversoesDoSite(c: Implantacao, pedido: PedidoDeTesteDoSite, demonstracao: boolean) {
  await exigirEmpresaDaFonte(c, demonstracao);
  const codigo = codigoDeTesteDoSite();
  if (!codigo) {
    throw new Recusa(
      `Sem ${VARIAVEL_DO_CODIGO_DE_TESTE} no servidor o evento iria à Meta como real e contaria nos anúncios. Peça a quem cuida do servidor para colar ` +
        'o código da aba "Testar eventos" do dataset do site, rode de novo e, depois do aceite, tire a variável. Nada foi enviado.',
    );
  }
  const credencial = credencialDaMetaDoSite(c.orgId, c.orgId);
  if (!credencial.ok) {
    throw new Recusa(
      `Falta ${VARIAVEL_DO_DATASET_DO_SITE} ou ${VARIAVEL_DO_TOKEN_DO_SITE} no servidor: sem eles não há para onde mandar. Nada foi enviado.`,
    );
  }

  const evento = pedido.evento ?? "CompleteRegistration";
  const comValor = EVENTOS_DE_SITE_COM_VALOR.includes(evento);
  const agora = new Date();
  const idDoTeste = `teste-do-site-${agora.getTime()}`;
  const cadastro = {
    empresaClienteId: "00000000-0000-4000-8000-00000000a5a0",
    ip: PESSOA_DE_TESTE.ip,
    navegador: PESSOA_DE_TESTE.navegador,
    pagina: paginaDoCadastro(),
    fbp: null,
    fbc: null,
    consentimento: "necessario",
    gclid: (pedido.gclid ?? "").trim() || PESSOA_DE_TESTE.gclidFicticio,
    gbraid: null,
    wbraid: null,
    pedidoId: comValor ? idDoTeste : null,
  };
  const base = {
    organizationId: c.orgId,
    leadId: idDoTeste,
    ocorridoEm: agora,
    moeda: "BRL",
    telefone: PESSOA_DE_TESTE.telefone,
    email: PESSOA_DE_TESTE.email,
    nome: PESSOA_DE_TESTE.nome,
    cadastro,
  };

  const transporteDaMeta = transporteDe("meta_ads")!;
  const daMeta = await transporteDaMeta.enviar(
    credencial.credencial,
    montarConversaoDoSite({
      ...base,
      evento: `MetaEtapa:${idDoTeste}`,
      eventoMeta: evento,
      valorCentavos: comValor ? (pedido.valor_centavos ?? 100) : null,
    }),
  );

  let doGoogle: Record<string, unknown> | null = null;
  const acao = pedido.acao_de_conversao_id?.trim();
  if (acao) {
    const lida = await lerCredencial(c.admin, c.orgId, "google_ads", { exigirAcaoDeVenda: false });
    if (!lida.ok || !lida.credencial.google) {
      doGoogle = { aceito: false, detalhe: `A conexão do Google Ads desta empresa não está pronta (${lida.ok ? "sem conta" : lida.motivo}). Conecte em Configurações › Conversões.` };
    } else {
      lida.credencial.google.conversionActionId = acao;
      const r = await transporteDe("google_ads")!.enviar(
        lida.credencial,
        montarConversaoDoSite({
          ...base,
          evento: `Etapa:${idDoTeste}`,
          eventoMeta: null,
          valorCentavos: pedido.valor_centavos ?? null,
          identificadoresGoogle: { gclid: cadastro.gclid },
          somenteValidar: true,
        }),
      );
      doGoogle = {
        ...emTexto(r),
        ...(pedido.gclid ? {} : { nota: "Sem `gclid` o teste usa um clique fictício: o Google responde com erro de clique, o que já prova a conexão e a ação. Para o aceite completo, passe o gclid de um clique seu num anúncio." }),
      };
    }
  }

  void audit({
    action: "mia_regras_do_site.testado",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: TABELA_DAS_REGRAS_DO_SITE,
    resourceId: null,
    requestId: c.requestId,
    metadata: { evento, meta: daMeta.tipo, google: acao ? String(doGoogle?.aceito) : "nao_testado", via: "mcp_plataforma" },
  });

  return {
    pessoa_de_teste: PESSOA_DE_TESTE.nome,
    evento,
    meta: { ...emTexto(daMeta), onde_ver: 'Gerenciador de Eventos › dataset do site › "Testar eventos".' },
    google: doGoogle ?? { testado: false, porque: "Passe `acao_de_conversao_id` para validar no Google Ads (validateOnly: nada é importado)." },
    livro_razao: "Nada foi gravado: o teste não aparece nos envios nem nas regras.",
  };
}

/** A página do cadastro, pelo endereço do app no ambiente (o domínio nunca fica no código). */
function paginaDoCadastro(): string | null {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(base) ? `${base}/signup` : null;
}
