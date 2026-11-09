/**
 * FORK MIA (.107) · A ÁREA DO RAIO-X (protótipo de 06/11/2026, telas 6 a 8): o
 * que a pessoa vê depois de entrar com o código no e-mail. Servidor.
 *
 * A identidade é o cookie ASSINADO (`acesso.ts`): a conta vem dele, nunca da
 * URL nem do corpo. Cada raio-X pedido por id é conferido contra a conta (outro
 * id responde como inexistente). Nada de custo, de anotação da Time, do bloco
 * "o que a MIA resolveria" nem de dado de cliente do dono: o relatório é o
 * mesmo do link do dono (`dadosParaODono`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerSessao, NOME_DO_COOKIE, veioDoProprioApp } from "./acesso";
import { linkDeConexaoAtual, lerRelatorios, podeConectar, type LinhaDoRaioX, type LinhaDoRelatorio } from "./banco";
import { lerConta, raioXDaConta, type LinhaDaConta } from "./contas";
import { whatsappParaLer } from "./regras";

/** A conta da sessão a partir do valor do cookie, ou `null`. */
export async function contaDoCookie(admin: SupabaseClient, valor: string | null | undefined, agora: Date = new Date()): Promise<LinhaDaConta | null> {
  const contaId = lerSessao(valor, agora);
  if (!contaId) return null;
  return lerConta(admin, contaId);
}

/** O cookie da área lido de um cabeçalho `cookie` (as rotas). */
export function cookieDoPedido(headers: Headers): string | null {
  const bruto = headers.get("cookie");
  if (!bruto) return null;
  for (const parte of bruto.split(";")) {
    const [nome, ...resto] = parte.trim().split("=");
    if (nome === NOME_DO_COOKIE) return decodeURIComponent(resto.join("="));
  }
  return null;
}

export type AcessoDaRota = { ok: true; conta: LinhaDaConta } | { ok: false; motivo: "origem" | "sem_sessao" };

/** Todo POST da área: a origem é o próprio app e o cookie é de uma conta que existe. */
export async function conferirPedidoDaArea(admin: SupabaseClient, headers: Headers, agora: Date = new Date()): Promise<AcessoDaRota> {
  if (!veioDoProprioApp(headers)) return { ok: false, motivo: "origem" };
  const conta = await contaDoCookie(admin, cookieDoPedido(headers), agora);
  return conta ? { ok: true, conta } : { ok: false, motivo: "sem_sessao" };
}

export type SituacaoNaArea = "aguardando_conectar" | "link_vencido" | "lendo" | "analisando" | "pronto" | "sem_historico" | "encerrado";

export interface RaioXNaArea {
  id: string;
  empresa: string;
  whatsapp: string;
  whatsappParaLer: string;
  tipo: "unico" | "mensal";
  gratis: boolean;
  situacao: SituacaoNaArea;
  /** O período do relatório mais novo (ou o da leitura). */
  periodo: { inicio: string; fim: string } | null;
  conversas: number | null;
  nota: number | null;
  /** O relatório que abre (o mais novo revisado). */
  relatorioId: string | null;
  criadoEm: string;
  conexao: {
    conectado: boolean;
    caiEm: string | null;
    /** O link vivo para conectar, quando falta conectar. */
    link: string | null;
  };
}

function situacaoNaArea(r: LinhaDoRaioX, temRelatorio: boolean, agora: Date): SituacaoNaArea {
  if (r.sem_historico_em) return "sem_historico";
  if (r.situacao === "aguardando" || r.situacao === "conectando") return podeConectar(r, agora) ? "aguardando_conectar" : "link_vencido";
  if (r.situacao === "lendo") return "lendo";
  if (r.situacao === "analisando") return "analisando";
  if (r.situacao === "pronto" || temRelatorio) return "pronto";
  return "encerrado";
}

/** O que a área mostra de UM raio-X da conta. */
export function raioXParaArea(r: LinhaDoRaioX, relatorios: LinhaDoRelatorio[], agora: Date = new Date()): RaioXNaArea {
  const revisados = relatorios.filter((x) => x.situacao === "revisado").sort((a, b) => b.sequencia - a.sequencia);
  const ultimo = revisados[0] ?? null;
  const situacao = situacaoNaArea(r, Boolean(ultimo), agora);
  const conectado = Boolean(r.conectado_em && !r.desconectado_em && r.sessao);
  return {
    id: r.id,
    empresa: r.empresa,
    whatsapp: r.whatsapp,
    whatsappParaLer: whatsappParaLer(r.whatsapp),
    tipo: r.tipo,
    gratis: r.gratis === true,
    situacao,
    periodo: ultimo ? { inicio: ultimo.periodo_inicio, fim: ultimo.periodo_fim } : r.periodo_inicio && r.periodo_fim ? { inicio: r.periodo_inicio, fim: r.periodo_fim } : null,
    conversas: ultimo ? ultimo.conversas : null,
    nota: ultimo ? (ultimo.dados?.notas?.media ?? null) : null,
    relatorioId: ultimo?.id ?? null,
    criadoEm: r.created_at,
    conexao: {
      conectado,
      caiEm: conectado ? r.desconectar_em : null,
      link: situacao === "aguardando_conectar" ? linkDeConexaoAtual(r).link : null,
    },
  };
}

/** Os raio-X da conta, como a área mostra (o mais novo primeiro). */
export async function raioXDaArea(admin: SupabaseClient, conta: LinhaDaConta, agora: Date = new Date()): Promise<RaioXNaArea[]> {
  const lista = await raioXDaConta(admin, conta.id);
  return Promise.all(lista.map(async (r) => raioXParaArea(r, await lerRelatorios(admin, r.id), agora)));
}

/** Um raio-X da conta, ou `null` (não existe OU é de outra conta: a mesma resposta). */
export async function raioXDaContaPeloId(
  admin: SupabaseClient,
  conta: Pick<LinhaDaConta, "id">,
  id: string,
): Promise<{ raioX: LinhaDoRaioX; relatorios: LinhaDoRelatorio[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const lista = await raioXDaConta(admin, conta.id);
  const raioX = lista.find((r) => r.id === id) ?? null;
  if (!raioX) return null;
  return { raioX, relatorios: await lerRelatorios(admin, raioX.id) };
}
