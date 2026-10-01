/**
 * `plataforma_ver_implantacao` — o CHECKLIST da implantação de um cliente.
 *
 * É a ferramenta que o agente implantador chama no começo (para saber por onde
 * começar) e no fim (para provar que terminou, e para dizer ao humano o que
 * ficou com ele). Ela não conhece área nenhuma: percorre a lista
 * `AREAS_DO_CHECKLIST` e junta as respostas.
 */
import { AREAS_DO_CHECKLIST } from "../checklist/areas";
import type { PelaTela, Pendencia } from "../checklist/tipos";
import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

type SituacaoDaArea = "pronto" | "falta" | "com_o_humano" | "nao_medida";

export const FERRAMENTAS_DO_CHECKLIST: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_implantacao",
    description:
      "O CHECKLIST da implantação de um cliente. Devolve, área por área (empresa, módulos, números de WhatsApp, funis, catálogo, " +
      "etiquetas, memória, conhecimento, agentes, follow-ups, automações, agenda, equipe, distribuição, mensagens, conversões), " +
      "o que está PRONTO, o que FALTA (com a ferramenta que resolve) e o que SÓ UMA PESSOA faz pela tela (com o caminho da tela e o porquê). " +
      "QUANDO USAR: no começo de toda implantação, para saber por onde começar, e no fim, para conferir. " +
      "Chame de novo depois de cada bloco de trabalho: é barato e não escreve nada. " +
      "COMO LER: `proximos_passos` é a fila do que VOCÊ ainda pode fazer; `com_o_humano` é o que você deve pedir à pessoa, com a tela certa. " +
      "`resumo.pode_atender` só fica verdadeiro com um agente publicado num número conectado. " +
      "O QUE NÃO FAZ: não grava nada, e não mostra o conteúdo (prompt, produtos, textos). Para o conteúdo, use plataforma_ver_funis, " +
      "plataforma_ver_agentes, plataforma_ver_catalogo e plataforma_ver_configuracao.",
    inputSchema: {
      organization_id: ORGANIZACAO,
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO },
    operacao: null,
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);

      const areas = await Promise.all(
        AREAS_DO_CHECKLIST.map(async (area) => {
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
              situacao: "nao_medida" as SituacaoDaArea,
              pronto: [] as string[],
              falta: [] as Pendencia[],
              so_pela_tela: [] as PelaTela[],
              erro: err instanceof Error ? err.message : "erro desconhecido",
            };
          }
        }),
      );

      const agentes = areas.find((a) => a.area === "agentes");
      const noAr = ((agentes && "dados" in agentes ? (agentes.dados as { agentes?: Array<{ situacao: string }> } | undefined)?.agentes : undefined) ?? []).filter(
        (a) => a.situacao === "no ar",
      ).length;
      const canais = areas.find((a) => a.area === "canais");
      const numerosConectados = (
        (canais && "dados" in canais ? (canais.dados as { numeros?: Array<{ conectado: boolean }> } | undefined)?.numeros : undefined) ?? []
      ).filter((n) => n.conectado).length;

      return {
        organizacao: { id: org.id, nome: org.display_name, demonstracao: org.demonstracao },
        resumo: {
          pode_atender: noAr > 0 && numerosConectados > 0,
          agentes_no_ar: noAr,
          numeros_conectados: numerosConectados,
          areas_prontas: areas.filter((a) => a.situacao === "pronto").length,
          areas_com_pendencia_sua: areas.filter((a) => a.situacao === "falta").length,
          areas_com_o_humano: areas.filter((a) => a.situacao === "com_o_humano").length,
          areas_nao_medidas: areas.filter((a) => a.situacao === "nao_medida").map((a) => a.area),
        },
        proximos_passos: areas.flatMap((a) => a.falta.map((f) => ({ area: a.area, ...f }))),
        com_o_humano: areas.flatMap((a) =>
          a.so_pela_tela.filter((p) => p.situacao === "pendente").map((p) => ({ area: a.area, ...p })),
        ),
        areas,
      };
    },
  },
];
