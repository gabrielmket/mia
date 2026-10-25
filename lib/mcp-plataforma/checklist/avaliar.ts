/**
 * Avaliar as áreas do checklist: UMA definição para quem lê o checklist.
 *
 * `plataforma_ver_implantacao` (o MCP, com o cliente de serviço) e o "o que
 * falta" do cliente (o assistente e o Início, FORK MIA .91, com o cliente da
 * SESSÃO) passam por aqui. A régua de cada área é a mesma; o que muda é quem lê
 * o banco, e a RLS de quem pergunta.
 */
import type { OrganizacaoDaImplantacao } from "@/lib/implantacao/base";

import type { ContextoDaFerramenta } from "../tipos";
import { AREAS_DO_CHECKLIST } from "./areas";
import type { AreaDoChecklist, PelaTela, Pendencia, ResultadoDaArea } from "./tipos";

export type SituacaoDaArea = "pronto" | "falta" | "com_o_humano" | "nao_medida";

export interface AreaAvaliada extends ResultadoDaArea {
  area: string;
  titulo: string;
  situacao: SituacaoDaArea;
  erro?: string;
}

export async function avaliarAreas(
  ctx: ContextoDaFerramenta,
  org: OrganizacaoDaImplantacao,
  areas: readonly AreaDoChecklist[] = AREAS_DO_CHECKLIST,
): Promise<AreaAvaliada[]> {
  return Promise.all(
    areas.map(async (area): Promise<AreaAvaliada> => {
      try {
        const r = await area.avaliar(ctx, org);
        const pendenteNaTela = r.so_pela_tela.some((p) => p.situacao === "pendente");
        const situacao: SituacaoDaArea = r.falta.length > 0 ? "falta" : pendenteNaTela ? "com_o_humano" : "pronto";
        return { area: area.chave, titulo: area.titulo, situacao, ...r };
      } catch (err) {
        // Uma área que não deu para medir não derruba as outras, e não se
        // passa por "pronta": diz que não foi medida, e por quê.
        return {
          area: area.chave,
          titulo: area.titulo,
          situacao: "nao_medida",
          pronto: [] as string[],
          falta: [] as Pendencia[],
          so_pela_tela: [] as PelaTela[],
          erro: err instanceof Error ? err.message : "erro desconhecido",
        };
      }
    }),
  );
}

/** As áreas pela chave, na ordem de `AREAS_DO_CHECKLIST`. */
export function areasPelaChave(chaves: readonly string[]): AreaDoChecklist[] {
  return AREAS_DO_CHECKLIST.filter((a) => chaves.includes(a.chave));
}
