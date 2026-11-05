/**
 * FORK MIA (.102) · A LEITURA DO RAIO-X DO CLIENTE ATIVO: as conversas que a
 * conta JÁ TEM na MIA, sem conectar nada e sem o leitor (protótipo de
 * 05/11/2026; docs/fork/raio-x-do-atendimento.md, seção 13).
 *
 * ─── O que é lido ───────────────────────────────────────────────────────────
 *
 * `conversations` e `messages` da PRÓPRIA organização do raio-X, só nos números
 * escolhidos (`mia_raio_x_numeros.channel_session_id`, inclusive os da API
 * oficial) e só no período fixado na criação (os N dias inteiros antes do dia
 * da criação, nunca antes da primeira conversa da conta). Toda consulta filtra
 * `organization_id`: o cliente de serviço não tem RLS, e o raio-X de uma conta
 * não pode alcançar a de outra.
 *
 * ─── O que fica de fora (`elegiveis`) ───────────────────────────────────────
 *
 *   - grupo: `conversations.is_group` e o contato `kind = 'whatsapp_group'`;
 *   - conversa interna ou da equipe: o contato marcado como pessoal
 *     (`contacts.is_personal`, a vida pessoal de alguém da equipe, escondida
 *     da operação) e o número interno dos avisos (`config_aviso_de_caso` e
 *     `config_aviso_de_agendamento`, o número da equipe que recebe os avisos);
 *   - contato com pedido de exclusão (LGPD): já anonimizado
 *     (`contacts.is_anonymized`) ou com pedido de anonimização em
 *     `lgpd_requests` (`request_type = 'redact'`, qualquer situação);
 *   - mensagem apagada (`messages.revoked_at`, o "apagar para todos"), a
 *     reação e a linha de sistema (na leitura das mensagens,
 *     `mensagens-da-conta.ts`).
 *
 * ─── O que é guardado ───────────────────────────────────────────────────────
 *
 * NADA de texto: só a conversa do raio-X (`mia_raio_x_conversas`): a marca
 * (HMAC do id da conversa), o número de ordem e a referência CIFRADA (o id da
 * conversa, para a análise reler as mensagens na conta). O texto é lido da
 * conta na hora da análise e do relatório; o relatório guarda só os números e
 * os trechos anonimizados. Nenhuma mensagem é enviada: este módulo só faz
 * `select` nas tabelas da conta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { MARGEM_PARA_CHAMADA_MS } from "@/lib/channels/historico/prazo";
import { phoneLookupVariants } from "@/lib/channels/phone-variants";

import type { LinhaDoRaioX } from "./banco";
import { cifrarReferencia } from "./cifra";
import { marcaDaConversa } from "./tokens";

export interface EstadoDaLeituraDaConta {
  fase: "lendo_a_conta" | "concluida";
  /** O id da última conversa da conta já vista (a página é por id). */
  cursor: string | null;
  conversas_lidas: number;
  mensagens_lidas: number;
  /** Conversas que ficaram de fora pelo filtro (grupo, interna, pedido de exclusão). */
  fora: number;
  erro?: string | null;
}

export function estadoInicialDaConta(): EstadoDaLeituraDaConta {
  return { fase: "lendo_a_conta", cursor: null, conversas_lidas: 0, mensagens_lidas: 0, fora: 0 };
}

/** Lê o estado gravado; o do mensal (`estadoInicial` da .101, sem cursor) recomeça do zero. */
export function lerEstadoDaConta(bruto: unknown): EstadoDaLeituraDaConta {
  const e = (bruto && typeof bruto === "object" ? bruto : {}) as Partial<EstadoDaLeituraDaConta>;
  if (e.fase !== "lendo_a_conta" && e.fase !== "concluida") return estadoInicialDaConta();
  return {
    fase: e.fase,
    cursor: typeof e.cursor === "string" ? e.cursor : null,
    conversas_lidas: Number(e.conversas_lidas) || 0,
    mensagens_lidas: Number(e.mensagens_lidas) || 0,
    fora: Number(e.fora) || 0,
    erro: e.erro ?? null,
  };
}

// 100 ids por `in` mantêm a URL do PostgREST abaixo de 4 KB.
const PAGINA_DE_CONVERSAS = 100;
const PAGINAS_POR_RODADA = 20;

interface ContatoLido {
  id: string;
  kind: string | null;
  is_personal: boolean | null;
  is_anonymized: boolean | null;
  phone_number: string | null;
  source_metadata: unknown;
  display_name: string | null;
  name: string | null;
}

