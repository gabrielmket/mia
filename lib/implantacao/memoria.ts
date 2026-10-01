/**
 * FORK MIA — GRAVAR a memória da empresa de um cliente: as regras da casa que
 * TODOS os agentes seguem (o documento) e as anotações avulsas.
 *
 * ── O caminho da tela que isto reusa ──────────────────────────────────────
 *
 *   documento   `publicarMemoriaDaOrg` (`lib/ai/memoria-da-org.ts`), a mesma
 *               função da tela de Memória e do passo de treinamento do
 *               onboarding: cada publicação é uma versão nova e move o ponteiro
 *   anotação    a linha em `org_memory_entries` com origem `manual` e situação
 *               `active`, como `POST /api/v1/ai/memory/entries`
 *
 * ── Repetir sem empilhar ──────────────────────────────────────────────────
 *
 * O documento é versionado: publicar o mesmo texto de novo criaria uma versão
 * idêntica a cada rodada da implantação. Aqui o texto é comparado com o que
 * está em vigor, e só publica se mudou. A anotação casa pelo TÍTULO: título
 * novo nasce, título igual com corpo igual não mexe, e corpo diferente arquiva
 * a antiga e cria a nova (a tela não edita o corpo de uma anotação, só a
 * arquiva; o histórico fica).
 */
import { publicarMemoriaDaOrg } from "@/lib/ai/memoria-da-org";
import { audit } from "@/lib/audit";

import { chaveDoNome, type Desfecho, type Implantacao } from "./base";

/** Quantas anotações uma chamada aceita. */
export const TETO_DE_ANOTACOES = 50;

export interface PedidoDeMemoria {
  documento?: string;
  anotacoes?: Array<{ titulo: string; corpo: string }>;
}

export interface MemoriaGravada {
  documento: { desfecho: Desfecho | "nao_pedido"; versao: number | null };
  anotacoes: Array<{ titulo: string; desfecho: Desfecho }>;
}

export async function lerDocumentoDaMemoria(
  c: Pick<Implantacao, "admin" | "orgId">,
): Promise<{ versao: number; conteudo: string; criado_em: string } | null> {
  const { data: ponteiro } = await c.admin
    .from("org_memory_pointers")
    .select("version_id")
    .eq("organization_id", c.orgId)
    .maybeSingle();
  const versionId = (ponteiro as { version_id?: string | null } | null)?.version_id;
  if (!versionId) return null;
  const { data: versao } = await c.admin
    .from("org_memory_versions")
    .select("version_number, content, created_at")
    .eq("id", versionId)
    .eq("organization_id", c.orgId)
    .maybeSingle();
  if (!versao) return null;
  const linha = versao as { version_number: number; content: string; created_at: string };
  return { versao: linha.version_number, conteudo: linha.content, criado_em: linha.created_at };
}

export async function gravarMemoria(c: Implantacao, pedido: PedidoDeMemoria): Promise<MemoriaGravada> {
  const resultado: MemoriaGravada = { documento: { desfecho: "nao_pedido", versao: null }, anotacoes: [] };

  if (pedido.documento !== undefined) {
    const conteudo = pedido.documento.trim();
    const emVigor = await lerDocumentoDaMemoria(c);
    if (emVigor && emVigor.conteudo.trim() === conteudo) {
      resultado.documento = { desfecho: "ja_estava", versao: emVigor.versao };
    } else {
      const publicado = await publicarMemoriaDaOrg(c.admin, c.orgId, c.autorUserId, conteudo);
      if (!publicado.ok) {
        throw new Error(
          publicado.erro === "versao"
            ? `não consegui gravar a versão da memória: ${publicado.mensagem}`
            : `a versão da memória foi gravada, mas não entrou em vigor (o agente segue lendo a anterior): ${publicado.mensagem}`,
        );
      }
      void audit({
        action: "ai.org_memory_published",
        actorUserId: c.autorUserId,
        organizationId: c.orgId,
        resourceType: "org_memory_versions",
        resourceId: publicado.versionId,
        requestId: c.requestId,
        metadata: { version_number: publicado.versionNumber, via: "mcp_plataforma" },
      });
      resultado.documento = { desfecho: emVigor ? "atualizou" : "criou", versao: publicado.versionNumber };
    }
  }

  if (pedido.anotacoes && pedido.anotacoes.length > 0) {
    const { data, error } = await c.admin
      .from("org_memory_entries")
      .select("id, title, body, status")
      .eq("organization_id", c.orgId)
      .eq("status", "active");
    if (error) throw new Error(`não consegui ler as anotações da memória: ${error.message}`);
    const ativas = (data ?? []) as Array<{ id: string; title: string; body: string }>;

    for (const pedida of pedido.anotacoes) {
      const titulo = pedida.titulo.trim();
      const corpo = pedida.corpo.trim();
      const existente = ativas.find((a) => chaveDoNome(a.title) === chaveDoNome(titulo));
      if (existente && existente.body.trim() === corpo) {
        resultado.anotacoes.push({ titulo, desfecho: "ja_estava" });
        continue;
      }
      if (existente) {
        const { error: arqErr } = await c.admin
          .from("org_memory_entries")
          .update({ status: "archived", updated_at: new Date().toISOString() })
          .eq("id", existente.id)
          .eq("organization_id", c.orgId);
        if (arqErr) throw new Error(`não consegui arquivar a anotação antiga «${titulo}»: ${arqErr.message}`);
      }
      const { data: criada, error: insErr } = await c.admin
        .from("org_memory_entries")
        .insert({
          organization_id: c.orgId,
          title: titulo,
          body: corpo,
          source: "manual",
          status: "active",
          created_by: c.autorUserId,
        })
        .select("id")
        .single();
      if (insErr || !criada) throw new Error(`não consegui gravar a anotação «${titulo}»: ${insErr?.message ?? "sem linha"}`);
      void audit({
        action: "ai.org_memory_entry_created",
        actorUserId: c.autorUserId,
        organizationId: c.orgId,
        resourceType: "org_memory_entries",
        resourceId: (criada as { id: string }).id,
        requestId: c.requestId,
        metadata: { via: "mcp_plataforma" },
      });
      resultado.anotacoes.push({ titulo, desfecho: existente ? "atualizou" : "criou" });
    }
  }

  return resultado;
}
