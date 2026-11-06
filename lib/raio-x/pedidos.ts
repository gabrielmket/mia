/**
 * FORK MIA (.106) · A NOVA ANÁLISE E O PAGAMENTO (protótipo de 06/11/2026,
 * tela 8; decisões 1 e 7). A primeira análise é grátis; as próximas são
 * AVULSA (paga uma vez, diagnóstico único) ou MENSAL (assinatura: uma análise
 * todo dia 1, com a evolução), à escolha de quem pede, na área dela.
 *
 *   sem preço ativo   o pedido vira INTERESSE: o lead da Time e o aviso dizem
 *                     que a pessoa quer, e a equipe fala com ela (o preço ainda
 *                     não foi definido: `mia_raio_x_precos` nasce vazia);
 *   com preço         a cobrança nasce no Asaas da MIA pela integração que já
 *                     existe (`lib/asaas-mia/api.ts`: a chave da tela de Cobrança,
 *                     só no cabeçalho; o erro sai só com o `code`): avulsa =
 *                     cobrança única, mensal = assinatura, as duas com a fatura do
 *                     Asaas (Pix, boleto ou cartão) e `externalReference`
 *                     `raiox-pedido:<id>`. O cliente do Asaas é o da CONTA
 *                     (`raiox-conta:<id>`); o CPF ou CNPJ vai direto ao Asaas e
 *                     não é guardado (o molde de `lib/cobranca/documento.ts`);
 *   o aviso do Asaas  o webhook que já existe (`app/api/v1/webhooks/cobranca`)
 *                     reconhece o cliente da conta e ACORDA a releitura: o corpo
 *                     do aviso nunca é a fonte, quem decide é o GET no Asaas;
 *   pago              nasce o raio-X novo da conta (o mesmo número; avulsa =
 *                     único, mensal = mensal; nunca grátis), com o aceite da
 *                     pessoa e, se o WhatsApp do anterior ainda está conectado, a
 *                     MESMA conexão (sem conectar de novo); senão, o link de
 *                     conexão vai por e-mail. O lead e a Time ficam sabendo;
 *   cancelado/estornado  o pedido é marcado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { leitorDoRaioX, type LeitorDoRaioX } from "@/lib/channels/raio-x/leitor";
import { apiDoAsaas, codigoDoErro, type DependenciasDoAsaasDaMia } from "@/lib/asaas-mia/api";
import { STATUS_ESTORNADOS, STATUS_PAGOS } from "@/lib/asaas-mia/cobrancas";
import { documentoDoPagador } from "@/lib/cobranca/documento";
import { dataCivilEmSaoPaulo } from "@/lib/cobranca/provedores/asaas";
import { logger } from "@/lib/logger";

import { criarRaioX, lerRaioX, registrarAceite, type LinhaDoRaioX } from "./banco";
import { lerConta, raioXDaConta, type LinhaDaConta } from "./contas";
import { emailDePagamento, enviarEmailDoRaioX, type EnviarEmail } from "./emails";
import { avisarATime } from "./entrega";
import { anotarNoLead, type DependenciasDoLead, type ResultadoDoLead } from "./lead-da-time";
import { PERIODOS_EM_DIAS, TETO_PADRAO_CENTAVOS, type PeriodoEmDias, type QuemAtende, type Segmento } from "./regras";

export const TIPOS_DE_PEDIDO = ["avulsa", "mensal"] as const;
export type TipoDoPedido = (typeof TIPOS_DE_PEDIDO)[number];
export type SituacaoDoPedido = "interesse" | "aguardando" | "pago" | "cancelado";

/** O preço mínimo e máximo aceitos (o Asaas não cobra menos de R$ 5). */
export const PRECO_MINIMO_CENTAVOS = 500;
export const PRECO_MAXIMO_CENTAVOS = 1_000_000;

export const ROTULO_DO_TIPO_DO_PEDIDO: Record<TipoDoPedido, string> = { avulsa: "avulsa", mensal: "mensal" };