/** O contato veio de clique num anúncio (a atribuição que a conta estampou nele)? */
function veioDeAnuncio(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const m = meta as Record<string, unknown>;
  return (typeof m.ad_source_id === "string" && m.ad_source_id.trim() !== "") || m.ad_platform === "meta_ads";
}

/** Os números internos da equipe na conta (avisos de caso e de agendamento), em todas as grafias. */
async function numerosInternos(admin: SupabaseClient, orgId: string): Promise<Set<string>> {
  const [caso, agenda] = await Promise.all([
    admin.from("config_aviso_de_caso").select("telefone_destino").eq("organization_id", orgId).maybeSingle(),
    admin.from("config_aviso_de_agendamento").select("usa_numero_do_aviso_de_caso, telefone_destino").eq("organization_id", orgId).maybeSingle(),
  ]);
  const internos = new Set<string>();
  const somar = (tel: unknown) => {
    if (typeof tel !== "string" || !tel.trim()) return;
    for (const v of phoneLookupVariants(tel)) internos.add(v.replace(/\D/g, ""));
  };
  somar((caso.data as { telefone_destino?: unknown } | null)?.telefone_destino);
  const a = agenda.data as { usa_numero_do_aviso_de_caso?: boolean | null; telefone_destino?: unknown } | null;
  if (a && a.usa_numero_do_aviso_de_caso === false) somar(a.telefone_destino);
  return internos;
}

/**
 * Dos contatos pedidos, os que o raio-X PODE ler (a lista do cabeçalho), com
 * a marca de anúncio. Quem não volta está fora. Usado na leitura e de novo na
 * análise e no relatório: o pedido de exclusão que chega no meio tira a
 * conversa do relatório que ainda não saiu.
 */
export async function elegiveis(
  admin: SupabaseClient,
  orgId: string,
  contactIds: readonly string[],
): Promise<Map<string, { anuncio: boolean; nome: string | null }>> {
  const saida = new Map<string, { anuncio: boolean; nome: string | null }>();
  const ids = [...new Set(contactIds)];
  if (ids.length === 0) return saida;
  const [contatos, pedidos, internos] = await Promise.all([
    admin
      .from("contacts")
      .select("id, kind, is_personal, is_anonymized, phone_number, source_metadata, display_name, name")
      .eq("organization_id", orgId)
      .in("id", ids),
    admin.from("lgpd_requests").select("contact_id").eq("organization_id", orgId).eq("request_type", "redact").in("contact_id", ids),
    numerosInternos(admin, orgId),
  ]);
  if (contatos.error) throw new Error(`raio-x: contatos da conta (${contatos.error.code ?? "sem_codigo"})`);
  if (pedidos.error) throw new Error(`raio-x: pedidos da LGPD (${pedidos.error.code ?? "sem_codigo"})`);
  const comPedido = new Set(((pedidos.data ?? []) as Array<{ contact_id: string | null }>).flatMap((p) => (p.contact_id ? [p.contact_id] : [])));
  for (const c of (contatos.data ?? []) as ContatoLido[]) {
    if (c.kind === "whatsapp_group") continue;
    if (c.is_personal === true || c.is_anonymized === true) continue;
    if (comPedido.has(c.id)) continue;
    const digitos = (c.phone_number ?? "").replace(/\D/g, "");
    if (digitos && internos.has(digitos)) continue;
    // O nome só serve para tirá-lo dos trechos do relatório; nunca é gravado.
    saida.set(c.id, { anuncio: veioDeAnuncio(c.source_metadata), nome: c.display_name?.trim() || c.name?.trim() || null });
  }
  return saida;
}

/** Os `channel_session_id` dos números escolhidos (o canal apagado depois não conta). */
export async function canaisDoRaioX(admin: SupabaseClient, raioXId: string): Promise<string[]> {
  const { data, error } = await admin.from("mia_raio_x_numeros").select("channel_session_id").eq("raio_x_id", raioXId);
  if (error) throw new Error(`raio-x: números do raio-X (${error.code ?? "sem_codigo"})`);
  return ((data ?? []) as Array<{ channel_session_id: string | null }>).flatMap((n) => (n.channel_session_id ? [n.channel_session_id] : []));
}

interface Contexto {
  admin: SupabaseClient;
  raioX: Pick<LinhaDoRaioX, "id" | "organization_id" | "periodo_inicio" | "periodo_fim">;
  prazo: number;
  agora: () => number;
}

