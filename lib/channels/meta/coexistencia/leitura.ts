/**
 * FORK MIA · coexistência (S3): o ESTADO que a tela, o /admin/meta e o MCP leem.
 *
 * Uma leitura só para os três: a tela do canal oficial (`app/api/v1/channels/
 * official/coexistencia`), a tabela por empresa de /admin/meta
 * (`app/api/v1/admin/coexistencia`) e as ferramentas do MCP de plataforma
 * (`plataforma_ver_coexistencia`, `plataforma_ver_sincronizacao_do_app`). Se
 * cada um montasse a sua, a tela diria "concluída" e o MCP "em andamento".
 *
 * Só contagens e estados: nenhum nome, telefone de contato ou trecho de
 * conversa sai daqui. O número que aparece é o da EMPRESA.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerChaveDaCoexistencia, type ChaveDaCoexistencia } from "./chave";
import { emFatias } from "./fatias";
import { PRAZO_DA_SINCRONIZACAO_MS } from "./sincronizacao";

type Admin = SupabaseClient;

export interface PedidoDaSincronizacao {
  id: string;
  tipo: "contatos" | "historico";
  estado: string;
  pedidaEm: string | null;
  respondidaEm: string | null;
  concluidaEm: string | null;
  requestId: string | null;
  erroCodigo: string | null;
  erroTitulo: string | null;
  progresso: number | null;
  fase: number | null;
  contatosRecebidos: number;
  conversasRecebidas: number;
  mensagensRecebidas: number;
  mensagensExistentes: number;
  midiasGuardadas: number;
  lotesComFalha: number;
}

export interface NumeroPeloApp {
  conexaoId: string;
  channelSessionId: string;
  wabaId: string;
  phoneNumberId: string;
  /** O número da empresa, como a sessão do canal guarda (`+55…`). */
  phoneNumber: string | null;
  estado: "no_ar" | "fora_do_ar" | "encerrada";
  abertaPor: string;
  conectadaEm: string;
  prazoDaSincronizacao: string;
  foraDoArMotivo: string | null;
  foraDoArEm: string | null;
  voltouEm: string | null;
  pedidos: PedidoDaSincronizacao[];
}

export interface EstadoDaCoexistencia {
  chave: ChaveDaCoexistencia;
  /** O ciclo mais recente de cada número (vivo primeiro). */
  numeros: NumeroPeloApp[];
}

function erroDe(onde: string, error: { message?: string; code?: string } | null): Error {
  return new Error(`${onde}: ${error?.code ?? "sem_codigo"} ${error?.message ?? ""}`.trim());
}

const COLUNAS_DO_PEDIDO =
  "id, conexao_id, tipo, estado, pedida_em, respondida_em, concluida_em, request_id, erro_codigo, erro_titulo, progresso, fase, contatos_recebidos, conversas_recebidas, mensagens_recebidas, mensagens_existentes, midias_guardadas, lotes_com_falha";

type LinhaDoPedido = Record<string, unknown> & { conexao_id: string };

function pedidoDaLinha(l: LinhaDoPedido): PedidoDaSincronizacao {
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: String(l.id),
    tipo: l.tipo === "contatos" ? "contatos" : "historico",
    estado: String(l.estado),
    pedidaEm: s(l.pedida_em),
    respondidaEm: s(l.respondida_em),
    concluidaEm: s(l.concluida_em),
    requestId: s(l.request_id),
    erroCodigo: s(l.erro_codigo),
    erroTitulo: s(l.erro_titulo),
    progresso: typeof l.progresso === "number" ? l.progresso : null,
    fase: typeof l.fase === "number" ? l.fase : null,
    contatosRecebidos: n(l.contatos_recebidos),
    conversasRecebidas: n(l.conversas_recebidas),
    mensagensRecebidas: n(l.mensagens_recebidas),
    mensagensExistentes: n(l.mensagens_existentes),
    midiasGuardadas: n(l.midias_guardadas),
    lotesComFalha: n(l.lotes_com_falha),
  };
}

