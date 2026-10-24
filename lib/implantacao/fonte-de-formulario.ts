/**
 * FORK MIA — GARANTIR uma FONTE DE FORMULÁRIO de um cliente: a entrada de
 * contatos por onde o formulário do site (ou outro sistema) põe gente no CRM sem
 * ninguém digitar (`webhook_sources`).
 *
 * ── O que chegou do upstream 1.74 a 1.80 ──────────────────────────────────
 *
 *  - as PERGUNTAS do formulário (`form_fields`, 0595): até 20, cada uma com
 *    chave, texto, tipo e se é obrigatória. A tela gera o HTML do formulário a
 *    partir delas, e o que a pessoa responde vira campo do negócio;
 *  - AUTORIZAR O ATENDIMENTO POR IA na captação (`authorize_ai_on_capture`,
 *    0577): com o envio completo e o consentimento explícito para atendimento
 *    automatizado no próprio formulário, o contato novo fica autorizado para a
 *    IA. Nasce desligada, e só liga com a ASSINATURA da fonte configurada
 *    (`assinaturaObrigatoriaAusente`): é ela que prova que o envio veio do
 *    integrador.
 *
 * ── O que chegou do upstream 1.84 (.82) ───────────────────────────────────
 *
 *  - ATUALIZAR O CARD NO REENVIO (`update_existing_lead_on_capture`, 0683,
 *    #2316): o envio que repete o `external_id` de um card que ESTA fonte criou
 *    atualiza o card (campos novos, nome, e o campo reservado `stage` move de
 *    etapa) em vez de ser descartado como reenvio. Nasce desligada, só entra no
 *    PATCH (fonte nova não nasce com ela) e exige a ASSINATURA, pela mesma
 *    régua da autorização de IA (`opcaoSemAssinatura`), com a frase de cada
 *    opção.
 *
 * ── O que chegou do upstream 1.88 (.86) ───────────────────────────────────
 *
 *  - REAPROVEITAR O CARD ABERTO (`reuse_open_lead_on_capture`, 0722, #3101):
 *    o envio SEM `external_id` de quem já tem card ABERTO no funil da fonte
 *    atualiza esse card (campos novos e a etapa da fonte, sempre para a
 *    frente) em vez de abrir outro. Mesma régua da opção irmã: nasce
 *    desligada, só entra no PATCH e exige a ASSINATURA (`opcaoSemAssinatura`).
 *
 * ── O caminho da tela que isto espelha ────────────────────────────────────
 *
 *   criar    `POST /api/v1/webhook-sources`: `createWebhookSourceSchema` e
 *            `criarEntradaAutomatica` (`lib/operacao/entradas-automaticas.ts`,
 *            a função que a rota e o MCP de cliente chamam), que confere funil e
 *            etapa contra a organização e deixa `webhook.source_created`
 *   editar   `PATCH /api/v1/webhook-sources/[id]`: `updateWebhookSourceSchema`,
 *            a recusa da autorização de IA sem assinatura, a autoria da mudança
 *            e `webhook.source_updated`
 *
 * ── O que NÃO entra por aqui ──────────────────────────────────────────────
 *
 *  - o SEGREDO da assinatura: é credencial, aparece uma vez na tela, e quem o
 *    põe é uma pessoa (Automações › Fontes). Sem ele a autorização de IA não liga;
 *  - ligar e desligar a fonte: desligar faz o formulário que já está no site
 *    parar de virar contato na hora, e isso fica com a pessoa na tela;
 *  - apagar a fonte.
 */
import { audit } from "@/lib/audit";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { autoriaDaMudanca } from "@/lib/operacao/autoria";
import { criarEntradaAutomatica, type FonteVisivel } from "@/lib/operacao/entradas-automaticas";
import { createWebhookSourceSchema, updateWebhookSourceSchema } from "@/lib/schemas/webhooks";
import { opcaoSemAssinatura } from "@/lib/webhooks/assinatura-autorizacao";
import type { WebhookFormField } from "@/lib/webhooks/formulario";
import { ApiError } from "@/lib/api/types";

import { acharPorNomeOuId, atorDaImplantacao, chaveDoNome, mesmoConteudo, type Desfecho, type Implantacao } from "./base";

export const TETO_DE_PERGUNTAS = 20;

export interface PerguntaPedida {
  chave: string;
  pergunta: string;
  tipo: WebhookFormField["type"];
  obrigatoria?: boolean;
  opcoes?: string[];
}

