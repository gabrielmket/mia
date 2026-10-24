/**
 * FORK MIA (.88) — OS CHAMADOS DO LADO DA TIME COMPANY: a lista e a resposta.
 *
 * Duas portas usam isto, e nenhuma é do cliente: a tela do admin da plataforma
 * (`/admin/chamados`) e o MCP de plataforma (`plataforma_ver_chamados`,
 * `plataforma_responder_chamado`). Por isso o cliente é o de SERVIÇO, e a
 * empresa, quando há, vem de fonte confiável (o id conferido pelo MCP, ou a
 * linha do próprio chamado).
 *
 * ── A resposta chega para quem abriu, em três lugares ───────────────────────
 *
 *   no assistente   uma mensagem `resposta_do_chamado` na conversa em que o
 *                   chamado nasceu (ou numa conversa nova "Chamado #N");
 *   no sino         um aviso da Central para a pessoa, com o botão "Ver a
 *                   resposta", e o push pela porta única;
 *   no e-mail       pelo roteador de e-mail, com a empresa: a trava da
 *                   demonstração vale ali também.
 *
 * O chamado da empresa de demonstração não sai para a Time: não entra na lista e
 * não é respondido por aqui.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { marcaDaSaida } from "@/lib/branding/saida";
import { sendEmail } from "@/lib/email/roteador";
import { env } from "@/lib/env";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { logger } from "@/lib/logger";

import { avisarNoSino } from "./avisos";
import { emailDaRespostaDoChamado } from "./email-do-chamado";
import { ROTULO_DA_SITUACAO, ROTULO_DO_TIPO_DE_CHAMADO, type SituacaoDeChamado, type TipoDeChamado } from "./tipos";

export interface ChamadoDaPlataforma {
  id: string;
  numero: number;
  organization_id: string;
  empresa: string | null;
  user_id: string | null;
  quem_abriu: string | null;
  tipo: TipoDeChamado;
  texto: string;
  contexto: Record<string, unknown>;
  tem_print: boolean;
  situacao: SituacaoDeChamado;
  resposta: string | null;
  respondido_em: string | null;
  created_at: string;
  updated_at: string;
}

const COLUNAS =
  "id, numero, organization_id, user_id, tipo, texto, contexto, print_path, situacao, resposta, respondido_em, demonstracao, conversa_id, created_at, updated_at";

async function nomeDoUsuario(admin: SupabaseClient, userId: string | null): Promise<{ nome: string | null; email: string | null; idioma: string | null }> {
  if (!userId) return { nome: null, email: null, idioma: null };
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    const u = data?.user;
    return {
      nome: (u?.user_metadata?.full_name as string | undefined) ?? null,
      email: u?.email ?? null,
      idioma: (u?.user_metadata?.locale as string | undefined) ?? null,
    };
  } catch {
    return { nome: null, email: null, idioma: null };
  }
}

export async function listarChamadosDaPlataforma(
  admin: SupabaseClient,
  filtro: { organizationId?: string | null; situacao?: SituacaoDeChamado | "abertos" | "todos"; limite?: number; incluirDemonstracao?: boolean },
): Promise<ChamadoDaPlataforma[]> {
  let consulta = admin
    .from("mia_chamados")
    .select(COLUNAS)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(filtro.limite ?? 50, 1), 200));
  if (filtro.organizationId) consulta = consulta.eq("organization_id", filtro.organizationId);
  if (!filtro.incluirDemonstracao) consulta = consulta.eq("demonstracao", false);
  const situacao = filtro.situacao ?? "abertos";
  if (situacao === "abertos") consulta = consulta.in("situacao", ["novo", "em_analise"]);
  else if (situacao !== "todos") consulta = consulta.eq("situacao", situacao);
  const { data, error } = await consulta;
  if (error) throw new Error(`não consegui ler os chamados: ${error.message}`);
  const linhas = (data ?? []) as Array<Record<string, unknown>>;

  const orgIds = [...new Set(linhas.map((l) => l.organization_id as string))];
  const { data: orgs } = orgIds.length
    ? await admin.from("organizations").select("id, display_name").in("id", orgIds)
    : { data: [] };
  const nomeDaEmpresa = new Map(((orgs ?? []) as Array<{ id: string; display_name: string | null }>).map((o) => [o.id, o.display_name]));

  const pessoas = new Map<string, string | null>();
  for (const id of [...new Set(linhas.map((l) => l.user_id as string | null).filter((x): x is string => !!x))].slice(0, 60)) {
    pessoas.set(id, (await nomeDoUsuario(admin, id)).nome);
  }

  return linhas.map((l) => ({
    id: l.id as string,
    numero: Number(l.numero),
    organization_id: l.organization_id as string,
    empresa: nomeDaEmpresa.get(l.organization_id as string) ?? null,
    user_id: (l.user_id as string | null) ?? null,
    quem_abriu: l.user_id ? (pessoas.get(l.user_id as string) ?? null) : null,
    tipo: l.tipo as TipoDeChamado,
    texto: l.texto as string,
    contexto: (l.contexto as Record<string, unknown>) ?? {},
    tem_print: typeof l.print_path === "string" && (l.print_path as string).length > 0,
    situacao: l.situacao as SituacaoDeChamado,
    resposta: (l.resposta as string | null) ?? null,
    respondido_em: (l.respondido_em as string | null) ?? null,
    created_at: l.created_at as string,
    updated_at: l.updated_at as string,
  }));
}

export class RecusaDoChamado extends Error {}

export interface RespostaAoChamado {
  numero: number;
  situacao: SituacaoDeChamado;
  entregue: { assistente: boolean; sino: boolean; email: boolean };
}

/**
 * Responde e/ou muda a situação. A entrega a quem abriu acontece quando há
 * resposta nova ou quando o chamado é resolvido.
 */
