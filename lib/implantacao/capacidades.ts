/**
 * FORK MIA — as capacidades que a tela do agente OFERECE a uma organização.
 *
 * É a mesma conta de `GET /api/v1/mcp/tools`, que alimenta o seletor de
 * capacidades do editor de agente: o catálogo com handler, menos o que é de
 * módulo desligado na instalação, menos o que a organização desligou, menos a
 * capacidade de empresa para quem vende para pessoa. A ferramenta de
 * implantação escolhe capacidades por pacote, e precisa escolher dentro da
 * MESMA lista: ligar por aqui o que a tela não oferece seria um agente com uma
 * capacidade que ninguém consegue desmarcar depois.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { CAPACIDADES_DE_EMPRESA, modoDeVendaDaOrganizacao, mostraEmpresas } from "@/lib/empresas/modo-de-venda";
import { modulosLigados } from "@/lib/instalacao/modulos";
import { allTools } from "@/lib/mcp/tools";
import { TOOL_CATALOG, deCapacidadeDesligada, deModuloDesligado } from "@/lib/mcp/tools/catalog";
import { juntarCatalogoComHandlers, type CapacidadeServida } from "@/lib/mcp/tools/catalogo-servido";
import { PACOTES, type ToolBundle } from "@/lib/mcp/tools/pacotes";
import {
  TETO_TOOLS_POR_AGENTE,
  capacidadesAutomaticasDoPacote,
  capacidadesCriticasDoPacote,
  ligarPacote,
  type CapacidadeSelecionavel,
} from "@/lib/mcp/tools/selecao-por-pacote";
import { capacidadesDaOrganizacao } from "@/lib/organizacao/capacidades";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

/** O catálogo inteiro, sem recorte de organização: o que a instalação conhece. */
export function catalogoServido(): CapacidadeServida[] {
  return juntarCatalogoComHandlers(allTools, TOOL_CATALOG);
}

/** O que a tela de capacidades ofereceria a esta organização, agora. */
export async function capacidadesOferecidas(
  admin: SupabaseClient,
  orgId: string,
): Promise<CapacidadeServida[]> {
  const [ligados, capacidades, modo] = await Promise.all([
    modulosLigados(admin),
    capacidadesDaOrganizacao(admin, orgId),
    modoDeVendaDaOrganizacao(admin, orgId),
  ]);
  const mostrarEmpresas = mostraEmpresas(modo);
  return catalogoServido().filter(
    (c) =>
      !deModuloDesligado(c.id, ligados) &&
      !deCapacidadeDesligada(c.id, capacidades) &&
      (mostrarEmpresas || !CAPACIDADES_DE_EMPRESA.includes(c.id)),
  );
}

function selecionaveis(oferecidas: readonly CapacidadeServida[]): CapacidadeSelecionavel[] {
  return oferecidas.map((c) => ({ name: c.id, risco: c.risco, pacotes: c.pacotes, marcavel: c.marcavel }));
}

/**
 * A lista de capacidades de um agente a partir de PACOTES e de capacidades
 * avulsas, com as regras da tela: o pacote liga as que não são críticas
 * (`ligarPacote`), a crítica entra uma a uma, e o total respeita o teto.
 */
export function montarCapacidades(
  oferecidas: readonly CapacidadeServida[],
  pedido: { pacotes?: readonly string[]; capacidades?: readonly string[] },
): { tool_ids: string[]; avisos: string[] } {
  const catalogo = selecionaveis(oferecidas);
  const avisos: string[] = [];
  let selecao: string[] = [];

  for (const pacote of pedido.pacotes ?? []) {
    if (!PACOTES.some((p) => p.id === pacote)) {
      throw new Recusa(
        `Pacote de capacidade desconhecido: «${pacote}». Os pacotes são: ${PACOTES.map((p) => `${p.id} (${p.rotulo})`).join(", ")}.`,
      );
    }
    selecao = ligarPacote(selecao, catalogo, pacote as ToolBundle);
    const criticas = capacidadesCriticasDoPacote(catalogo, pacote as ToolBundle).filter(
      (c) => !(pedido.capacidades ?? []).includes(c),
    );
    if (criticas.length > 0) {
      avisos.push(
        `O pacote «${pacote}» não liga sozinho as capacidades de efeito que não dá para desfazer: ${criticas.join(", ")}. ` +
          "Para ligá-las, cite cada uma em `capacidades`.",
      );
    }
    if (capacidadesAutomaticasDoPacote(catalogo, pacote as ToolBundle).length === 0) {
      avisos.push(`O pacote «${pacote}» não tem capacidade disponível para esta organização agora.`);
    }
  }

  const porId = new Map(oferecidas.map((c) => [c.id, c]));
  for (const id of pedido.capacidades ?? []) {
    const capacidade = porId.get(id);
    if (!capacidade) {
      throw new Recusa(
        `A capacidade «${id}» não existe ou não é oferecida a esta organização (módulo desligado, ou modo de venda). ` +
          "Use plataforma_listar_modelos com `secoes: [\"capacidades_do_agente\"]` para ver os ids.",
      );
    }
    if (!capacidade.marcavel) {
      throw new Recusa(
        `A capacidade «${id}» não se liga: ${capacidade.motivo_nao_marcavel ?? "o motor já a executa sozinho"}. Tire-a de \`capacidades\`.`,
      );
    }
    if (!selecao.includes(id)) selecao.push(id);
  }
  // Ordem do catálogo, não a do pedido: a lista vira diff de versão do agente.
  selecao = oferecidas.map((c) => c.id).filter((id) => selecao.includes(id));

  if (selecao.length > TETO_TOOLS_POR_AGENTE) {
    throw new Recusa(
      `A soma dos pacotes e capacidades dá ${selecao.length} capacidades, e um agente aceita até ${TETO_TOOLS_POR_AGENTE}. ` +
        "Com capacidade demais o modelo erra a escolha. Tire um pacote, ou troque um pacote por capacidades avulsas.",
    );
  }
  return { tool_ids: selecao, avisos };
}

/** O estado de cada pacote numa lista de capacidades, para a leitura do agente. */
export function pacotesLigados(oferecidas: readonly CapacidadeServida[], toolIds: readonly string[]): string[] {
  const catalogo = selecionaveis(oferecidas);
  return PACOTES.filter((p) => {
    const automaticas = capacidadesAutomaticasDoPacote(catalogo, p.id);
    return automaticas.length > 0 && automaticas.every((id) => toolIds.includes(id));
  }).map((p) => p.id);
}