export interface LinhaDoPedido {
  id: string;
  conta_id: string | null;
  anterior_id: string | null;
  raio_x_id: string | null;
  whatsapp: string;
  tipo: TipoDoPedido;
  valor_centavos: number | null;
  situacao: SituacaoDoPedido;
  asaas_cobranca_id: string | null;
  asaas_assinatura_id: string | null;
  link_pagamento: string | null;
  erro: string | null;
  pago_em: string | null;
  cancelado_em: string | null;
  created_at: string;
}

export const COLUNAS_DO_PEDIDO =
  "id, conta_id, anterior_id, raio_x_id, whatsapp, tipo, valor_centavos, situacao, asaas_cobranca_id, asaas_assinatura_id, link_pagamento, erro, pago_em, cancelado_em, created_at";

export interface PrecoDoRaioX {
  tipo: TipoDoPedido;
  valor_centavos: number;
  ativo: boolean;
  updated_at: string | null;
}

function falhou(contexto: string, erro: { code?: string } | null): never {
  throw new Error(`raio-x: ${contexto} (${erro?.code ?? "sem_codigo"})`);
}

/** A referência externa do pedido no Asaas (a cobrança e a assinatura). */
export function referenciaDoPedido(pedidoId: string): string {
  return `raiox-pedido:${pedidoId}`;
}
/** A referência externa do cliente da conta no Asaas. */
export function referenciaDaConta(contaId: string): string {
  return `raiox-conta:${contaId}`;
}

// ─── Os preços ──────────────────────────────────────────────────────────────

export async function lerPrecos(admin: SupabaseClient): Promise<PrecoDoRaioX[]> {
  const { data, error } = await admin.from("mia_raio_x_precos").select("tipo, valor_centavos, ativo, updated_at");
  if (error) falhou("os preços", error);
  return ((data ?? []) as PrecoDoRaioX[]).filter((p) => (TIPOS_DE_PEDIDO as readonly string[]).includes(p.tipo));
}

/** O preço que vende agora (ativo), ou `null`: sem preço, o pedido é interesse. */
export function precoAtivo(precos: readonly PrecoDoRaioX[], tipo: TipoDoPedido): number | null {
  const p = precos.find((x) => x.tipo === tipo && x.ativo);
  return p ? Number(p.valor_centavos) : null;
}

export const esquemaDoPreco = z
  .object({
    tipo: z.enum(TIPOS_DE_PEDIDO),
    /** `null` tira o preço (o tipo volta a ser só interesse). */
    valor_centavos: z.number().int().min(PRECO_MINIMO_CENTAVOS).max(PRECO_MAXIMO_CENTAVOS).nullable(),
    ativo: z.boolean().optional().default(true),
  })
  .strict();

export type ResultadoDoPreco = { ok: true; precos: PrecoDoRaioX[] } | { ok: false; campos: string[] };

/** Define (ou tira) o preço de um tipo. Quem chama audita. */
export async function definirPreco(admin: SupabaseClient, bruto: unknown, ator: string | null): Promise<ResultadoDoPreco> {
  const v = esquemaDoPreco.safeParse(bruto ?? {});
  if (!v.success) return { ok: false, campos: [...new Set(v.error.issues.map((i) => String(i.path[0] ?? "corpo")))] };
  if (v.data.valor_centavos === null) {
    const { error } = await admin.from("mia_raio_x_precos").delete().eq("tipo", v.data.tipo);
    if (error) falhou("o preço não saiu", error);
  } else {
    const { error } = await admin
      .from("mia_raio_x_precos")
      .upsert({ tipo: v.data.tipo, valor_centavos: v.data.valor_centavos, ativo: v.data.ativo, atualizado_por: ator }, { onConflict: "tipo" });
    if (error) falhou("o preço não gravou", error);
  }
  return { ok: true, precos: await lerPrecos(admin) };
}

// ─── Os pedidos ─────────────────────────────────────────────────────────────

export async function pedidosDaConta(admin: SupabaseClient, contaId: string): Promise<LinhaDoPedido[]> {
  const { data, error } = await admin.from("mia_raio_x_pedidos").select(COLUNAS_DO_PEDIDO).eq("conta_id", contaId).order("created_at", { ascending: false }).limit(50);
  if (error) falhou("os pedidos da conta", error);
  return (data ?? []) as unknown as LinhaDoPedido[];
}