export async function responderChamado(
  admin: SupabaseClient,
  pedido: {
    /** Pelo número (MCP) ou pelo id (tela). */
    numero?: number;
    id?: string;
    /** Quando vem, o chamado tem de ser desta empresa. */
    organizationId?: string | null;
    situacao: SituacaoDeChamado;
    resposta?: string | null;
    respondidoPor: string | null;
  },
): Promise<RespostaAoChamado> {
  let consulta = admin.from("mia_chamados").select(COLUNAS).limit(1);
  if (pedido.id) consulta = consulta.eq("id", pedido.id);
  else if (typeof pedido.numero === "number") consulta = consulta.eq("numero", pedido.numero);
  else throw new RecusaDoChamado("Diga qual chamado: o número.");
  if (pedido.organizationId) consulta = consulta.eq("organization_id", pedido.organizationId);
  const { data, error } = await consulta.maybeSingle();
  if (error) throw new Error(`não consegui ler o chamado: ${error.message}`);
  if (!data) {
    throw new RecusaDoChamado(
      `Não existe chamado ${pedido.numero ? `#${pedido.numero} ` : ""}nesta empresa. Use plataforma_ver_chamados para achar o número.`,
    );
  }
  const chamado = data as {
    id: string;
    numero: number;
    organization_id: string;
    user_id: string | null;
    situacao: SituacaoDeChamado;
    resposta: string | null;
    demonstracao: boolean;
    conversa_id: string | null;
  };
  if (chamado.demonstracao) {
    throw new RecusaDoChamado("Este chamado é da empresa de demonstração: ele não sai para a Time e não é respondido por aqui.");
  }

  const resposta = typeof pedido.resposta === "string" ? pedido.resposta.trim() : null;
  const respostaNova = resposta !== null && resposta.length > 0 && resposta !== (chamado.resposta ?? "").trim();
  const agora = new Date().toISOString();
  const { error: erroUpdate } = await admin
    .from("mia_chamados")
    .update({
      situacao: pedido.situacao,
      ...(respostaNova ? { resposta, respondido_por: pedido.respondidoPor, respondido_em: agora } : {}),
      updated_at: agora,
    })
    .eq("organization_id", chamado.organization_id)
    .eq("id", chamado.id);
  if (erroUpdate) throw new Error(`não consegui gravar a resposta: ${erroUpdate.message}`);

  const entregue = { assistente: false, sino: false, email: false };
  const resolveuAgora = pedido.situacao === "resolvido" && chamado.situacao !== "resolvido";
  if (!chamado.user_id || (!respostaNova && !resolveuAgora)) {
    return { numero: chamado.numero, situacao: pedido.situacao, entregue };
  }

  const pessoa = await nomeDoUsuario(admin, chamado.user_id);
  const idioma = normalizarIdioma(pessoa.idioma);
  const t = (texto: string) => traduzir(texto, idioma);
  const situacaoLegivel = ROTULO_DA_SITUACAO[pedido.situacao];
  const situacaoTraduzida = t(ROTULO_DA_SITUACAO[pedido.situacao]);
  const respostaFinal = respostaNova ? resposta : (chamado.resposta ?? null);
  const cabeca = resolveuAgora
    ? t("Seu chamado #{n} foi resolvido.").replace("{n}", String(chamado.numero))
    : t("A Time Company respondeu o seu chamado #{n} ({s}).")
        .replace("{n}", String(chamado.numero))
        .replace("{s}", situacaoTraduzida);
  const texto = respostaFinal ? `${cabeca}\n\n${respostaFinal}` : cabeca;

  // 1 · no assistente: na conversa em que o chamado nasceu, ou numa nova.
  try {
    let conversaId = chamado.conversa_id;
    if (conversaId) {
      const { data: conversa } = await admin
        .from("mia_assistente_conversas")
        .select("id")
        .eq("organization_id", chamado.organization_id)
        .eq("id", conversaId)
        .eq("user_id", chamado.user_id)
        .maybeSingle();
      if (!conversa) conversaId = null;
    }
    if (!conversaId) {
      const { data: nova } = await admin
        .from("mia_assistente_conversas")
        .insert({
          organization_id: chamado.organization_id,
          user_id: chamado.user_id,
          titulo: t("Chamado #{n}").replace("{n}", String(chamado.numero)),
          origem: "chamado",
        })
        .select("id")
        .single();
      conversaId = (nova as { id: string } | null)?.id ?? null;
    }
    if (conversaId) {
      const { error: erroMensagem } = await admin.from("mia_assistente_mensagens").insert({
        organization_id: chamado.organization_id,
        conversa_id: conversaId,
        user_id: chamado.user_id,
        tipo: "resposta_do_chamado",
        texto: texto.slice(0, 20000),
        fontes: ["Chamados"],
        acoes: [],
      });
      entregue.assistente = !erroMensagem;
      await admin
        .from("mia_assistente_conversas")
        .update({ ultima_em: agora })
        .eq("organization_id", chamado.organization_id)
        .eq("id", conversaId);
    }
  } catch (erro) {
    logger.warn("[assistente] a resposta do chamado não entrou no assistente", {
      numero: chamado.numero,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
  }

  // 2 · no sino
  entregue.sino = await avisarNoSino(admin, {
    organizationId: chamado.organization_id,
    paraUserId: chamado.user_id,
    titulo: cabeca,
    corpo: respostaFinal ? respostaFinal.slice(0, 600) : null,
    refKind: "mia_chamado",
    refId: chamado.id,
    severidade: "info",
    push: { titulo: t("Assistente da MIA"), href: "/app/assistente?aba=chamados", tag: `mia-chamado:${chamado.numero}` },
  });

  // 3 · no e-mail (a trava da demonstração vale pela empresa)
  if (pessoa.email) {
    const marca = await marcaDaSaida(chamado.organization_id);
    const email = emailDaRespostaDoChamado({
      marca,
      numero: chamado.numero,
      situacao: situacaoLegivel,
      resposta: respostaFinal,
      linkDoAssistente: `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/app/assistente?aba=chamados`,
      idioma,
    });
    const r = await sendEmail({
      to: pessoa.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      fromName: marca.nome,
      tags: [{ name: "tipo", value: "chamado_respondido" }],
      organizationId: chamado.organization_id,
    });
    entregue.email = r.ok;
    if (!r.ok) {
      logger.warn("[assistente] o e-mail da resposta do chamado não saiu", { numero: chamado.numero, erro: r.error ?? null });
    }
  }

  return { numero: chamado.numero, situacao: pedido.situacao, entregue };
}

/** O rótulo do tipo, para as telas e o MCP. */
export function rotuloDoTipo(tipo: TipoDeChamado): string {
  return ROTULO_DO_TIPO_DE_CHAMADO[tipo];
}
