/**
 * FORK MIA — os DADOS DA EMPRESA e a DISTRIBUIÇÃO DO ATENDIMENTO de um cliente.
 *
 * ── O caminho da tela que isto reusa ──────────────────────────────────────
 *
 *   dados da empresa   `tenantSchema` (`lib/schemas/settings.ts`), a régua de
 *                      Configurações › Organização (`updateTenant`): nome, razão
 *                      social, CNPJ, país, fuso, idioma, moeda, retenção de
 *                      mídia, encarregado, política de privacidade e o modo de
 *                      venda (B2B ou B2C). O país só entra se tem perfil
 *                      revisado (`paisesOferecidos`), como na tela. Desde o
 *                      upstream 1.74 (0557, #1534) a mesma régua carrega o
 *                      interruptor da limpeza automática de mídia antiga
 *                      (`media_retention_enforced`), e desde a 1.79 a gravação
 *                      da tela mora em `gravarDadosCadastrais`
 *                      (`lib/tenants/dados-cadastrais.ts`): CNPJ repetido vira
 *                      "Este CNPJ já pertence a outra organização.", e é a
 *                      mesma frase aqui.
 *   distribuição       `atendimentoConfigPatchSchema` e
 *                      `mesclarSettingsDeAtendimento` (`lib/schemas/routing.ts`),
 *                      a mescla de `PATCH /api/v1/settings/routing`: quem recebe
 *                      o cliente novo e o que cada atendente enxerga. Desde o
 *                      upstream 1.70 a mesma régua carrega o modo por menor
 *                      carga (`load`, #1711) e quanto a IA espera depois de uma
 *                      resposta pelo celular (`manual_reply_silence_minutes`,
 *                      #2005).
 *   quem fala          `assinaturaEntradaSchema` e `configAssinatura`
 *                      (`lib/messaging/assinatura.ts`), a régua de
 *                      `PATCH /api/v1/settings/assinatura` (upstream 1.70,
 *                      #2079): o nome de quem fala, em negrito, na linha de cima
 *                      da mensagem que vai ao cliente.
 *
 * ── O que é diferente da tela, e por quê ──────────────────────────────────
 *
 * A tela manda o formulário INTEIRO. A ferramenta recebe só o que muda: o que
 * não veio fica como está, e o que veio igual ao que já está gravado responde
 * "já estava". As duas escritas em `settings` (modo de venda e distribuição) vão
 * por `mudarSettingsDaOrganizacao`, que não pisa em quem gravou no meio.
 */
import { audit } from "@/lib/audit";
import { AI_DECIDE_PADRAO, CHAVE_DAS_AUTOMACOES } from "@/lib/automation/ai-decide-da-org";
import { gravarMeta } from "@/lib/crm/metas/gravar";
import { lerModoDeVenda } from "@/lib/empresas/modo-de-venda";
import { PRAZO_MAX_MINUTOS, PRAZO_MIN_MINUTOS } from "@/lib/escalacao/devolucao-automatica";
import { paisesOferecidos } from "@/lib/legal/perfil-do-pais";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { assinaturaEntradaSchema, configAssinatura } from "@/lib/messaging/assinatura";
import {
  atendimentoConfigPatchSchema,
  mesclarSettingsDeAtendimento,
  ROUTING_MODES,
  routingConfigSchema,
  type RoutingMode,
} from "@/lib/schemas/routing";
import { colegasPodemMexerNaAgendaLigado, meetAbertoLigado, tenantSchema } from "@/lib/schemas/settings";
import { DEFAULT_VISIBILITY_MODE } from "@/lib/auth/types";
import { fusoValido } from "@/lib/tempo/fusos";

import {
  mesmoConteudo,
  mudarSettingsDaOrganizacao,
  type Desfecho,
  type Implantacao,
  type OrganizacaoDaImplantacao,
} from "./base";