/** Os pedidos ligados a um raio-X: os que nasceram dele (anterior) e o que o criou. */
export async function pedidosDoRaioX(admin: SupabaseClient, raioXId: string): Promise<LinhaDoPedido[]> {
  const [deOnde, oQueCriou] = await Promise.all([
    admin.from("mia_raio_x_pedidos").select(COLUNAS_DO_PEDIDO).eq("anterior_id", raioXId),
    admin.from("mia_raio_x_pedidos").select(COLUNAS_DO_PEDIDO).eq("raio_x_id", raioXId),
  ]);
  if (deOnde.error) falhou("os pedidos do raio-X", deOnde.error);
  if (oQueCriou.error) falhou("o pedido do raio-X", oQueCriou.error);
  const todos = new Map<string, LinhaDoPedido>();
  for (const p of [...((deOnde.data ?? []) as unknown as LinhaDoPedido[]), ...((oQueCriou.data ?? []) as unknown as LinhaDoPedido[])]) todos.set(p.id, p);
  return [...todos.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function atualizarPedido(admin: SupabaseClient, id: string, valores: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("mia_raio_x_pedidos").update(valores).eq("id", id);
  if (error) falhou("o pedido não atualizou", error);
}

export interface DependenciasDoPedido {
  asaas?: DependenciasDoAsaasDaMia;
  lead?: DependenciasDoLead;
  enviarEmail?: EnviarEmail;
  emailDaTime?: string | null;
  leitor?: LeitorDoRaioX | null;
  agora?: Date;
}

export type RecusaDoPedido = "tipo" | "aceite" | "sem_raio_x" | "em_andamento" | "documento";

export type ResultadoDoPedido =
  | { ok: true; pedido: LinhaDoPedido; situacao: "interesse" | "aguardando"; link: string | null; lead: ResultadoDoLead | null }
  | { ok: false; motivo: RecusaDoPedido };

export function fraseDaRecusaDoPedido(motivo: RecusaDoPedido): string {
  switch (motivo) {
    case "tipo":
      return "Escolha avulsa ou mensal.";
    case "aceite":
      return "Marque a autorização para continuar.";
    case "sem_raio_x":
      return "Ainda não há um Raio-X nesta conta para repetir. Faça o cadastro grátis primeiro.";
    case "em_andamento":
      return "O Raio-X deste número ainda está em andamento (ou o mensal já está ativo). Espere ele terminar para pedir outro.";
    case "documento":
      return "Confira o CPF ou o CNPJ de quem paga.";
  }
}

/** O raio-X ainda está andando (ou é um mensal vivo)? Aí não cabe pedir outro. */
function emAndamento(r: LinhaDoRaioX): boolean {
  if (r.sem_historico_em || r.situacao === "encerrado") return false;
  if (r.situacao === "pronto") return r.tipo === "mensal" && !r.desconectado_em;
  return true;
}

const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;

/** A data civil (São Paulo) de daqui a N dias, como o Asaas quer o vencimento. */
function vencimento(agora: Date, dias: number): string {
  return dataCivilEmSaoPaulo(new Date(agora.getTime() + dias * 86_400_000));
}

const comId = z.object({ id: z.string().min(1), deleted: z.boolean().nullish() });
const cobrancaDoAsaas = z.object({
  id: z.string().min(1),
  status: z.string(),
  invoiceUrl: z.string().nullish(),
  subscription: z.string().nullish(),
  externalReference: z.string().nullish(),
  deleted: z.boolean().nullish(),
});
const listaDe = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item) });
const assinaturaDoAsaas = z.object({ id: z.string().min(1), status: z.string().nullish(), deleted: z.boolean().nullish() });

/**
 * O cliente do Asaas da CONTA: o gravado, o achado pela `externalReference`
 * (a resposta perdida de um POST anterior), ou um novo com o documento.
 */