export interface PedidoDeFonte {
  nome: string;
  /** Para renomear ou desambiguar. Sem ele, a fonte é achada pelo nome. */
  fonte_id?: string;
  /** Para onde vão os contatos: obrigatório para criar. */
  destino?: { funil: string; etapa: string };
  /** A lista COMPLETA de perguntas, na ordem. Substitui a que existe. */
  perguntas?: PerguntaPedida[];
  /** Os nomes de campo que o sistema de fora manda para nome, telefone e e-mail. */
  mapeamento?: { nome?: string[]; telefone?: string[]; email?: string[] };
  endereco_de_retorno?: string | null;
  autorizar_ia_na_captura?: boolean;
  /** .82 (upstream 1.84, 0683): o reenvio do mesmo `external_id` atualiza o card desta fonte. */
  atualizar_card_no_reenvio?: boolean;
  /** .86 (upstream 1.88, 0722): o envio sem `external_id` reaproveita o card aberto do contato no funil. */
  reaproveitar_card_aberto?: boolean;
}

interface LinhaDaFonte {
  id: string;
  name: string;
  is_active: boolean;
  path_token: string;
  default_pipeline_id: string;
  default_stage_id: string;
  redirect_to: string | null;
  field_map: Record<string, unknown> | null;
  form_fields: unknown;
  authorize_ai_on_capture: boolean;
  update_existing_lead_on_capture: boolean;
  reuse_open_lead_on_capture: boolean;
  secret_encrypted: string | null;
}

const COLUNAS =
  "id, name, is_active, path_token, default_pipeline_id, default_stage_id, redirect_to, field_map, form_fields, authorize_ai_on_capture, update_existing_lead_on_capture, reuse_open_lead_on_capture, secret_encrypted";

export async function lerFontes(c: Pick<Implantacao, "admin" | "orgId">): Promise<LinhaDaFonte[]> {
  const { data, error } = await c.admin
    .from("webhook_sources")
    .select(COLUNAS)
    .eq("organization_id", c.orgId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`não consegui ler as fontes de formulário: ${error.message}`);
  return (data ?? []) as unknown as LinhaDaFonte[];
}