export interface PedidoDeEmpresa {
  nome?: string;
  razao_social?: string;
  cnpj?: string | null;
  pais?: string | null;
  fuso?: string;
  idioma?: string;
  moeda?: string;
  modo_de_venda?: "b2b" | "misto" | "b2c";
  dias_de_retencao_de_midia?: number;
  /**
   * A limpeza automática de mídia antiga (upstream 0557): ligada, a limpeza
   * diária apaga a mídia das conversas e o anexo de nota interna mais velhos que
   * `dias_de_retencao_de_midia`. Nasce ligada em toda empresa.
   */
  limpeza_automatica_de_midia?: boolean;
  email_do_encarregado?: string | null;
  politica_de_privacidade_url?: string | null;
  /**
   * FORK MIA (9030): a META DO MÊS da empresa inteira (faturamento dos ganhos,
   * `sales_targets` com a métrica `receita_total`, sem pessoa nem agente). É ela
   * que vira a barra do painel "Meta do mês" e a linha da meta no montador.
   * `mes` ausente = o mês corrente no fuso da empresa. Grava pelo mesmo upsert
   * da tela de Desempenho (`lib/crm/metas/gravar.ts`).
   */
  meta_do_mes?: { valor_cents: number; mes?: string };
}

/** A frase de `updateTenant` para o CNPJ que já é de outra organização (índice único). */
export const FRASE_DO_CNPJ_EM_USO = "Este CNPJ já pertence a outra organização.";

const ROTULO: Record<string, string> = {
  display_name: "nome",
  legal_name: "razão social",
  cnpj: "CNPJ",
  country: "país",
  timezone: "fuso",
  locale: "idioma",
  currency: "moeda",
  media_retention_days: "retenção de mídia",
  media_retention_enforced: "limpeza automática de mídia",
  dpo_email: "e-mail do encarregado",
  privacy_policy_url: "política de privacidade",
  modo_de_venda: "modo de venda",
};

