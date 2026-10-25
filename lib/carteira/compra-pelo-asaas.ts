/**
 * FORK MIA (.90) — CRÉDITOS POR PIX, pelo mesmo Asaas da cobrança.
 *
 * A carteira (0244) recebia crédito só pela Time (`recarga_manual`). No
 * autoatendimento quem paga é a empresa: escolhe um PACOTE (dado, em
 * `mia_pacotes_de_creditos`, configurado pelo MCP), o sistema cria uma cobrança
 * avulsa por Pix no Asaas da instalação para o cliente que ela já é lá, e o
 * valor só entra na carteira quando a RELEITURA no Asaas diz pago.
 *
 * As regras, cada uma com caso em `tests/unit/compra-de-creditos-pelo-asaas.test.ts`:
 *   - só compra quem já é cliente do Asaas (assinou o plano): o CPF/CNPJ foi
 *     dado lá, e nunca é pedido nem guardado aqui. A empresa isenta continua
 *     recebendo crédito pela Time (decisão anotada em docs/fork/jornada-de-assinatura.md);
 *   - com a cobrança desligada, não há compra nenhuma;
 *   - o valor tem de ser um pacote ativo (a tela não inventa número);
 *   - o corpo do aviso do Asaas nunca é fonte: o aviso só acorda a releitura;
 *   - lançar é idempotente: `fn_mia_confirmar_compra_de_creditos` trava a linha
 *     e o índice único da carteira é a segunda trava;
 *   - a chave do Asaas só vai no cabeçalho, nunca em log; erro vira o `code` do
 *     Asaas, nunca a `description` (o molde de `provedores/asaas.ts`);
 *   - POST sem chave de idempotência no Asaas: antes de criar, procura a
 *     cobrança pela `externalReference` desta compra (a resposta perdida).
 *
 * Mensagem que falha não é cobrada: isso já é do motor do Broadcast (estorno
 * por destinatário, `lib/broadcast/motor.ts`) e do e-mail (cobra o aceito).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { chaveDoProvedor } from "@/lib/cobranca/configuracao";
import { ASAAS_API_BASE, dataCivilEmSaoPaulo, erroDoAsaas, modoDaChaveAsaas } from "@/lib/cobranca/provedores/asaas";
import { baseDeTesteDaCobranca } from "@/lib/cobranca/provedores/base-de-teste";
import { ErroDoProvedor } from "@/lib/cobranca/provedores/contrato";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { logger } from "@/lib/logger";

import { FRASE_SEM_COMPRA, type MotivoSemCompra as MotivoDaFrase } from "./frases-da-compra";

export interface PacoteDeCreditos {
  id: string;
  valor_cents: number;
  ordem: number;
}

export type MotivoSemCompra = Exclude<MotivoDaFrase, "sem_pacotes">;

export interface CompraDeCreditos {
  id: string;
  valor_cents: number;
  status: "criando" | "aguardando" | "paga" | "cancelada" | "expirada";
  link: string | null;
  pix_copia_e_cola: string | null;
  modo: "teste" | "producao" | null;
  criada_em: string;
  paga_em: string | null;
}

export interface DependenciasDaCompra {
  fetch?: typeof fetch;
  agora?: () => Date;
  lerChave?: () => Promise<string | null>;
  cobrancaLigada?: () => Promise<boolean>;
}

const COLUNAS_DA_COMPRA = "id, valor_cents, status, link, pix_copia_e_cola, modo, criada_em, paga_em";
const PAGO = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"]);
const PENDENTE = new Set(["PENDING", "OVERDUE", "AWAITING_RISK_ANALYSIS"]);
const TEMPO_LIMITE_MS = 20_000;
/** Compra que ficou em `criando` mais que isto morreu antes da resposta do Asaas. */
const CRIANDO_MORTA_MS = 10 * 60_000;
/** O Pix da compra vence no dia seguinte: o QR do Asaas vale até lá. */
const DIAS_PARA_PAGAR = 1;