/** O endereço que o formulário chama. O caminho é sempre o mesmo; o domínio é o da instalação. */
export function enderecoDeCaptacao(pathToken: string): { caminho: string; endereco: string | null } {
  const caminho = `/api/v1/webhooks/in/${pathToken}`;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  return { caminho, endereco: /^https?:\/\//.test(base) ? `${base}${caminho}` : null };
}

/** A fonte para a leitura e para a resposta: SEM o segredo, com o fato de haver um. */
export function retratoDaFonte(
  f: Pick<LinhaDaFonte, "id" | "name" | "is_active" | "path_token" | "redirect_to" | "field_map" | "form_fields" | "authorize_ai_on_capture"> & {
    /** Ausente na fonte que acabou de nascer pela função do upstream: nasce desligada. */
    update_existing_lead_on_capture?: boolean | null;
    reuse_open_lead_on_capture?: boolean | null;
    has_secret?: boolean;
    secret_encrypted?: string | null;
  },
  funis: Array<{ id: string; name: string; etapas: Array<{ id: string; name: string }> }>,
  destino: { pipeline_id: string; stage_id: string },
): Record<string, unknown> {
  const funil = funis.find((x) => x.id === destino.pipeline_id);
  const etapa = funil?.etapas.find((e) => e.id === destino.stage_id);
  const captacao = enderecoDeCaptacao(f.path_token);
  return {
    id: f.id,
    nome: f.name,
    ligada: f.is_active,
    destino: { funil: funil?.name ?? destino.pipeline_id, etapa: etapa?.name ?? destino.stage_id },
    caminho_de_captacao: captacao.caminho,
    ...(captacao.endereco ? { endereco_de_captacao: captacao.endereco } : {}),
    endereco_de_retorno: f.redirect_to ?? null,
    mapeamento: f.field_map ?? {},
    perguntas: (Array.isArray(f.form_fields) ? (f.form_fields as WebhookFormField[]) : []).map((p) => ({
      chave: p.key,
      pergunta: p.label,
      tipo: p.type,
      obrigatoria: p.required === true,
      ...(p.options ? { opcoes: p.options } : {}),
    })),
    tem_assinatura: f.has_secret ?? Boolean(f.secret_encrypted),
    autorizar_ia_na_captura: f.authorize_ai_on_capture === true,
    atualizar_card_no_reenvio: f.update_existing_lead_on_capture === true,
    reaproveitar_card_aberto: f.reuse_open_lead_on_capture === true,
  };
}

async function lerFunisComEtapas(c: Implantacao): Promise<Array<{ id: string; name: string; etapas: Array<{ id: string; name: string; is_archived: boolean }> }>> {
  const [funis, etapas] = await Promise.all([
    c.admin.from("crm_pipelines").select("id, name, is_archived, position").eq("organization_id", c.orgId).order("position", { ascending: true }),
    c.admin.from("crm_stages").select("id, name, pipeline_id, position, is_archived").eq("organization_id", c.orgId).order("position", { ascending: true }),
  ]);
  if (funis.error) throw new Error(`não consegui ler os funis: ${funis.error.message}`);
  if (etapas.error) throw new Error(`não consegui ler as etapas: ${etapas.error.message}`);
  type Etapa = { id: string; name: string; pipeline_id: string; is_archived: boolean | null };
  return ((funis.data ?? []) as unknown as Array<{ id: string; name: string; is_archived: boolean }>)
    .filter((f) => !f.is_archived)
    .map((f) => ({
      id: f.id,
      name: f.name,
      etapas: ((etapas.data ?? []) as unknown as Etapa[])
        .filter((e) => e.pipeline_id === f.id)
        .map((e) => ({ id: e.id, name: e.name, is_archived: e.is_archived === true })),
    }));
}

/** Funil e etapa pelo nome (ou id), DENTRO desta organização; etapa arquivada não é destino. */
function resolverDestino(
  funis: Awaited<ReturnType<typeof lerFunisComEtapas>>,
  destino: { funil: string; etapa: string },
): { pipeline_id: string; stage_id: string } {
  const funil = acharPorNomeOuId(funis, destino.funil, (f) => f.name, {
    singular: "o funil",
    comoListar: "Crie o funil com plataforma_garantir_funil, ou veja os que existem em plataforma_ver_funis.",
  });
  const vivas = funil.etapas.filter((e) => !e.is_archived);
  const ref = destino.etapa.trim();
  const etapa = vivas.find((e) => e.id === ref || chaveDoNome(e.name) === chaveDoNome(ref));
  if (!etapa) {
    throw new Recusa(
      `\`destino.etapa\`: o funil «${funil.name}» não tem uma etapa em uso chamada «${ref}». As etapas são: ${vivas.map((e) => `«${e.name}»`).join(", ")}.`,
    );
  }
  return { pipeline_id: funil.id, stage_id: etapa.id };
}

function perguntasParaOBanco(perguntas: PerguntaPedida[]): Array<Record<string, unknown>> {
  return perguntas.map((p) => ({
    key: p.chave,
    label: p.pergunta,
    type: p.tipo,
    required: p.obrigatoria === true,
    ...(p.opcoes !== undefined ? { options: p.opcoes } : {}),
  }));
}

function mapeamentoParaOBanco(m: PedidoDeFonte["mapeamento"]): Record<string, string[]> | undefined {
  if (m === undefined) return undefined;
  return {
    ...(m.nome ? { name: m.nome } : {}),
    ...(m.telefone ? { phone: m.telefone } : {}),
    ...(m.email ? { email: m.email } : {}),
  };
}

function recusaDoSchema(erro: { issues: Array<{ path: PropertyKey[]; message: string }> }): never {
  const linhas = erro.issues.slice(0, 8).map((i) => {
    const caminho = i.path.map(String);
    if (caminho[0] === "form_fields") {
      const campo = { key: "chave", label: "pergunta", type: "tipo", required: "obrigatoria", options: "opcoes" }[caminho[2] ?? ""] ?? caminho[2];
      const onde = caminho[1] !== undefined ? `perguntas[${caminho[1]}]${campo ? `.${campo}` : ""}` : "perguntas";
      return `\`${onde}\`: ${/^Invalid|^Too/i.test(i.message) ? "valor não aceito" : i.message}`;
    }
    const nome = { name: "nome", redirect_to: "endereco_de_retorno", field_map: "mapeamento" }[caminho[0] ?? ""] ?? caminho.join(".");
    return `\`${nome}\`: ${/^Invalid/i.test(i.message) ? "valor não aceito" : i.message}`;
  });
  throw new Recusa(
    `A fonte de formulário não passou na conferência:\n- ${[...new Set(linhas)].join("\n- ")}\n` +
      `A régua da tela: até ${TETO_DE_PERGUNTAS} perguntas, chave começando por letra minúscula (só letras minúsculas, números e _), ` +
      'sem chaves que o formulário já usa (nome, telefone, email, utm_...), e pergunta de lista ("select") com pelo menos uma opção.',
  );
}

export interface FonteGarantida {
  fonte: Record<string, unknown>;
  desfecho: Desfecho;
  mudancas: string[];
  avisos: string[];
}

export async function garantirFonteDeFormulario(c: Implantacao, pedido: PedidoDeFonte): Promise<FonteGarantida> {
  const avisos: string[] = [];
  const nome = pedido.nome.trim();
  const fontes = await lerFontes(c);
  let existente: LinhaDaFonte | undefined;
  if (pedido.fonte_id) {
    existente = fontes.find((f) => f.id === pedido.fonte_id);
    if (!existente) throw new Recusa(`Não existe fonte de formulário com o id ${pedido.fonte_id} nesta organização.`);
  } else {
    const comEsteNome = fontes.filter((f) => chaveDoNome(f.name) === chaveDoNome(nome));
    if (comEsteNome.length > 1) {
      throw new Recusa(
        `Há ${comEsteNome.length} fontes chamadas «${nome}» nesta organização. Informe \`fonte_id\`: ${comEsteNome.map((f) => f.id).join(", ")}.`,
      );
    }
    existente = comEsteNome[0];
  }

  const funis = await lerFunisComEtapas(c);
  const destino = pedido.destino ? resolverDestino(funis, pedido.destino) : undefined;
  const perguntas = pedido.perguntas !== undefined ? perguntasParaOBanco(pedido.perguntas) : undefined;
  const mapeamento = mapeamentoParaOBanco(pedido.mapeamento);

  // ── fonte nova: o caminho de `POST /api/v1/webhook-sources` ──────────────
  if (!existente) {
    if (!destino) {
      throw new Recusa(
        "Fonte nova precisa de `destino`: o funil e a etapa em que os contatos do formulário entram. " +
          'Ex.: { "destino": { "funil": "Vendas", "etapa": "Novo contato" } }. Os funis estão em plataforma_ver_funis.',
      );
    }
    if (pedido.autorizar_ia_na_captura === true) {
      throw new Recusa(
        "Fonte nova não nasce com a autorização de IA: ela exige a ASSINATURA da fonte, que é credencial e é posta por uma pessoa na tela (Automações › Fontes, /app/webhooks). " +
          "Crie a fonte sem `autorizar_ia_na_captura`; depois da assinatura, chame de novo com `autorizar_ia_na_captura: true`.",
      );
    }
    // .82 (upstream 1.84, 0683): o schema de criação nem tem o campo; a opção
    // só entra pelo PATCH, depois da assinatura, como na tela.
    if (pedido.atualizar_card_no_reenvio === true) {
      throw new Recusa(
        "Fonte nova não nasce com a atualização do card no reenvio: ela exige a ASSINATURA da fonte, que é credencial e é posta por uma pessoa na tela (Automações › Fontes, /app/webhooks). " +
          "Crie a fonte sem `atualizar_card_no_reenvio`; depois da assinatura, chame de novo com `atualizar_card_no_reenvio: true`.",
      );
    }
    // .86 (upstream 1.88, 0722): a irmã, pela mesma régua.
    if (pedido.reaproveitar_card_aberto === true) {
      throw new Recusa(
        "Fonte nova não nasce reaproveitando o card aberto do contato: a opção exige a ASSINATURA da fonte, que é credencial e é posta por uma pessoa na tela (Automações › Fontes, /app/webhooks). " +
          "Crie a fonte sem `reaproveitar_card_aberto`; depois da assinatura, chame de novo com `reaproveitar_card_aberto: true`.",
      );
    }
    const lido = createWebhookSourceSchema.safeParse({
      name: nome,
      default_pipeline_id: destino.pipeline_id,
      default_stage_id: destino.stage_id,
      ...(pedido.endereco_de_retorno !== undefined ? { redirect_to: pedido.endereco_de_retorno } : {}),
      ...(mapeamento !== undefined ? { field_map: mapeamento } : {}),
      ...(perguntas !== undefined ? { form_fields: perguntas } : {}),
    });
    if (!lido.success) recusaDoSchema(lido.error);
    let criada: FonteVisivel;
    try {
      criada = await criarEntradaAutomatica(
        { supabase: c.admin, organizationId: c.orgId, actor: atorDaImplantacao(c), requestId: c.requestId },
        {
          name: lido.data.name,
          default_pipeline_id: lido.data.default_pipeline_id,
          default_stage_id: lido.data.default_stage_id,
          redirect_to: lido.data.redirect_to ?? null,
          field_map: lido.data.field_map,
          form_fields: lido.data.form_fields,
          secret_encrypted: null,
        },
      );
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) throw new Recusa(err.message);
      throw err;
    }
    avisos.push(
      "A fonte nasceu LIGADA, como na tela: todo envio para o endereço de captação vira contato e negócio no destino. " +
        "Ninguém manda nada para ele até uma pessoa pôr o endereço no formulário do site.",
    );
    avisos.push(
      "Sem assinatura: qualquer um que tenha o endereço consegue mandar contato. Se o sistema de fora assina o envio, uma pessoa põe o segredo pela tela (Automações › Fontes).",
    );
    return {
      fonte: retratoDaFonte(criada, funis, { pipeline_id: criada.default_pipeline_id, stage_id: criada.default_stage_id }),
      desfecho: "criou",
      mudancas: [],
      avisos,
    };
  }

  // ── fonte que já existe: o caminho de `PATCH /api/v1/webhook-sources/[id]` ─
  const patch: Record<string, unknown> = {};
  const mudancas: string[] = [];
  if (existente.name !== nome) {
    patch.name = nome;
    mudancas.push("nome");
  }
  if (destino && (destino.pipeline_id !== existente.default_pipeline_id || destino.stage_id !== existente.default_stage_id)) {
    patch.default_pipeline_id = destino.pipeline_id;
    patch.default_stage_id = destino.stage_id;
    mudancas.push("destino");
  }
  if (pedido.endereco_de_retorno !== undefined && (existente.redirect_to ?? null) !== (pedido.endereco_de_retorno ?? null)) {
    patch.redirect_to = pedido.endereco_de_retorno;
    mudancas.push("endereço de retorno");
  }
  if (mapeamento !== undefined && !mesmoConteudo(existente.field_map ?? {}, mapeamento)) {
    patch.field_map = mapeamento;
    mudancas.push("mapeamento dos campos");
  }
  if (perguntas !== undefined && !mesmoConteudo(Array.isArray(existente.form_fields) ? existente.form_fields : [], perguntas)) {
    patch.form_fields = perguntas;
    mudancas.push("perguntas do formulário");
  }
  if (pedido.autorizar_ia_na_captura !== undefined && pedido.autorizar_ia_na_captura !== existente.authorize_ai_on_capture) {
    patch.authorize_ai_on_capture = pedido.autorizar_ia_na_captura;
    mudancas.push("autorizar IA na captação");
  }
  if (
    pedido.atualizar_card_no_reenvio !== undefined &&
    pedido.atualizar_card_no_reenvio !== (existente.update_existing_lead_on_capture === true)
  ) {
    patch.update_existing_lead_on_capture = pedido.atualizar_card_no_reenvio;
    mudancas.push("atualizar o card no reenvio");
  }
  if (
    pedido.reaproveitar_card_aberto !== undefined &&
    pedido.reaproveitar_card_aberto !== (existente.reuse_open_lead_on_capture === true)
  ) {
    patch.reuse_open_lead_on_capture = pedido.reaproveitar_card_aberto;
    mudancas.push("reaproveitar o card aberto");
  }

  if (Object.keys(patch).length === 0) {
    return {
      fonte: retratoDaFonte(existente, funis, { pipeline_id: existente.default_pipeline_id, stage_id: existente.default_stage_id }),
      desfecho: "ja_estava",
      mudancas: [],
      avisos,
    };
  }

  const conferido = updateWebhookSourceSchema.safeParse(patch);
  if (!conferido.success) recusaDoSchema(conferido.error);
  // A mesma recusa da rota: as três opções que dependem de prova de origem (a
  // assinatura), cada uma com a própria frase (upstream 1.84, #2316; 1.88, #3101).
  const opcaoQuePedeAssinatura = opcaoSemAssinatura(existente, conferido.data);
  if (opcaoQuePedeAssinatura === "ai") {
    throw new Recusa(
      `A fonte «${existente.name}» não tem ASSINATURA, e autorizar o atendimento por IA na captação exige uma: é ela que prova que o envio veio do integrador. ` +
        "A assinatura é credencial e é posta por uma pessoa na tela (Automações › Fontes, /app/webhooks). Depois, chame de novo.",
    );
  }
  if (opcaoQuePedeAssinatura === "update_lead") {
    throw new Recusa(
      `A fonte «${existente.name}» não tem ASSINATURA, e atualizar o card no reenvio exige uma: só a integração que assina o envio pode reescrever um card que já existe ` +
        "(o formulário HTML público, que qualquer um posta, não). A assinatura é credencial e é posta por uma pessoa na tela (Automações › Fontes, /app/webhooks). Depois, chame de novo.",
    );
  }
  if (opcaoQuePedeAssinatura === "reuse_lead") {
    throw new Recusa(
      `A fonte «${existente.name}» não tem ASSINATURA, e reaproveitar o card aberto do contato exige uma: reescrever um card que já existe é integração entre sistemas ` +
        "(o formulário HTML público, que qualquer um posta, não). A assinatura é credencial e é posta por uma pessoa na tela (Automações › Fontes, /app/webhooks). Depois, chame de novo.",
    );
  }

  const { data: atualizada, error } = await c.admin
    .from("webhook_sources")
    .update({ ...conferido.data, updated_at: new Date().toISOString(), ...autoriaDaMudanca(atorDaImplantacao(c)) })
    .eq("id", existente.id)
    .eq("organization_id", c.orgId)
    .select(COLUNAS)
    .single();
  if (error || !atualizada) throw new Error(`não consegui atualizar a fonte de formulário: ${error?.message ?? "sem linha"}`);
  void audit({
    action: "webhook.source_updated",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "webhook_source",
    resourceId: existente.id,
    requestId: c.requestId,
    // Como na rota: o que mudou, nunca o segredo.
    metadata: { ...conferido.data, via: "mcp_plataforma" },
  });
  const linha = atualizada as unknown as LinhaDaFonte;
  if (patch.authorize_ai_on_capture === true) {
    avisos.push(
      "A autorização de IA na captação ficou LIGADA: o contato novo que chega com o envio completo E com o consentimento explícito para atendimento automatizado fica autorizado para a IA. " +
        "O integrador precisa mandar esse aceite (separado da política de privacidade) e um `external_id` por envio. A IA só fala com ele se houver agente publicado no número.",
    );
  }
  if (patch.update_existing_lead_on_capture === true) {
    avisos.push(
      "A atualização do card no reenvio ficou LIGADA: um envio com o mesmo `external_id` de um card que ESTA fonte criou atualiza o card (os campos novos entram, o nome do card acompanha o nome enviado e o campo reservado `stage` move o card para a etapa pedida), " +
        "em vez de ser descartado como reenvio; em Leads recebidos ele aparece como \"Card atualizado\". Card criado por outra fonte, card sem origem registrada e card de contato anonimizado não são alcançados. " +
        "ATENÇÃO: o campo que alguém corrigir à mão no card pode ser sobrescrito pelo próximo envio da integração.",
    );
  }
  if (patch.update_existing_lead_on_capture === false) {
    avisos.push("A atualização do card no reenvio ficou DESLIGADA: o envio que repete o mesmo `external_id` volta a ser só reenvio, sem tocar no card.");
  }
  if (patch.reuse_open_lead_on_capture === true) {
    avisos.push(
      "O reaproveitamento do card aberto ficou LIGADO: um envio SEM `external_id` de quem já tem card ABERTO no funil desta fonte atualiza esse card (os campos novos e a etapa da fonte, sempre para a frente) em vez de abrir um segundo card; em Leads recebidos ele aparece como \"Card atualizado\". " +
        "ATENÇÃO: o campo que alguém corrigir à mão no card pode ser sobrescrito pelo próximo envio.",
    );
  }
  if (patch.reuse_open_lead_on_capture === false) {
    avisos.push("O reaproveitamento do card aberto ficou DESLIGADO: cada envio volta a virar um card novo.");
  }
  if (patch.default_pipeline_id !== undefined) {
    avisos.push("O destino novo vale para o próximo envio do formulário; os contatos que já entraram ficam onde estão.");
  }
  return {
    fonte: retratoDaFonte(linha, funis, { pipeline_id: linha.default_pipeline_id, stage_id: linha.default_stage_id }),
    desfecho: "atualizou",
    mudancas,
    avisos,
  };
}