async function garantirCliente(api: ReturnType<typeof apiDoAsaas>, conta: LinhaDaConta, documento: string | null): Promise<string> {
  if (conta.asaas_cliente_id) return conta.asaas_cliente_id;
  const ref = referenciaDaConta(conta.id);
  const achado = api.ler(listaDe(comId), await api.chamar("GET", `/customers?${new URLSearchParams({ externalReference: ref, limit: "10" })}`)).data.find((c) => c.deleted !== true);
  if (achado) return achado.id;
  if (!documento) throw new Error("raio-x: sem documento para o cliente do Asaas");
  return api.ler(
    comId,
    await api.chamar("POST", "/customers", {
      name: conta.nome,
      email: conta.email,
      cpfCnpj: documento,
      externalReference: ref,
      // Quem avisa é o sistema (o e-mail do Raio-X); os avisos do Asaas sairiam em dobro.
      notificationDisabled: true,
    }),
  ).id;
}

/**
 * A pessoa pediu uma nova análise na área. Sem preço: interesse. Com preço: a
 * cobrança no Asaas (avulsa) ou a assinatura (mensal), e o link de pagamento.
 * Quem chama confere a sessão e audita.
 */
export async function pedirNovaAnalise(
  admin: SupabaseClient,
  conta: LinhaDaConta,
  bruto: unknown,
  deps: DependenciasDoPedido = {},
): Promise<ResultadoDoPedido> {
  const agora = deps.agora ?? new Date();
  const c = (bruto && typeof bruto === "object" ? bruto : {}) as { tipo?: unknown; aceite?: unknown; documento?: unknown };
  if (!(TIPOS_DE_PEDIDO as readonly unknown[]).includes(c.tipo)) return { ok: false, motivo: "tipo" };
  const tipo = c.tipo as TipoDoPedido;
  if (c.aceite !== true && c.aceite !== "sim") return { ok: false, motivo: "aceite" };
  const [anterior] = await raioXDaConta(admin, conta.id);
  if (!anterior) return { ok: false, motivo: "sem_raio_x" };
  if (emAndamento(anterior)) return { ok: false, motivo: "em_andamento" };

  // O mesmo pedido em aberto: devolve o link de antes (o clique repetido não cobra duas vezes).
  const abertos = (await pedidosDaConta(admin, conta.id)).filter((p) => p.situacao === "aguardando" && p.tipo === tipo && p.link_pagamento);
  if (abertos[0]) return { ok: true, pedido: abertos[0], situacao: "aguardando", link: abertos[0].link_pagamento, lead: null };

  const valor = precoAtivo(await lerPrecos(admin), tipo);
  const documento = typeof c.documento === "string" && c.documento.trim() ? documentoDoPagador(c.documento) : null;
  if (valor !== null && !conta.asaas_cliente_id && !documento) return { ok: false, motivo: "documento" };

  const { data, error } = await admin
    .from("mia_raio_x_pedidos")
    .insert({ conta_id: conta.id, anterior_id: anterior.id, whatsapp: anterior.whatsapp, tipo, valor_centavos: valor, situacao: valor === null ? "interesse" : "aguardando" })
    .select(COLUNAS_DO_PEDIDO)
    .single();
  if (error || !data) falhou("o pedido não gravou", error);
  let pedido = data as unknown as LinhaDoPedido;

  const virarInteresse = async (erro: string | null): Promise<ResultadoDoPedido> => {
    if (pedido.situacao !== "interesse") {
      await atualizarPedido(admin, pedido.id, { situacao: "interesse", erro });
      pedido = { ...pedido, situacao: "interesse", erro };
    }
    const lead = await anotarNoLead(
      admin,
      {
        conta,
        raioX: anterior,
        raioXId: anterior.id,
        campos: { raio_x_pedido: `nova análise ${tipo}: interesse` },
        nota: `Pediu uma nova análise ${tipo} para ${anterior.empresa}.${erro ? " O pagamento não abriu agora" : " Ainda sem preço no sistema"}: a equipe combina com a pessoa.`,
      },
      deps.lead,
    );
    await avisarATime(
      admin,
      { titulo: `${anterior.empresa} quer uma nova análise ${tipo}`, linhas: [`${conta.nome} pediu na área do Raio-X. Fale com a pessoa pelo WhatsApp do cadastro.`], raioXId: anterior.id, lead },
      { enviarEmail: deps.enviarEmail, ...(deps.emailDaTime !== undefined ? { emailDaTime: deps.emailDaTime } : {}) },
    );
    return { ok: true, pedido, situacao: "interesse", link: null, lead };
  };

  if (valor === null) return virarInteresse(null);

  const api = apiDoAsaas(deps.asaas);
  try {
    const clienteRef = await garantirCliente(api, conta, documento);
    if (clienteRef !== conta.asaas_cliente_id) await admin.from("mia_raio_x_contas").update({ asaas_cliente_id: clienteRef }).eq("id", conta.id);
    const referencia = referenciaDoPedido(pedido.id);
    const descricao = `Raio-X do atendimento · ${anterior.empresa} · ${tipo === "mensal" ? "acompanhamento mensal" : "nova análise"}`;
    let cobrancaId: string;
    let assinaturaId: string | null = null;
    let link: string | null;
    if (tipo === "avulsa") {
      const cobranca = api.ler(
        cobrancaDoAsaas,
        await api.chamar("POST", "/payments", { customer: clienteRef, billingType: "UNDEFINED", value: valor / 100, dueDate: vencimento(agora, 2), description: descricao, externalReference: referencia }),
      );
      cobrancaId = cobranca.id;
      link = api.linkSeguro(cobranca.invoiceUrl);
    } else {
      const assinatura = api.ler(
        comId,
        await api.chamar("POST", "/subscriptions", {
          customer: clienteRef,
          billingType: "UNDEFINED",
          value: valor / 100,
          cycle: "MONTHLY",
          nextDueDate: vencimento(agora, 0),
          description: descricao,
          externalReference: referencia,
        }),
      );
      assinaturaId = assinatura.id;
      const primeiras = api.ler(listaDe(cobrancaDoAsaas), await api.chamar("GET", `/payments?${new URLSearchParams({ subscription: assinatura.id, limit: "10" })}`)).data;
      const primeira = primeiras.find((x) => x.status === "PENDING" || x.status === "OVERDUE") ?? primeiras[0];
      if (!primeira) throw new Error("raio-x: a assinatura ainda não gerou a cobrança");
      cobrancaId = primeira.id;
      link = api.linkSeguro(primeira.invoiceUrl);
    }
    if (!link) throw new Error("raio-x: o Asaas não devolveu o link de pagamento");
    await atualizarPedido(admin, pedido.id, { asaas_cobranca_id: cobrancaId, asaas_assinatura_id: assinaturaId, link_pagamento: link, erro: null });
    pedido = { ...pedido, asaas_cobranca_id: cobrancaId, asaas_assinatura_id: assinaturaId, link_pagamento: link };
    const lead = await anotarNoLead(
      admin,
      {
        conta,
        raioX: anterior,
        raioXId: anterior.id,
        campos: { raio_x_pedido: `nova análise ${tipo}: aguardando o pagamento (${reais(valor)})` },
        nota: `Pediu uma nova análise ${tipo} para ${anterior.empresa} (${reais(valor)}${tipo === "mensal" ? " por mês" : ""}): aguardando o pagamento.`,
      },
      deps.lead,
    );
    return { ok: true, pedido, situacao: "aguardando", link, lead };
  } catch (erro) {
    logger.warn("[raio-x] a cobrança da nova análise não abriu", { pedidoId: pedido.id, codigo: codigoDoErro(erro) });
    return virarInteresse(codigoDoErro(erro).slice(0, 60));
  }
}

