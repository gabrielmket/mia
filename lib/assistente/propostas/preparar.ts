/**
 * FORK MIA (.91) — PREPARAR uma proposta: ler o que existe (com o cliente de
 * quem chama, a SESSÃO no turno) e montar a peça, sem gravar nada.
 *
 * "Propor não cria rascunho nem efeito colateral" (#2860): aqui só se lê. O
 * turno do assistente junta a proposta no coletor, e a rota grava a linha
 * pendente em `mia_assistente_propostas` (9080). A peça só nasce no aplicar.
 *
 * Cada preparação pode devolver, em vez da proposta, que a peça JÁ EXISTE (e
 * onde mexer nela) ou que ela DEPENDE de outra (o follow-up é de um agente).
 * Este arquivo não importa o cliente de serviço.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { modeloPorId } from "@/lib/followup/modelos";
import {
  ehSegmentoDoOnboarding,
  modeloDoSegmento,
  nomeDoAgenteDoModelo,
  pacoteDoSegmento,
  promptDoModelo,
  segmentoDoEstado,
  sugerirSegmento,
  type SegmentoDoOnboarding,
} from "@/lib/onboarding/modelos-de-agente-da-mia";

import { JANELA_DO_FOLLOWUP_DO_MODELO, type PropostaDoTurno } from "./tipos";

const ROTULO_DO_JEITO = {
  ecommerce_friendly: "Próximo e caloroso",
  ecommerce_professional: "Objetivo e cordial",
  support_minimal: "Curto e prático",
} as const;

export type Preparacao =
  | { ok: true; proposta: PropostaDoTurno }
  | { ok: false; motivo: "ja_existe" | "depende" | "sem_empresa"; mensagem: string; href?: string };

interface EmpresaLida {
  nome: string;
  segmento: SegmentoDoOnboarding;
  oQueFaz: string | null;
}

/** O segmento confirmado no passo "Seu negócio"; sem ele, o que a MIA lê no que a empresa faz. */
export async function lerEmpresaParaOModelo(
  db: SupabaseClient,
  organizationId: string,
  segmentoPedido?: string | null,
): Promise<EmpresaLida | null> {
  const { data } = await db
    .from("organizations")
    .select("display_name, onboarding_state")
    .eq("id", organizationId)
    .maybeSingle();
  if (!data) return null;
  const linha = data as { display_name?: string | null; onboarding_state?: { welcome?: { o_que_faz?: string } } | null };
  const oQueFaz = linha.onboarding_state?.welcome?.o_que_faz?.trim() || null;
  // O nome da EMPRESA (não de contato): a régua `nomeDoContato` não se aplica.
  const nomeDaEmpresa = typeof linha.display_name === "string" ? linha.display_name.trim() : "";
  const segmento: SegmentoDoOnboarding = ehSegmentoDoOnboarding(segmentoPedido)
    ? segmentoPedido
    : (segmentoDoEstado(linha.onboarding_state) ?? sugerirSegmento(`${nomeDaEmpresa} ${oQueFaz ?? ""}`));
  return { nome: nomeDaEmpresa || "a empresa", segmento, oQueFaz };
}

interface AgenteLido {
  id: string;
  name: string;
  published_version_id: string | null;
  is_default: boolean;
}

async function lerAgentesVivos(db: SupabaseClient, organizationId: string): Promise<AgenteLido[]> {
  const { data } = await db
    .from("ai_agents")
    .select("id, name, published_version_id, is_default")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(20);
  return (data ?? []) as AgenteLido[];
}

export async function prepararAgenteDoModelo(
  db: SupabaseClient,
  organizationId: string,
  segmentoPedido?: string | null,
): Promise<Preparacao> {
  const empresa = await lerEmpresaParaOModelo(db, organizationId, segmentoPedido);
  if (!empresa) return { ok: false, motivo: "sem_empresa", mensagem: "Não consegui ler a empresa." };
  const agentes = await lerAgentesVivos(db, organizationId);
  if (agentes.length > 0) {
    const a = agentes.find((x) => x.is_default) ?? agentes[0]!;
    return {
      ok: false,
      motivo: "ja_existe",
      mensagem: `A empresa já tem o agente «${a.name}»${a.published_version_id ? ", no ar" : ", em rascunho"}. Ajustar o texto dele fica em Agente MIA › Agentes.`,
      href: `/app/ai/agents/${a.id}`,
    };
  }
  const m = modeloDoSegmento(empresa.segmento);
  const nome = nomeDoAgenteDoModelo(empresa.segmento);
  const prompt = promptDoModelo(empresa.segmento, { persona: m.persona, negocio: empresa.nome, oQueFaz: empresa.oQueFaz });
  return {
    ok: true,
    proposta: {
      tipo: "agente",
      titulo: `Agente "${nome}", do modelo de ${m.curto}`,
      mudancas: [
        { rotulo: "Nome", valor: nome },
        { rotulo: "Jeito", valor: ROTULO_DO_JEITO[m.jeito] },
        { rotulo: "Sabe", valor: m.faz[0] ?? "" },
        { rotulo: "Nunca", valor: m.naoFaz[0] ?? "" },
        { rotulo: "Fica", valor: "rascunho: não responde ninguém até você publicar" },
      ],
      pedido: { segmento: empresa.segmento, nome, persona: m.persona, jeito: m.jeito, prompt },
    },
  };
}