const cobrancaAsaas = z.object({
  id: z.string().min(1),
  status: z.string(),
  invoiceUrl: z.string().nullish(),
  paymentDate: z.string().nullish(),
  clientPaymentDate: z.string().nullish(),
});
const listaAsaas = z.object({ data: z.array(cobrancaAsaas) });
const pixAsaas = z.object({ payload: z.string().nullish() });

/** Só https (http só no dublê em loopback): uma resposta adulterada nunca vira link. */
function linkSeguro(u: string | null | undefined, loopback: boolean): string | null {
  if (!u || !URL.canParse(u)) return null;
  const p = new URL(u).protocol;
  return p === "https:" || (p === "http:" && loopback) ? u : null;
}

function cliente(deps: DependenciasDaCompra) {
  const buscar = deps.fetch ?? fetch;
  const teste = baseDeTesteDaCobranca();
  async function credencial(): Promise<{ chave: string; base: string; modo: "teste" | "producao" }> {
    const chave = await (deps.lerChave ?? (() => chaveDoProvedor("asaas")))();
    const modo = chave === null ? null : modoDaChaveAsaas(chave);
    if (chave === null || modo === null) throw new ErroDoProvedor(null, "sem_chave", false, true);
    if (teste === null) return { chave, base: ASAAS_API_BASE[modo], modo };
    if (modo === "producao") throw new ErroDoProvedor(null, "chave_real_fora_do_asaas", false, true);
    return { chave, base: `${teste}/v3`, modo };
  }
  async function chamar(metodo: "GET" | "POST" | "DELETE", caminho: string, corpo?: Record<string, unknown>): Promise<unknown> {
    const { chave, base } = await credencial();
    const headers: Record<string, string> = { access_token: chave, accept: "application/json", "user-agent": "creditos-da-carteira/mia" };
    const body = corpo === undefined ? undefined : JSON.stringify(corpo);
    if (body !== undefined) headers["content-type"] = "application/json";
    let r: Response;
    try {
      r = await buscar(`${base}${caminho}`, { method: metodo, headers, body, cache: "no-store", signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
    } catch {
      throw new ErroDoProvedor(null, "sem_resposta", true);
    }
    if (!r.ok) throw erroDoAsaas(r.status, await r.json().catch(() => null));
    return r.json().catch(() => {
      throw new ErroDoProvedor(r.status, "resposta_invalida", false);
    });
  }
  const ler = <T>(schema: z.ZodType<T>, dados: unknown): T => {
    const lido = schema.safeParse(dados);
    if (!lido.success) throw new ErroDoProvedor(200, "resposta_invalida", false);
    return lido.data;
  };
  return { credencial, chamar, ler, loopback: teste !== null };
}

/** Os pacotes à venda, do menor para o maior. LANÇA na falha. */
export async function lerPacotesAtivos(admin: SupabaseClient): Promise<PacoteDeCreditos[]> {
  const { data, error } = await admin
    .from("mia_pacotes_de_creditos")
    .select("id, valor_cents, ordem")
    .eq("ativo", true)
    .order("ordem", { ascending: true })
    .order("valor_cents", { ascending: true });
  if (error) throw new Error(`pacotes de crédito: leitura falhou (${error.code ?? "sem_codigo"})`);
  return ((data ?? []) as Array<{ id: string; valor_cents: number | string; ordem: number }>).map((p) => ({
    id: p.id,
    valor_cents: Number(p.valor_cents),
    ordem: p.ordem,
  }));
}

/**
 * Esta empresa pode comprar créditos por Pix agora? Devolve o cliente do Asaas
 * quando pode. LANÇA na falha de leitura (é uma ação).
 */
export async function podeComprarCreditos(
  admin: SupabaseClient,
  orgId: string,
  deps: DependenciasDaCompra = {},
): Promise<{ pode: true; clienteRef: string } | { pode: false; motivo: MotivoSemCompra }> {
  const ligada = await (deps.cobrancaLigada ?? (() => moduloLigado(admin, "cobranca")))();
  if (!ligada) return { pode: false, motivo: "cobranca_desligada" };
  const { data, error } = await admin
    .from("cobranca_assinaturas")
    .select("provedor, provedor_cliente_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`assinatura: leitura falhou (${error.code ?? "sem_codigo"})`);
  const a = data as { provedor: string | null; provedor_cliente_id: string | null } | null;
  if (!a) return { pode: false, motivo: "sem_assinatura" };
  if (a.provedor !== null && a.provedor !== "asaas") return { pode: false, motivo: "provedor_nao_e_asaas" };
  if (a.provedor === null || a.provedor_cliente_id === null) return { pode: false, motivo: "sem_cliente_no_asaas" };
  return { pode: true, clienteRef: a.provedor_cliente_id };
}

export { FRASE_SEM_COMPRA } from "./frases-da-compra";

function paraCompra(l: Record<string, unknown>): CompraDeCreditos {
  return {
    id: String(l.id),
    valor_cents: Number(l.valor_cents),
    status: l.status as CompraDeCreditos["status"],
    link: (l.link as string | null) ?? null,
    pix_copia_e_cola: (l.pix_copia_e_cola as string | null) ?? null,
    modo: (l.modo as CompraDeCreditos["modo"]) ?? null,
    criada_em: String(l.criada_em),
    paga_em: (l.paga_em as string | null) ?? null,
  };
}

/** As compras recentes da empresa (as 20 mais novas). LANÇA na falha. */
export async function lerComprasDaEmpresa(admin: SupabaseClient, orgId: string): Promise<CompraDeCreditos[]> {
  const { data, error } = await admin
    .from("mia_compras_de_creditos")
    .select(COLUNAS_DA_COMPRA)
    .eq("organization_id", orgId)
    .order("criada_em", { ascending: false })
    .limit(20);
  if (error) throw new Error(`compras de crédito: leitura falhou (${error.code ?? "sem_codigo"})`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(paraCompra);
}

export type ResultadoDaCompra =
  | { ok: true; compra: CompraDeCreditos; reaproveitada: boolean }
  | { ok: false; status: number; code: string; message: string };

const recusa = (status: number, code: string, message: string): ResultadoDaCompra => ({ ok: false, status, code, message });

/**
 * Cria a cobrança por Pix de um pacote. Uma compra em aberto do MESMO valor é
 * devolvida de novo (clique duplo, "gerar o Pix" de novo), sem outra cobrança.
 */
export async function iniciarCompraDeCreditos(
  admin: SupabaseClient,
  p: { orgId: string; valorCents: number; userId: string | null; requestId?: string },
  deps: DependenciasDaCompra = {},
): Promise<ResultadoDaCompra> {
  const agora = (deps.agora ?? (() => new Date()))();
  const pacotes = await lerPacotesAtivos(admin);
  if (!pacotes.some((x) => x.valor_cents === p.valorCents)) {
    return recusa(422, "pacote_invalido", "Escolha um dos pacotes de crédito disponíveis.");
  }
  const pode = await podeComprarCreditos(admin, p.orgId, deps);
  if (!pode.pode) return recusa(409, pode.motivo, FRASE_SEM_COMPRA[pode.motivo]);

  const { data: aberta, error: erroDaAberta } = await admin
    .from("mia_compras_de_creditos")
    .select(COLUNAS_DA_COMPRA)
    .eq("organization_id", p.orgId)
    .eq("valor_cents", p.valorCents)
    .eq("status", "aguardando")
    .gte("criada_em", new Date(agora.getTime() - DIAS_PARA_PAGAR * 86_400_000).toISOString())
    .order("criada_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (erroDaAberta) return recusa(500, "internal_error", "Não foi possível ler as compras.");
  if (aberta) return { ok: true, compra: paraCompra(aberta as Record<string, unknown>), reaproveitada: true };

  const { data: reserva, error: erroDaReserva } = await admin
    .from("mia_compras_de_creditos")
    .insert({ organization_id: p.orgId, valor_cents: p.valorCents, status: "criando", criada_por: p.userId })
    .select("id")
    .single();
  if (erroDaReserva || !reserva) return recusa(500, "internal_error", "Não foi possível registrar a compra.");
  const compraId = String((reserva as { id: string }).id);
  const externalReference = `creditos:${p.orgId}:${compraId}`;

  const api = cliente(deps);
  try {
    const { modo } = await api.credencial();
    const consulta = new URLSearchParams({ customer: pode.clienteRef, externalReference, limit: "5" });
    const existentes = api.ler(listaAsaas, await api.chamar("GET", `/payments?${consulta}`)).data;
    const venceEm = new Date(agora.getTime() + DIAS_PARA_PAGAR * 86_400_000);
    const pagamento =
      existentes.find((c) => PENDENTE.has(c.status)) ??
      api.ler(
        cobrancaAsaas,
        await api.chamar("POST", "/payments", {
          customer: pode.clienteRef,
          billingType: "PIX",
          value: p.valorCents / 100,
          dueDate: dataCivilEmSaoPaulo(venceEm),
          description: `Créditos de envio · R$ ${(p.valorCents / 100).toFixed(2).replace(".", ",")}`,
          externalReference,
        }),
      );
    let pix: string | null = null;
    try {
      pix = api.ler(pixAsaas, await api.chamar("GET", `/payments/${encodeURIComponent(pagamento.id)}/pixQrCode`)).payload ?? null;
    } catch {
      // Sem o copia e cola, o link da fatura também tem o Pix.
    }
    const link = linkSeguro(pagamento.invoiceUrl, api.loopback);
    const { data: gravada, error: erroDaGravacao } = await admin
      .from("mia_compras_de_creditos")
      .update({ status: "aguardando", pagamento_ref: pagamento.id, link, pix_copia_e_cola: pix, modo })
      .eq("id", compraId)
      .eq("status", "criando")
      .select(COLUNAS_DA_COMPRA)
      .maybeSingle();
    if (erroDaGravacao || !gravada) {
      return recusa(500, "pagamento_nao_registrado", "O Pix foi gerado, mas não conseguimos registrar a compra. Tente de novo em alguns minutos.");
    }
    void audit({
      action: "carteira.compra_iniciada",
      actorUserId: p.userId,
      organizationId: p.orgId,
      resourceType: "mia_compras_de_creditos",
      resourceId: compraId,
      requestId: p.requestId ?? null,
      metadata: { valor_cents: p.valorCents, modo },
    });
    return { ok: true, compra: paraCompra(gravada as Record<string, unknown>), reaproveitada: false };
  } catch (e) {
    await admin
      .from("mia_compras_de_creditos")
      .update({ status: "cancelada", encerrada_em: agora.toISOString() })
      .eq("id", compraId)
      .eq("status", "criando");
    if (e instanceof ErroDoProvedor) {
      logger.warn("carteira.compra_pelo_asaas_falhou", { organization_id: p.orgId, status: e.status, codigo: e.codigo });
      if (e.codigo === "sem_chave") return recusa(409, "sem_chave", FRASE_SEM_COMPRA.sem_chave);
      return recusa(e.transitorio ? 503 : 502, "provedor_recusou", "O Asaas não gerou o Pix agora. Tente de novo em alguns minutos.");
    }
    throw e;
  }
}

/**
 * Relê UMA compra no Asaas e, se pago, lança na carteira. Devolve a situação
 * depois da releitura. Leitura do provedor que falha não muda nada.
 */
export async function conferirCompra(
  admin: SupabaseClient,
  compraId: string,
  deps: DependenciasDaCompra = {},
): Promise<{ status: CompraDeCreditos["status"]; lancou: boolean }> {
  const agora = (deps.agora ?? (() => new Date()))();
  const { data, error } = await admin
    .from("mia_compras_de_creditos")
    .select("id, organization_id, status, pagamento_ref, criada_em, valor_cents")
    .eq("id", compraId)
    .maybeSingle();
  if (error || !data) throw new Error("compra de crédito ilegível");
  const c = data as { id: string; organization_id: string; status: CompraDeCreditos["status"]; pagamento_ref: string | null; criada_em: string; valor_cents: number };
  if (c.status === "paga") return { status: "paga", lancou: false };
  if (c.pagamento_ref === null) {
    if (c.status === "criando" && agora.getTime() - Date.parse(c.criada_em) > CRIANDO_MORTA_MS) {
      await admin.from("mia_compras_de_creditos").update({ status: "cancelada", encerrada_em: agora.toISOString() }).eq("id", c.id).eq("status", "criando");
      return { status: "cancelada", lancou: false };
    }
    return { status: c.status, lancou: false };
  }
  const api = cliente(deps);
  let pagamento: z.infer<typeof cobrancaAsaas>;
  try {
    pagamento = api.ler(cobrancaAsaas, await api.chamar("GET", `/payments/${encodeURIComponent(c.pagamento_ref)}`));
  } catch (e) {
    logger.warn("carteira.releitura_da_compra_falhou", {
      organization_id: c.organization_id,
      codigo: e instanceof ErroDoProvedor ? e.codigo : "fora_do_adaptador",
    });
    return { status: c.status, lancou: false };
  }
  if (PAGO.has(pagamento.status)) {
    const pagoEm = pagamento.clientPaymentDate ?? pagamento.paymentDate ?? null;
    const { data: r, error: erroDoLancamento } = await admin.rpc("fn_mia_confirmar_compra_de_creditos", {
      p_compra: c.id,
      p_pago_em: pagoEm && /^\d{4}-\d{2}-\d{2}$/.test(pagoEm) ? `${pagoEm}T12:00:00-03:00` : agora.toISOString(),
    });
    if (erroDoLancamento) throw new Error(`a compra paga não foi lançada (${erroDoLancamento.code ?? "sem_codigo"})`);
    const lancou = (r as { lancou?: boolean; mudou?: boolean } | null)?.mudou === true;
    if (lancou) {
      void audit({
        action: "carteira.compra_confirmada",
        actorUserId: null,
        bypassedRls: true,
        organizationId: c.organization_id,
        resourceType: "mia_compras_de_creditos",
        resourceId: c.id,
        metadata: { valor_cents: Number(c.valor_cents) },
      });
    }
    return { status: "paga", lancou };
  }
  if (!PENDENTE.has(pagamento.status)) {
    await admin
      .from("mia_compras_de_creditos")
      .update({ status: "cancelada", encerrada_em: agora.toISOString(), relida_em: agora.toISOString() })
      .eq("id", c.id)
      .in("status", ["aguardando", "criando"]);
    return { status: "cancelada", lancou: false };
  }
  await admin.from("mia_compras_de_creditos").update({ relida_em: agora.toISOString() }).eq("id", c.id);
  return { status: c.status, lancou: false };
}

/**
 * O gancho do aviso do Asaas e da rodada: relê as compras em aberto (de uma
 * empresa, ou as mais antigas da instalação, até `limite`). Nunca lança.
 */
export async function relerComprasEmAberto(
  admin: SupabaseClient,
  filtro: { orgId?: string; limite?: number } = {},
  deps: DependenciasDaCompra = {},
): Promise<number> {
  try {
    let q = admin
      .from("mia_compras_de_creditos")
      .select("id")
      .in("status", ["aguardando", "criando"])
      .order("criada_em", { ascending: true })
      .limit(filtro.limite ?? 50);
    if (filtro.orgId) q = q.eq("organization_id", filtro.orgId);
    const { data, error } = await q;
    if (error) return 0;
    let lancadas = 0;
    for (const { id } of (data ?? []) as Array<{ id: string }>) {
      try {
        if ((await conferirCompra(admin, id, deps)).lancou) lancadas += 1;
      } catch (e) {
        logger.warn("carteira.compra_nao_conferida", { compra: id, detalhe: e instanceof Error ? e.message : String(e) });
      }
    }
    return lancadas;
  } catch {
    return 0;
  }
}