// ─── A releitura no Asaas e o pagamento ─────────────────────────────────────

type SituacaoNoAsaas = "pago" | "aberto" | "cancelado";

async function situacaoNoAsaas(api: ReturnType<typeof apiDoAsaas>, p: LinhaDoPedido): Promise<SituacaoNoAsaas> {
  if (p.tipo === "mensal" && p.asaas_assinatura_id) {
    const cobrancas = api.ler(listaDe(cobrancaDoAsaas), await api.chamar("GET", `/payments?${new URLSearchParams({ subscription: p.asaas_assinatura_id, limit: "20" })}`)).data;
    if (cobrancas.some((x) => x.deleted !== true && STATUS_PAGOS.has(x.status))) return "pago";
    const assinatura = api.ler(assinaturaDoAsaas, await api.chamar("GET", `/subscriptions/${encodeURIComponent(p.asaas_assinatura_id)}`));
    if (assinatura.deleted === true || assinatura.status === "INACTIVE" || assinatura.status === "EXPIRED") return "cancelado";
    return "aberto";
  }
  if (!p.asaas_cobranca_id) return "aberto";
  const c = api.ler(cobrancaDoAsaas, await api.chamar("GET", `/payments/${encodeURIComponent(p.asaas_cobranca_id)}`));
  // A cobrança é deste pedido? Uma referência trocada nunca cria raio-X.
  if (c.externalReference && c.externalReference !== referenciaDoPedido(p.id)) return "aberto";
  if (c.deleted !== true && STATUS_PAGOS.has(c.status)) return "pago";
  if (c.deleted === true || STATUS_ESTORNADOS.has(c.status) || c.status === "CANCELED") return "cancelado";
  return "aberto";
}