export async function prepararFunilDoPacote(
  db: SupabaseClient,
  organizationId: string,
  segmentoPedido?: string | null,
): Promise<Preparacao> {
  const empresa = await lerEmpresaParaOModelo(db, organizationId, segmentoPedido);
  if (!empresa) return { ok: false, motivo: "sem_empresa", mensagem: "Não consegui ler a empresa." };
  const { data: funis } = await db
    .from("crm_pipelines")
    .select("id, name, slug, is_default")
    .eq("organization_id", organizationId)
    .eq("is_archived", false);
  const lista = (funis ?? []) as Array<{ id: string; name: string; slug: string; is_default: boolean }>;
  // O funil de e-commerce que nasce com a organização não conta: é ele que o quadro pronto troca.
  const { data: etapas } = await db
    .from("crm_stages")
    .select("pipeline_id, slug")
    .eq("organization_id", organizationId)
    .eq("slug", "carrinho_abandonado");
  const semeados = new Set(((etapas ?? []) as Array<{ pipeline_id: string }>).map((e) => e.pipeline_id));
  const proprio = lista.find((f) => !(f.slug === "pedidos" && semeados.has(f.id)));
  if (proprio) {
    return {
      ok: false,
      motivo: "ja_existe",
      mensagem: `A empresa já tem o funil «${proprio.name}». As etapas mudam em Configurações › Funis.`,
      href: "/app/settings/tenant/pipelines",
    };
  }
  const m = modeloDoSegmento(empresa.segmento);
  const pacote = pacoteDoSegmento(empresa.segmento);
  const etapasDoPacote = pacote.proposta.etapas.map((e) => ({ nome: e.nome, passo: e.passo }));
  const ganho = etapasDoPacote.find((e) => e.passo === "won")?.nome ?? "";
  const perda = etapasDoPacote.find((e) => e.passo === "lost")?.nome ?? "";
  return {
    ok: true,
    proposta: {
      tipo: "funil",
      titulo: `Funil "${pacote.proposta.nome}", do quadro pronto de ${m.curto}`,
      mudancas: [
        { rotulo: "Funil", valor: pacote.proposta.nome },
        { rotulo: "Etapas", valor: etapasDoPacote.map((e) => e.nome).join(" · ") },
        { rotulo: "Ganho", valor: ganho },
        { rotulo: "Perda", valor: perda },
        { rotulo: "Fica", valor: "no lugar do quadro de e-commerce que veio com a empresa; os nomes você muda depois" },
      ],
      pedido: { segmento: empresa.segmento, pacote: pacote.id, nome: pacote.proposta.nome, etapas: etapasDoPacote },
    },
  };
}

export async function prepararFollowupDoModelo(
  db: SupabaseClient,
  organizationId: string,
  segmentoPedido?: string | null,
): Promise<Preparacao> {
  const empresa = await lerEmpresaParaOModelo(db, organizationId, segmentoPedido);
  if (!empresa) return { ok: false, motivo: "sem_empresa", mensagem: "Não consegui ler a empresa." };
  const agentes = await lerAgentesVivos(db, organizationId);
  if (agentes.length === 0) {
    return {
      ok: false,
      motivo: "depende",
      mensagem: "Primeiro o agente: o follow-up é sempre de um agente. Posso preparar o agente do modelo antes.",
    };
  }
  const m = modeloDoSegmento(empresa.segmento);
  const modelo = modeloPorId(m.followup.modelo);
  if (!modelo) return { ok: false, motivo: "sem_empresa", mensagem: "O modelo de follow-up do segmento não existe nesta versão." };
  const { data: fluxos } = await db
    .from("followup_flow_pointers")
    .select("id, name")
    .eq("organization_id", organizationId)
    .limit(200);
  const ja = ((fluxos ?? []) as Array<{ id: string; name: string }>).find((f) => f.name.trim().toLowerCase() === modelo.nome.trim().toLowerCase());
  if (ja) {
    return {
      ok: false,
      motivo: "ja_existe",
      mensagem: `O follow-up «${ja.name}» já está instalado. Os textos e a publicação ficam em Agente MIA › Follow-ups.`,
      href: "/app/ai/followups",
    };
  }
  const agente = agentes.find((a) => a.is_default) ?? agentes[0]!;
  const janela = { ...JANELA_DO_FOLLOWUP_DO_MODELO, dias: [...JANELA_DO_FOLLOWUP_DO_MODELO.dias] };
  return {
    ok: true,
    proposta: {
      tipo: "followup",
      titulo: `Follow-up "${modelo.nome}"`,
      mudancas: [
        { rotulo: "Modelo", valor: modelo.nome },
        { rotulo: "Agente", valor: agente.name },
        { rotulo: "Quando", valor: modelo.oQueDispara },
        { rotulo: "Horário", valor: "só das 8h às 19h, em dia útil" },
        { rotulo: "Fica", valor: "rascunho: sai junto com o agente publicado" },
      ],
      pedido: {
        segmento: empresa.segmento,
        modelo: modelo.id,
        nome: modelo.nome,
        agente_id: agente.id,
        agente_nome: agente.name,
        passo: m.followup.passo,
        janela,
      },
    },
  };
}