export interface ResultadoDaRodadaDaConta {
  estado: EstadoDaLeituraDaConta;
  concluiu: boolean;
}

/**
 * UMA rodada: páginas de conversas da conta (por id), o filtro, e a conversa
 * do raio-X criada (ou achada) com o número de ordem. Não lança por falha no
 * meio: devolve o cursor firme até onde foi, com o `erro`.
 */
export async function rodadaDeLeituraDaConta(ctx: Contexto, estadoBruto: EstadoDaLeituraDaConta): Promise<ResultadoDaRodadaDaConta> {
  const e: EstadoDaLeituraDaConta = { ...estadoBruto, erro: null };
  const orgId = ctx.raioX.organization_id;
  if (!orgId || !ctx.raioX.periodo_inicio || !ctx.raioX.periodo_fim) return { estado: { ...e, erro: "sem_conta_ou_periodo" }, concluiu: false };
  const inicio = ctx.raioX.periodo_inicio;
  const fim = ctx.raioX.periodo_fim;
  try {
    const canais = await canaisDoRaioX(ctx.admin, ctx.raioX.id);
    if (canais.length === 0) {
      e.fase = "concluida";
      return { estado: e, concluiu: true };
    }
    for (let pagina = 0; pagina < PAGINAS_POR_RODADA; pagina += 1) {
      if (ctx.prazo - ctx.agora() < MARGEM_PARA_CHAMADA_MS) return { estado: e, concluiu: false };
      let q = ctx.admin
        .from("conversations")
        .select("id, contact_id, is_group, last_message_at, created_at")
        .eq("organization_id", orgId)
        .in("channel_session_id", canais)
        .gte("last_message_at", inicio)
        .lt("created_at", fim)
        .order("id", { ascending: true })
        .limit(PAGINA_DE_CONVERSAS);
      if (e.cursor) q = q.gt("id", e.cursor);
      const { data, error } = await q;
      if (error) throw new Error(`raio-x: conversas da conta (${error.code ?? "sem_codigo"})`);
      const conversas = (data ?? []) as Array<{ id: string; contact_id: string; is_group: boolean | null; last_message_at: string | null }>;
      if (conversas.length === 0) {
        e.fase = "concluida";
        return { estado: e, concluiu: true };
      }
      const individuais = conversas.filter((c) => c.is_group !== true);
      const podem = await elegiveis(ctx.admin, orgId, individuais.map((c) => c.contact_id));
      const lidas = individuais.filter((c) => podem.has(c.contact_id));
      e.fora += conversas.length - lidas.length;
      if (lidas.length > 0) {
        const { count, error: erroDaConta } = await ctx.admin
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .in("conversation_id", lidas.map((c) => c.id))
          .gte("sent_at", inicio)
          .lt("sent_at", fim);
        if (erroDaConta) throw new Error(`raio-x: mensagens da conta (${erroDaConta.code ?? "sem_codigo"})`);
        e.mensagens_lidas += count ?? 0;
      }
      for (const c of lidas) {
        const { data: linha, error: erroDaConversa } = await ctx.admin.rpc("fn_mia_raio_x_conversa", {
          p_raio_x: ctx.raioX.id,
          p_marca: marcaDaConversa(ctx.raioX.id, c.id),
          p_referencia: cifrarReferencia({ chatId: c.id, nome: null }),
          p_ultima_em: c.last_message_at ?? inicio,
        });
        if (erroDaConversa) throw new Error(`raio-x: conversa não gravou (${erroDaConversa.code ?? "sem_codigo"})`);
        const criada = (Array.isArray(linha) ? linha[0] : linha) as { id?: string } | null;
        if (criada?.id && podem.get(c.contact_id)?.anuncio) {
          await ctx.admin.from("mia_raio_x_conversas").update({ anuncio: true }).eq("id", criada.id);
        }
        e.conversas_lidas += 1;
      }
      e.cursor = conversas[conversas.length - 1]!.id;
      if (conversas.length < PAGINA_DE_CONVERSAS) {
        e.fase = "concluida";
        return { estado: e, concluiu: true };
      }
    }
    return { estado: e, concluiu: false };
  } catch (erro) {
    return { estado: { ...e, erro: erro instanceof Error ? erro.message.slice(0, 120) : "falha_na_leitura" }, concluiu: false };
  }
}