/** Os números pelo app de várias empresas (ciclo mais recente de cada número). Lança se o banco falhar. */
export async function numerosPeloApp(
  admin: Admin,
  organizationIds: readonly string[],
): Promise<Map<string, NumeroPeloApp[]>> {
  const porEmpresa = new Map<string, NumeroPeloApp[]>();
  if (organizationIds.length === 0) return porEmpresa;

  // Toda consulta com `.in` vai em fatias: mil ids num `.in` só estouram a URL
  // do PostgREST (`fatias.ts`).
  const respostasDosCiclos = await Promise.all(
    emFatias(organizationIds).map((fatia) =>
      admin
        .from("mia_coexistencia_conexoes")
        .select(
          "id, organization_id, channel_session_id, waba_id, phone_number_id, estado, aberta_por, conectada_em, fora_do_ar_motivo, fora_do_ar_em, voltou_em",
        )
        .in("organization_id", fatia)
        .order("conectada_em", { ascending: false })
        .limit(500),
    ),
  );
  const linhas: Array<Record<string, string | null> & { id: string; organization_id: string }> = [];
  for (const { data: ciclos, error } of respostasDosCiclos) {
    if (error) throw erroDe("ciclos_da_coexistencia", error);
    linhas.push(...((ciclos ?? []) as typeof linhas));
  }
  // Cada fatia vem em ordem; juntas, a ordem (mais recente primeiro) é refeita.
  linhas.sort((a, b) => String(b.conectada_em).localeCompare(String(a.conectada_em)));

  // O ciclo mais recente de cada número; o vivo vence o encerrado.
  const escolhidos = new Map<string, (typeof linhas)[number]>();
  for (const c of linhas) {
    const chave = `${c.organization_id}:${c.phone_number_id}`;
    const atual = escolhidos.get(chave);
    if (!atual || (atual.estado === "encerrada" && c.estado !== "encerrada")) escolhidos.set(chave, c);
  }
  const escolhidosLista = [...escolhidos.values()];
  if (escolhidosLista.length === 0) return porEmpresa;

  const empresaDaSessao = new Map(escolhidosLista.map((c) => [String(c.channel_session_id), c.organization_id]));
  const [respostasDosPedidos, respostasDasSessoes] = await Promise.all([
    Promise.all(
      emFatias(escolhidosLista.map((c) => c.id)).map((fatia) =>
        admin.from("mia_coexistencia_sincronizacoes").select(COLUNAS_DO_PEDIDO).in("conexao_id", fatia),
      ),
    ),
    Promise.all(
      emFatias(empresaDaSessao.keys()).map((fatia) =>
        admin
          .from("channel_sessions")
          .select("id, organization_id, phone_number")
          .in("organization_id", [...new Set(fatia.map((id) => empresaDaSessao.get(id) as string))])
          .in("id", fatia),
      ),
    ),
  ]);
  const pedidos: LinhaDoPedido[] = [];
  for (const { data, error: erroDosPedidos } of respostasDosPedidos) {
    if (erroDosPedidos) throw erroDe("pedidos_da_coexistencia", erroDosPedidos);
    pedidos.push(...((data ?? []) as LinhaDoPedido[]));
  }
  const sessoes: Array<{ id: string; phone_number: string | null }> = [];
  for (const { data, error: erroDasSessoes } of respostasDasSessoes) {
    if (erroDasSessoes) throw erroDe("sessoes_da_coexistencia", erroDasSessoes);
    sessoes.push(...((data ?? []) as typeof sessoes));
  }

  const pedidosPorCiclo = new Map<string, PedidoDaSincronizacao[]>();
  for (const p of pedidos) {
    const lista = pedidosPorCiclo.get(p.conexao_id) ?? [];
    lista.push(pedidoDaLinha(p));
    pedidosPorCiclo.set(p.conexao_id, lista);
  }
  const numeroDaSessao = new Map(sessoes.map((s) => [s.id, s.phone_number]));

  for (const c of escolhidosLista) {
    const conectadaEm = String(c.conectada_em);
    const lista = porEmpresa.get(c.organization_id) ?? [];
    lista.push({
      conexaoId: c.id,
      channelSessionId: String(c.channel_session_id),
      wabaId: String(c.waba_id),
      phoneNumberId: String(c.phone_number_id),
      phoneNumber: numeroDaSessao.get(String(c.channel_session_id)) ?? null,
      estado: (c.estado as NumeroPeloApp["estado"]) ?? "no_ar",
      abertaPor: String(c.aberta_por),
      conectadaEm,
      prazoDaSincronizacao: new Date(new Date(conectadaEm).getTime() + PRAZO_DA_SINCRONIZACAO_MS).toISOString(),
      foraDoArMotivo: c.fora_do_ar_motivo ?? null,
      foraDoArEm: c.fora_do_ar_em ?? null,
      voltouEm: c.voltou_em ?? null,
      // Na ordem dos pedidos: contatos, depois histórico.
      pedidos: (pedidosPorCiclo.get(c.id) ?? []).sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "contatos" ? -1 : 1)),
    });
    porEmpresa.set(c.organization_id, lista);
  }
  return porEmpresa;
}

/** O estado da coexistência de UMA empresa. Lança se o banco falhar. */
export async function estadoDaCoexistencia(admin: Admin, organizationId: string): Promise<EstadoDaCoexistencia> {
  const [chave, numeros] = await Promise.all([
    lerChaveDaCoexistencia(admin, organizationId),
    numerosPeloApp(admin, [organizationId]),
  ]);
  return { chave, numeros: numeros.get(organizationId) ?? [] };
}