export async function configurarEmpresa(
  c: Implantacao,
  org: OrganizacaoDaImplantacao,
  pedido: PedidoDeEmpresa,
): Promise<{ desfecho: Desfecho; mudancas: string[]; empresa: Record<string, unknown>; avisos: string[] }> {
  const avisos: string[] = [];
  if (pedido.fuso !== undefined && !fusoValido(pedido.fuso)) {
    throw new Recusa(
      `"${pedido.fuso}" não é um fuso horário válido. Use o nome da região, sem acento (ex.: "America/Sao_Paulo", "America/Manaus", "Europe/Lisbon").`,
    );
  }
  const pais = pedido.pais === undefined ? org.country : pedido.pais;
  if (pais && !paisesOferecidos().some((p) => p.codigo === pais)) {
    throw new Recusa(
      `País sem perfil revisado: "${pais}". Os países oferecidos são: ${paisesOferecidos().map((p) => p.codigo).join(", ")}.`,
    );
  }

  // O formulário inteiro, como a tela o mandaria: o que está gravado, com o
  // pedido por cima. É ele que passa pela régua da tela.
  const lido = tenantSchema.safeParse({
    display_name: pedido.nome ?? org.display_name,
    legal_name: pedido.razao_social ?? org.legal_name,
    cnpj: pedido.cnpj === undefined ? org.cnpj : pedido.cnpj,
    country: pais ?? null,
    timezone: pedido.fuso ?? org.timezone,
    locale: pedido.idioma ?? org.locale,
    currency: pedido.moeda ?? org.currency ?? "BRL",
    media_retention_days: pedido.dias_de_retencao_de_midia ?? org.media_retention_days ?? 365,
    // O schema da tela exige o interruptor desde a 1.74 (0557): vai o pedido, ou
    // o que está gravado (padrão do banco: ligado).
    media_retention_enforced: pedido.limpeza_automatica_de_midia ?? org.media_retention_enforced,
    dpo_email: pedido.email_do_encarregado === undefined ? org.dpo_email : pedido.email_do_encarregado,
    privacy_policy_url:
      pedido.politica_de_privacidade_url === undefined ? org.privacy_policy_url : pedido.politica_de_privacidade_url,
    modo_de_venda: pedido.modo_de_venda ?? lerModoDeVenda(org.settings),
  });
  if (!lido.success) {
    const dicas: Record<string, string> = {
      display_name: "`nome` precisa de 1 a 120 caracteres.",
      legal_name: "`razao_social` precisa de 1 a 200 caracteres.",
      cnpj: "`cnpj` aceita até 20 caracteres (ex.: \"00.000.000/0001-00\").",
      locale: "`idioma` aceita os idiomas que a interface serve (ex.: \"pt-BR\", \"es\").",
      currency: "`moeda` aceita as moedas servidas (ex.: \"BRL\", \"USD\", \"EUR\").",
      media_retention_days: "`dias_de_retencao_de_midia` vai de 30 a 3650.",
      dpo_email: "`email_do_encarregado` precisa ser um e-mail.",
      privacy_policy_url: "`politica_de_privacidade_url` precisa ser um endereço completo (https://...).",
      country: "`pais` usa duas letras maiúsculas (ex.: \"BR\").",
    };
    throw new Recusa(
      "Os dados da empresa não passaram na conferência:\n- " +
        [...new Set(lido.error.issues.map((i) => dicas[String(i.path[0])] ?? `${i.path.join(".")}: ${i.message}`))].join("\n- "),
    );
  }
  const d = lido.data;

  const colunas: Record<string, unknown> = {};
  const comparar: Array<[string, unknown, unknown]> = [
    ["display_name", org.display_name, d.display_name],
    ["legal_name", org.legal_name, d.legal_name],
    ["cnpj", org.cnpj ?? null, d.cnpj ?? null],
    ["country", org.country ?? null, d.country ?? null],
    ["timezone", org.timezone, d.timezone],
    ["locale", org.locale, d.locale],
    ["currency", org.currency ?? "BRL", d.currency],
    ["media_retention_days", org.media_retention_days ?? 365, d.media_retention_days],
    ["media_retention_enforced", org.media_retention_enforced, d.media_retention_enforced],
    ["dpo_email", org.dpo_email ?? null, d.dpo_email ?? null],
    ["privacy_policy_url", org.privacy_policy_url ?? null, d.privacy_policy_url ?? null],
  ];
  for (const [coluna, atual, novo] of comparar) {
    if (atual !== novo) colunas[coluna] = novo;
  }
  const mudancas = Object.keys(colunas).map((k) => ROTULO[k] ?? k);

  // O modo de venda mora em `settings`, e só é gravado quando MUDA: é a regra
  // da tela, para o salvamento de todo dia não tocar no jsonb.
  const modoMudou = d.modo_de_venda !== lerModoDeVenda(org.settings);
  if (modoMudou) mudancas.push(ROTULO.modo_de_venda!);

  if (mudancas.length > 0) {
    try {
      await mudarSettingsDaOrganizacao(
        c.admin,
        c.orgId,
        (settings) => (modoMudou ? { ...settings, modo_de_venda: d.modo_de_venda } : null),
        colunas,
      );
    } catch (err) {
      // CNPJ é único na instalação (desde a 1.79, `gravarDadosCadastrais` dá a
      // mesma frase), em vez do texto do Postgres.
      if ((err as { code?: string } | null)?.code === "23505") throw new Recusa(`${FRASE_DO_CNPJ_EM_USO} Confira o número e chame de novo.`);
      throw err instanceof Error ? err : new Error(`não consegui gravar os dados da empresa: ${(err as { message?: string })?.message ?? "erro"}`);
    }
    if (colunas.media_retention_enforced === true) {
      avisos.push(
        `A limpeza automática de mídia antiga ficou LIGADA: a partir da próxima limpeza diária, a mídia das conversas e o anexo de nota interna com mais de ${d.media_retention_days} dias são apagados, sem volta. ` +
          "A nota e a mensagem continuam; só o arquivo sai.",
      );
    }
    if (colunas.media_retention_enforced === false) {
      avisos.push("A limpeza automática de mídia antiga ficou DESLIGADA: a mídia das conversas deixa de ser apagada por idade e o armazenamento passa a crescer sem teto.");
    }
    void audit({
      action: "org.updated",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "organization",
      resourceId: c.orgId,
      requestId: c.requestId,
      metadata: { fields_changed: [...Object.keys(colunas), ...(modoMudou ? ["modo_de_venda"] : [])], via: "mcp_plataforma" },
    });
    await c.admin
      .rpc("emit_event", {
        p_event_type: "org.updated",
        p_entity_kind: "organization",
        p_entity_id: c.orgId,
        p_payload: { organization_id: c.orgId },
        p_metadata: { request_id: c.requestId },
        p_organization_id: c.orgId,
      })
      .then(({ error }) => {
        if (error) console.error("[implantacao/empresa] emit_event failed", error.message);
      });
  }

  let metaDoMes: { mes: string; valor_cents: number } | null = null;
  if (pedido.meta_do_mes) {
    const r = await garantirMetaDoMes(c, d.timezone, pedido.meta_do_mes);
    metaDoMes = { mes: r.mes, valor_cents: r.valor_cents };
    if (r.mudou) mudancas.push("meta do mês");
  }

  return {
    desfecho: mudancas.length > 0 ? "atualizou" : "ja_estava",
    mudancas,
    empresa: {
      nome: d.display_name,
      razao_social: d.legal_name,
      cnpj: d.cnpj ?? null,
      pais: d.country ?? null,
      fuso: d.timezone,
      idioma: d.locale,
      moeda: d.currency,
      modo_de_venda: d.modo_de_venda,
      dias_de_retencao_de_midia: d.media_retention_days,
      limpeza_automatica_de_midia: d.media_retention_enforced,
      ...(metaDoMes ? { meta_do_mes: metaDoMes } : {}),
    },
    avisos,
  };
}

