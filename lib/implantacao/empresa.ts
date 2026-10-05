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
 *                      revisado (`paisesOferecidos`), como na tela.
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
import { tenantSchema } from "@/lib/schemas/settings";
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
  modo_de_venda?: "b2b" | "b2c";
  dias_de_retencao_de_midia?: number;
  email_do_encarregado?: string | null;
  politica_de_privacidade_url?: string | null;
}

const ROTULO: Record<string, string> = {
  display_name: "nome",
  legal_name: "razão social",
  cnpj: "CNPJ",
  country: "país",
  timezone: "fuso",
  locale: "idioma",
  currency: "moeda",
  media_retention_days: "retenção de mídia",
  dpo_email: "e-mail do encarregado",
  privacy_policy_url: "política de privacidade",
  modo_de_venda: "modo de venda",
};

export async function configurarEmpresa(
  c: Implantacao,
  org: OrganizacaoDaImplantacao,
  pedido: PedidoDeEmpresa,
): Promise<{ desfecho: Desfecho; mudancas: string[]; empresa: Record<string, unknown> }> {
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
    await mudarSettingsDaOrganizacao(
      c.admin,
      c.orgId,
      (settings) => (modoMudou ? { ...settings, modo_de_venda: d.modo_de_venda } : null),
      colunas,
    );
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
    },
  };
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
    const novo: Record<string, unknown> = assinaturaMudou
      ? { ...mesclado, assinatura_mensagens: assinaturaPedida }
      : mesclado;

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

  return { desfecho: mudou ? "atualizou" : "ja_estava", mudancas: mudou ? mudancas : [], atendimento: retrato };
}
