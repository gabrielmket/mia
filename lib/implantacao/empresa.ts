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
 *                      o cliente novo e o que cada atendente enxerga.
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
import { paisesOferecidos } from "@/lib/legal/perfil-do-pais";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import {
  atendimentoConfigPatchSchema,
  mesclarSettingsDeAtendimento,
  routingConfigSchema,
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

export interface PedidoDeAtendimento {
  /** `manual`: alguém assume cada conversa. `round_robin`: rodízio entre quem está de plantão. */
  modo?: "manual" | "round_robin";
  /** O que o papel Atendente enxerga: tudo, o que é dele e o que não tem dono, ou só o que é dele. */
  visibilidade?: "all" | "own_and_unassigned" | "own";
  /** Minutos sem sinal de uma pessoa até a conversa voltar para a IA. `null` = nunca volta sozinha. */
  devolver_para_a_ia_apos_minutos?: number | null;
  conversa_fica_com_quem_atendeu?: boolean;
}

export async function configurarAtendimento(
  c: Implantacao,
  pedido: PedidoDeAtendimento,
): Promise<{ desfecho: Desfecho; mudancas: string[]; atendimento: Record<string, unknown> }> {
  let mudancas: string[] = [];
  let retrato: Record<string, unknown> = {};

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
      ...(pedido.visibilidade !== undefined ? { visibility_mode: pedido.visibilidade } : {}),
    });
    if (!lido.success) {
      throw new Recusa(
        "A distribuição do atendimento não passou na conferência. `devolver_para_a_ia_apos_minutos` vai de 5 a 1440 (ou null para nunca devolver); " +
          '`modo` é "manual" ou "round_robin"; `visibilidade` é "all", "own_and_unassigned" ou "own".',
      );
    }

    const { settings: novo, routing } = mesclarSettingsDeAtendimento(settings, lido.data);
    mudancas = [];
    if (routing.mode !== atual.mode) mudancas.push("modo de distribuição");
    if (routing.handoff_return_after_minutes !== atual.handoff_return_after_minutes) mudancas.push("devolução para a IA");
    if (routing.conversation_stays_with_attendant !== atual.conversation_stays_with_attendant) {
      mudancas.push("conversa fica com quem atendeu");
    }
    const visibilidadeNova = (novo.visibility_mode as string | undefined) ?? DEFAULT_VISIBILITY_MODE;
    if (visibilidadeNova !== visibilidadeAtual) mudancas.push("visibilidade");
    retrato = {
      modo: routing.mode,
      visibilidade: visibilidadeNova,
      devolver_para_a_ia_apos_minutos: routing.handoff_return_after_minutes,
      conversa_fica_com_quem_atendeu: routing.conversation_stays_with_attendant,
    };

    // Uma organização que nunca abriu a tela não tem `settings.routing`: gravar
    // os padrões só para dizer "atualizei" seria uma escrita sem fato por trás.
    if (mudancas.length === 0 || mesmoConteudo(novo, settings)) return null;
    return novo;
  });

  if (mudou) {
    void audit({
      action: "routing.config_changed",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "organization",
      resourceId: c.orgId,
      requestId: c.requestId,
      metadata: { ...retrato, via: "mcp_plataforma" },
    });
  }

  return { desfecho: mudou ? "atualizou" : "ja_estava", mudancas: mudou ? mudancas : [], atendimento: retrato };
}