/** AAAA-MM de hoje no fuso da empresa. */
export function mesCorrenteNoFuso(fuso: string, agora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit" }).formatToParts(
    agora,
  );
  const ano = partes.find((p) => p.type === "year")?.value ?? String(agora.getUTCFullYear());
  const mes = partes.find((p) => p.type === "month")?.value ?? String(agora.getUTCMonth() + 1).padStart(2, "0");
  return `${ano}-${mes}`;
}

/**
 * FORK MIA (9030) — a meta do mês da empresa inteira (receita dos ganhos).
 * "Garantir": a mesma meta já gravada responde sem escrever; outra, regrava pelo
 * upsert da tela (`lib/crm/metas/gravar.ts`).
 */
export async function garantirMetaDoMes(
  c: Implantacao,
  fuso: string,
  pedido: { valor_cents: number; mes?: string },
  agora: Date = new Date(),
): Promise<{ mudou: boolean; mes: string; valor_cents: number }> {
  if (!Number.isInteger(pedido.valor_cents) || pedido.valor_cents <= 0) {
    throw new Recusa(
      "`meta_do_mes.valor_cents` precisa ser um número inteiro de centavos, maior que zero (ex.: 10000000 para R$ 100.000,00).",
    );
  }
  const mes = pedido.mes ?? mesCorrenteNoFuso(fuso, agora);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    throw new Recusa(`\`meta_do_mes.mes\` usa AAAA-MM (ex.: "2026-10"); veio "${mes}".`);
  }
  const { data: atual, error: erroDeLeitura } = await c.admin
    .from("sales_targets")
    .select("id, alvo_cents")
    .eq("organization_id", c.orgId)
    .eq("periodo", `${mes}-01`)
    .eq("metrica", "receita_total")
    .is("user_id", null)
    .is("agent_id", null)
    .maybeSingle();
  if (erroDeLeitura) throw new Error(`não consegui ler a meta: ${erroDeLeitura.message}`);
  if (atual && Number((atual as { alvo_cents: number | string | null }).alvo_cents) === pedido.valor_cents) {
    return { mudou: false, mes, valor_cents: pedido.valor_cents };
  }
  const { error } = await gravarMeta(c.admin, {
    organizationId: c.orgId,
    periodo: mes,
    metrica: "receita_total",
    alvo_cents: pedido.valor_cents,
    created_by: c.autorUserId,
  });
  if (error) throw new Error(`não consegui gravar a meta do mês: ${error.message}`);
  void audit({
    action: "org.updated",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "organization",
    resourceId: c.orgId,
    requestId: c.requestId,
    metadata: { fields_changed: ["meta_do_mes"], mes, via: "mcp_plataforma" },
  });
  return { mudou: true, mes, valor_cents: pedido.valor_cents };
}