/**
 * O pagamento confirmado: o pedido vira pago (uma vez só, por update
 * condicional) e nasce o raio-X novo da conta. Devolve o id do raio-X novo, ou
 * `null` se outro caminho já confirmou.
 */
export async function confirmarPagamento(admin: SupabaseClient, p: LinhaDoPedido, deps: DependenciasDoPedido = {}): Promise<string | null> {
  const agora = deps.agora ?? new Date();
  const { data: marcou, error } = await admin
    .from("mia_raio_x_pedidos")
    .update({ situacao: "pago", pago_em: agora.toISOString() })
    .eq("id", p.id)
    .eq("situacao", "aguardando")
    .select("id");
  if (error) falhou("o pagamento não gravou", error);
  if ((marcou ?? []).length === 0) return null;
  const conta = p.conta_id ? await lerConta(admin, p.conta_id) : null;
  const anterior = p.anterior_id ? await lerRaioX(admin, p.anterior_id) : null;
  if (!conta || !anterior) {
    logger.warn("[raio-x] o pedido pago não tem a conta ou o raio-X anterior", { pedidoId: p.id });
    return null;
  }
  const periodo = (PERIODOS_EM_DIAS as readonly number[]).includes(anterior.periodo_dias) ? (anterior.periodo_dias as PeriodoEmDias) : 30;
  const criado = await criarRaioX(
    admin,
    {
      fonte: "conexao",
      empresa: anterior.empresa,
      segmento: anterior.segmento as Segmento,
      whatsapp: p.whatsapp,
      numeros: [],
      responsavel_nome: conta.nome,
      responsavel_contato: conta.email,
      quem_atende: anterior.quem_atende as QuemAtende,
      periodo_dias: periodo,
      tipo: p.tipo === "mensal" ? "mensal" : "unico",
      abre: anterior.abre.slice(0, 5),
      fecha: anterior.fecha.slice(0, 5),
      sabado_ate: anterior.sabado_ate ? anterior.sabado_ate.slice(0, 5) : null,
      organization_id: anterior.organization_id,
      teto_centavos: TETO_PADRAO_CENTAVOS,
    },
    null,
    "cadastro",
    agora,
    null,
    { origem: "cadastro", gratis: false, contaId: conta.id },
  );
  await atualizarPedido(admin, p.id, { raio_x_id: criado.raioX.id });

  // O WhatsApp do anterior ainda está conectado: a conexão passa para o novo
  // (a mesma sessão no leitor, sem conectar de novo). O anterior fica com o
  // relatório e o prazo das conversas; o prazo de derrubar a conexão sai dele.
  const conectado = Boolean(anterior.sessao && anterior.conectado_em && !anterior.desconectado_em);
  let novo: LinhaDoRaioX = criado.raioX;
  if (conectado) {
    await admin.from("mia_raio_x").update({ sessao: null, desconectar_em: null, desconectado_em: agora.toISOString() }).eq("id", anterior.id);
    novo = { ...criado.raioX, sessao: anterior.sessao };
  }
  const aceite = await registrarAceite(admin, novo, { nome: conta.nome, email: conta.email });
  let linkDeConexao: string | null = conectado ? null : criado.link;
  if (!conectado && aceite.sessao) {
    const leitor = deps.leitor !== undefined ? deps.leitor : leitorDoRaioX();
    await leitor?.preparar(aceite.sessao).catch(() => undefined);
  }
  if (conectado) linkDeConexao = null;

  await enviarEmailDoRaioX(
    conta.email,
    (marca) => emailDePagamento({ nome: conta.nome, empresa: anterior.empresa, tipo: p.tipo, linkDeConexao, email: conta.email }, marca),
    "pagamento",
    deps.enviarEmail,
  );
  const lead = await anotarNoLead(
    admin,
    {
      conta,
      raioX: anterior,
      raioXId: criado.raioX.id,
      campos: { raio_x_pedido: `nova análise ${p.tipo}: paga`, raio_x_situacao: conectado ? "pago, lendo" : "pago, aguardando conectar" },
      nota: `Pagou a nova análise ${p.tipo} de ${anterior.empresa}${p.valor_centavos ? ` (${reais(p.valor_centavos)})` : ""}. ${conectado ? "O WhatsApp seguia conectado: a leitura começa sozinha." : "Falta conectar o WhatsApp de novo (o link foi por e-mail)."}`,
    },
    deps.lead,
  );
  await avisarATime(
    admin,
    { titulo: `${anterior.empresa} pagou a nova análise ${p.tipo}`, linhas: [`${conta.nome} pagou na área do Raio-X.`], raioXId: criado.raioX.id, lead },
    { enviarEmail: deps.enviarEmail, ...(deps.emailDaTime !== undefined ? { emailDaTime: deps.emailDaTime } : {}) },
  );
  return criado.raioX.id;
}

