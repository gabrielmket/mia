/**
 * FORK MIA (.91, .94) · GRAVAR as propostas do turno: uma linha PENDENTE por
 * peça, pela SESSÃO de quem perguntou (a RLS da 9100: atendente em diante
 * propõe), e o cartão de cada uma para os botões da resposta.
 *
 * Pedir de novo a mesma peça não duplica: o banco tem uma pendente por PEÇA e
 * empresa (a `chave`, 9100), e a pendente que já existe volta no lugar de uma
 * nova. Nada da peça é criado aqui. O risco vem do banco, pelo tipo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";

import type { AcaoDoAssistente } from "../tipos";
import { chaveNoBanco, type PropostaDoTurno } from "./tipos";

export async function gravarPropostasDoTurno(
  db: SupabaseClient,
  entrada: { organizationId: string; userId: string; conversaId: string | null; requestId: string; propostas: readonly PropostaDoTurno[] },
): Promise<AcaoDoAssistente[]> {
  const acoes: AcaoDoAssistente[] = [];
  for (const p of entrada.propostas) {
    let id: string | null = null;
    let titulo = p.titulo;
    let mudancas = p.mudancas;
    const { data, error } = await db
      .from("mia_assistente_propostas")
      .insert({
        organization_id: entrada.organizationId,
        conversa_id: entrada.conversaId,
        tipo: p.tipo,
        titulo: p.titulo.slice(0, 200),
        mudancas: p.mudancas,
        pedido: p.pedido,
        chave: chaveNoBanco(p.tipo, entrada.userId, p.chave),
      })
      .select("id")
      .single();
    if (!error && data) {
      id = (data as { id: string }).id;
      void audit({
        action: "assistente.proposta_criada",
        actorUserId: entrada.userId,
        organizationId: entrada.organizationId,
        resourceType: "mia_assistente_propostas",
        resourceId: id,
        requestId: entrada.requestId,
        metadata: { tipo: p.tipo, via_assistente: true },
      });
    } else if ((error as { code?: string } | null)?.code === "23505") {
      // Já há uma pendente desta peça: o cartão é o dela.
      const { data: pendente } = await db
        .from("mia_assistente_propostas")
        .select("id, titulo, mudancas")
        .eq("organization_id", entrada.organizationId)
        .eq("tipo", p.tipo)
        .eq("chave", chaveNoBanco(p.tipo, entrada.userId, p.chave))
        .eq("situacao", "pendente")
        .maybeSingle();
      const linha = pendente as { id: string; titulo: string; mudancas: PropostaDoTurno["mudancas"] } | null;
      if (linha) {
        id = linha.id;
        titulo = linha.titulo;
        mudancas = Array.isArray(linha.mudancas) ? linha.mudancas : p.mudancas;
      }
    }
    if (!id) continue;
    acoes.push({ tipo: "proposta", rotulo: "Proposta", proposta_id: id, proposta_tipo: p.tipo, titulo, mudancas });
  }
  return acoes;
}