// ---------------------------------------------------------------------------
// distribuição do atendimento
// ---------------------------------------------------------------------------

/** Quem fala, em negrito, na linha de cima da mensagem (`organizations.settings.assinatura_mensagens`). */
export interface PedidoDeAssinatura {
  /** Assina as mensagens das pessoas da equipe com o nome de quem respondeu. */
  atendentes?: boolean;
  /** Assina as mensagens da IA com `nome_da_ia`. */
  ia?: boolean;
  nome_da_ia?: string;
}

interface AssinaturaGravada {
  humanos: boolean;
  ia: boolean;
  nome_ia: string;
}

export interface PedidoDeAtendimento {
  /**
   * `manual`: alguém assume cada conversa. `round_robin`: rodízio entre quem
   * está de plantão. `load`: vai para quem está com MENOS conversas, e o rodízio
   * desempata (upstream 1.70, #1711).
   */
  modo?: RoutingMode;
  /** O que o papel Atendente enxerga: tudo, o que é dele e o que não tem dono, ou só o que é dele. */
  visibilidade?: "all" | "own_and_unassigned" | "own";
  /** Minutos sem sinal de uma pessoa até a conversa voltar para a IA. `null` = nunca volta sozinha. */
  devolver_para_a_ia_apos_minutos?: number | null;
  conversa_fica_com_quem_atendeu?: boolean;
  /**
   * Minutos que a IA fica calada depois que alguém da equipe responde por FORA
   * do sistema (pelo celular). `null` = o padrão de 60 (upstream 1.70, #2005).
   */
  ia_espera_apos_resposta_pelo_celular_minutos?: number | null;
  /** Só as chaves que vieram mudam (upstream 1.70, #2079). */
  assinatura?: PedidoDeAssinatura;
  /**
   * O freio da empresa para o passo "a IA decide" das automações (upstream
   * 1.76, #2367): `false` faz toda ação `ai_decide` da empresa parar sem
   * consultar o modelo. Mora em `settings.automacoes.ai_decide`, padrão ligado.
   */
  ia_decide_nas_automacoes?: boolean;
  /**
   * .81 — "Atendentes podem mexer na agenda dos colegas" (upstream 1.80, #978):
   * `settings.colegas_podem_mexer_na_agenda`, ligado por padrão (só o `false`
   * gravado desliga). A função do upstream (`fn_definir_colegas_podem_mexer_na_agenda`)
   * exige sessão com a verificação em duas etapas; o token não tem sessão, e a
   * gravação é a mescla da chave de topo, pelo servidor, com a auditoria dela.
   */
  colegas_podem_mexer_na_agenda?: boolean;
  /**
   * .81 — "Google Meet já com acesso aberto" (upstream 1.81, #2063, 0648):
   * `settings.google_meet_acesso_aberto`, desligado por padrão (só o `true`
   * liga). Mesma razão da opção de cima para gravar pelo servidor.
   */
  google_meet_com_acesso_aberto?: boolean;
}