export interface ResultadoDaReleitura {
  pagos: Array<{ pedidoId: string; raioXId: string }>;
  cancelados: string[];
  falhas: number;
}

/** Relê no Asaas os pedidos em aberto da conta (o aviso do Asaas e a área chamam). Nunca lança. */
export async function relerPedidosDaConta(admin: SupabaseClient, contaId: string, deps: DependenciasDoPedido = {}): Promise<ResultadoDaReleitura> {
  const r: ResultadoDaReleitura = { pagos: [], cancelados: [], falhas: 0 };
  let abertos: LinhaDoPedido[];
  try {
    abertos = (await pedidosDaConta(admin, contaId)).filter((p) => p.situacao === "aguardando");
  } catch {
    r.falhas += 1;
    return r;
  }
  if (abertos.length === 0) return r;
  const api = apiDoAsaas(deps.asaas);
  for (const p of abertos) {
    try {
      const s = await situacaoNoAsaas(api, p);
      if (s === "pago") {
        const raioXId = await confirmarPagamento(admin, p, deps);
        if (raioXId) r.pagos.push({ pedidoId: p.id, raioXId });
      } else if (s === "cancelado") {
        const { data } = await admin
          .from("mia_raio_x_pedidos")
          .update({ situacao: "cancelado", cancelado_em: (deps.agora ?? new Date()).toISOString() })
          .eq("id", p.id)
          .eq("situacao", "aguardando")
          .select("id");
        if ((data ?? []).length > 0) r.cancelados.push(p.id);
      }
    } catch (erro) {
      r.falhas += 1;
      logger.warn("[raio-x] a releitura do pedido no Asaas falhou", { pedidoId: p.id, codigo: codigoDoErro(erro) });
    }
  }
  return r;
}

/** O cliente do Asaas é de uma conta do raio-X? (o webhook da cobrança pergunta). */
export async function contaDoRaioXPeloClienteDoAsaas(admin: SupabaseClient, clienteRef: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(clienteRef)) return null;
  const { data, error } = await admin.from("mia_raio_x_contas").select("id").eq("asaas_cliente_id", clienteRef).maybeSingle();
  if (error || !data) return null;
  return (data as { id: string }).id;
}