/** O freio do `ai_decide` como o motor o lê (`aiDecideLigado`): só `false` gravado desliga. */
export function iaDecideLigadaNa(settings: Record<string, unknown>): boolean {
  const automacoes = settings[CHAVE_DAS_AUTOMACOES];
  if (!automacoes || typeof automacoes !== "object" || Array.isArray(automacoes)) return AI_DECIDE_PADRAO;
  const bruto = (automacoes as Record<string, unknown>).ai_decide;
  return typeof bruto === "boolean" ? bruto : AI_DECIDE_PADRAO;
}

export async function configurarAtendimento(
  c: Implantacao,
  pedido: PedidoDeAtendimento,
): Promise<{ desfecho: Desfecho; mudancas: string[]; atendimento: Record<string, unknown> }> {
  let mudancas: string[] = [];
  let retrato: Record<string, unknown> = {};
  // O que cada metade gravou, para a auditoria de cada uma sair com o nome que
  // a rota dela dá (`routing.config_changed` e `settings.message_signature_updated`).
  let distribuicao: Record<string, unknown> = {};
  let mudouDistribuicao = false;
  // `as` no inicializador: sem ele o TypeScript estreita para `null` e não vê a escrita feita dentro da função de mescla.
  let assinaturaGravada = null as AssinaturaGravada | null;
  let iaDecideGravada = null as boolean | null;
  let colegasGravado = null as boolean | null;
  let meetGravado = null as boolean | null;

  const { mudou } = await mudarSettingsDaOrganizacao(c.admin, c.orgId, (settings) => {
    const atual = routingConfigSchema.catch(routingConfigSchema.parse({})).parse(settings.routing ?? {});
    const visibilidadeAtual = (settings.visibility_mode as string | undefined) ?? DEFAULT_VISIBILITY_MODE;

    const lido = atendimentoConfigPatchSchema.safeParse({
      ...atual,
      ...(pedido.modo !== undefined ? { mode: pedido.modo } : {}),
      ...(pedido.devolver_para_a_ia_apos_minutos !== undefined
        ? { handoff_return_after_minutes: pedido.devolver_para_a_ia_apos_minutos }
        : {}),
      ...(pedido.conversa_fica_com_quem_atendeu !== undefined
        ? { conversation_stays_with_attendant: pedido.conversa_fica_com_quem_atendeu }
        : {}),
      ...(pedido.ia_espera_apos_resposta_pelo_celular_minutos !== undefined
        ? { manual_reply_silence_minutes: pedido.ia_espera_apos_resposta_pelo_celular_minutos }
        : {}),
      ...(pedido.visibilidade !== undefined ? { visibility_mode: pedido.visibilidade } : {}),
    });
    if (!lido.success) {
      throw new Recusa(
        "A distribuição do atendimento não passou na conferência. " +
          `\`devolver_para_a_ia_apos_minutos\` e \`ia_espera_apos_resposta_pelo_celular_minutos\` vão de ${PRAZO_MIN_MINUTOS} a ${PRAZO_MAX_MINUTOS} (ou null); ` +
          `\`modo\` é ${ROUTING_MODES.map((m) => `"${m}"`).join(", ")}; \`visibilidade\` é "all", "own_and_unassigned" ou "own".`,
      );
    }

    // Quem fala: o que está gravado, lido como o envio lê (`configAssinatura`),
    // com o pedido por cima; o resultado passa pela régua da rota.
    const assinaturaAtual = configAssinatura(settings);
    let assinaturaPedida: AssinaturaGravada | null = null;
    if (pedido.assinatura !== undefined) {
      const conferida = assinaturaEntradaSchema.safeParse({
        humanos: pedido.assinatura.atendentes ?? assinaturaAtual.humanos,
        ia: pedido.assinatura.ia ?? assinaturaAtual.ia,
        nome_ia: pedido.assinatura.nome_da_ia ?? assinaturaAtual.nomeIa,
      });
      if (!conferida.success) {
        throw new Recusa(
          "A assinatura de quem fala não passou na conferência. `assinatura.nome_da_ia` tem de 1 a 120 caracteres, sem asterisco e sem quebra de linha " +
            '(o nome vai em negrito, numa linha só). Ex.: { "atendentes": true, "ia": true, "nome_da_ia": "Assistente Virtual" }.',
        );
      }
      assinaturaPedida = conferida.data;
    }
    const assinaturaMudou =
      assinaturaPedida !== null &&
      (assinaturaPedida.humanos !== assinaturaAtual.humanos ||
        assinaturaPedida.ia !== assinaturaAtual.ia ||
        assinaturaPedida.nome_ia !== assinaturaAtual.nomeIa);

    const { settings: mesclado, routing } = mesclarSettingsDeAtendimento(settings, lido.data);
    // A chave da assinatura só é escrita quando MUDA: a organização que nunca a
    // ligou não ganha a chave porque o pedido repetiu o padrão.
    let novo: Record<string, unknown> = assinaturaMudou
      ? { ...mesclado, assinatura_mensagens: assinaturaPedida }
      : mesclado;

    // O freio do `ai_decide`: a mescla nos DOIS níveis de `definirAiDecideDaEmpresa`
    // (o resto de `settings.automacoes` fica), e só quando o valor MUDA.
    const iaDecideAtual = iaDecideLigadaNa(settings);
    const iaDecideMudou =
      pedido.ia_decide_nas_automacoes !== undefined && pedido.ia_decide_nas_automacoes !== iaDecideAtual;
    if (iaDecideMudou) {
      const automacoes = (settings[CHAVE_DAS_AUTOMACOES] ?? {}) as Record<string, unknown>;
      novo = { ...novo, [CHAVE_DAS_AUTOMACOES]: { ...automacoes, ai_decide: pedido.ia_decide_nas_automacoes } };
    }

    // .81 — as duas opções da agenda: chave de TOPO, como as funções do upstream
    // gravam (`settings || jsonb_build_object(...)`), e só quando o valor MUDA,
    // lido pela MESMA régua da tela (`colegasPodemMexerNaAgendaLigado`, `meetAbertoLigado`).
    const colegasAtual = colegasPodemMexerNaAgendaLigado(settings);
    const colegasMudou =
      pedido.colegas_podem_mexer_na_agenda !== undefined && pedido.colegas_podem_mexer_na_agenda !== colegasAtual;
    if (colegasMudou) novo = { ...novo, colegas_podem_mexer_na_agenda: pedido.colegas_podem_mexer_na_agenda };
    const meetAtual = meetAbertoLigado(settings);
    const meetMudou =
      pedido.google_meet_com_acesso_aberto !== undefined && pedido.google_meet_com_acesso_aberto !== meetAtual;
    if (meetMudou) novo = { ...novo, google_meet_acesso_aberto: pedido.google_meet_com_acesso_aberto };

    mudancas = [];
    if (routing.mode !== atual.mode) mudancas.push("modo de distribuição");
    if (routing.handoff_return_after_minutes !== atual.handoff_return_after_minutes) mudancas.push("devolução para a IA");
    if (routing.conversation_stays_with_attendant !== atual.conversation_stays_with_attendant) {
      mudancas.push("conversa fica com quem atendeu");
    }
    if (routing.manual_reply_silence_minutes !== atual.manual_reply_silence_minutes) {
      mudancas.push("espera da IA depois de resposta pelo celular");
    }
    const visibilidadeNova = (novo.visibility_mode as string | undefined) ?? DEFAULT_VISIBILITY_MODE;
    if (visibilidadeNova !== visibilidadeAtual) mudancas.push("visibilidade");
    mudouDistribuicao = mudancas.length > 0;
    if (assinaturaMudou) mudancas.push("assinatura de quem fala");
    assinaturaGravada = assinaturaMudou ? assinaturaPedida : null;
    if (iaDecideMudou) mudancas.push("a IA decide nas automações");
    iaDecideGravada = iaDecideMudou ? (pedido.ia_decide_nas_automacoes as boolean) : null;
    if (colegasMudou) mudancas.push("colegas podem mexer na agenda");
    colegasGravado = colegasMudou ? (pedido.colegas_podem_mexer_na_agenda as boolean) : null;
    if (meetMudou) mudancas.push("Google Meet com acesso aberto");
    meetGravado = meetMudou ? (pedido.google_meet_com_acesso_aberto as boolean) : null;

    const assinaturaFinal: AssinaturaGravada = assinaturaPedida ?? {
      humanos: assinaturaAtual.humanos,
      ia: assinaturaAtual.ia,
      nome_ia: assinaturaAtual.nomeIa,
    };
    distribuicao = {
      modo: routing.mode,
      visibilidade: visibilidadeNova,
      devolver_para_a_ia_apos_minutos: routing.handoff_return_after_minutes,
      conversa_fica_com_quem_atendeu: routing.conversation_stays_with_attendant,
      ia_espera_apos_resposta_pelo_celular_minutos: routing.manual_reply_silence_minutes,
    };
    retrato = {
      ...distribuicao,
      assinatura: { atendentes: assinaturaFinal.humanos, ia: assinaturaFinal.ia, nome_da_ia: assinaturaFinal.nome_ia },
      ia_decide_nas_automacoes: iaDecideMudou ? pedido.ia_decide_nas_automacoes : iaDecideAtual,
      colegas_podem_mexer_na_agenda: colegasMudou ? pedido.colegas_podem_mexer_na_agenda : colegasAtual,
      google_meet_com_acesso_aberto: meetMudou ? pedido.google_meet_com_acesso_aberto : meetAtual,
    };

    // Uma organização que nunca abriu a tela não tem `settings.routing`: gravar
    // os padrões só para dizer "atualizei" seria uma escrita sem fato por trás.
    if (mudancas.length === 0 || mesmoConteudo(novo, settings)) return null;
    return novo;
  });

  if (mudou && mudouDistribuicao) {
    void audit({
      action: "routing.config_changed",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "organization",
      resourceId: c.orgId,
      requestId: c.requestId,
      metadata: { ...distribuicao, via: "mcp_plataforma" },
    });
  }
  if (mudou && assinaturaGravada !== null) {
    // A mesma linha de `PATCH /api/v1/settings/assinatura`.
    void audit({
      action: "settings.message_signature_updated",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "organization",
      resourceId: c.orgId,
      requestId: c.requestId,
      metadata: { ...assinaturaGravada, via: "mcp_plataforma" },
    });
  }
  if (mudou && iaDecideGravada !== null) {
    // A mesma linha de `definirAiDecideDaEmpresa` (Configurações › Automações).
    void audit({
      action: "settings.automation_ai_decide_updated",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "organization",
      resourceId: c.orgId,
      requestId: c.requestId,
      metadata: { ligado: iaDecideGravada, via: "mcp_plataforma" },
    });
  }

  if (mudou && colegasGravado !== null) {
    // A mesma linha de `definirAgendaDosColegas` (Configurações › Agenda).
    void audit({
      action: "agenda.colegas_podem_mexer_alterado",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "organization",
      resourceId: c.orgId,
      requestId: c.requestId,
      metadata: { ligado: colegasGravado, mudou: true, via: "mcp_plataforma" },
    });
  }
  if (mudou && meetGravado !== null) {
    // A mesma linha de `definirMeetAberto` (Configurações › Agenda).
    void audit({
      action: "agenda.meet_acesso_aberto_alterado",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "organization",
      resourceId: c.orgId,
      requestId: c.requestId,
      metadata: { ligado: meetGravado, mudou: true, via: "mcp_plataforma" },
    });
  }

  return { desfecho: mudou ? "atualizou" : "ja_estava", mudancas: mudou ? mudancas : [], atendimento: retrato };
}
