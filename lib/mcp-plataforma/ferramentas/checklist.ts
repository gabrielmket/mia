/**
 * `plataforma_ver_implantacao` — o CHECKLIST da implantação de um cliente.
 *
 * É a ferramenta que o agente implantador chama no começo (para saber por onde
 * começar) e no fim (para provar que terminou, e para dizer ao humano o que
 * ficou com ele). Ela não conhece área nenhuma: percorre a lista
 * `AREAS_DO_CHECKLIST` e junta as respostas (`avaliarAreas`).
 *
 * FORK MIA (.91): devolve também o RÓTULO DO CLIENTE, o mesmo "o que falta"
 * que a empresa nova vê no passo a passo e no Início e que o assistente da MIA
 * lê (`ver_o_que_falta`): preenchido, posso completar, preciso confirmar e não
 * se aplica, com a dependência de cada item, e a evolução dos retratos.
 */
import { lerEvolucao } from "@/lib/assistente/retratos";
import { followupsQueSaemComOAgente } from "@/lib/assistente/leituras/o-que-falta";
import { oQueFaltaAparece } from "@/lib/onboarding/o-que-falta-aparece";
// FORK MIA (.93): a trilha que ensina cada item "preciso confirmar".
import { TRILHA_DO_ITEM_DO_QUE_FALTA, trilhaPorId } from "@/lib/assistente/trilhas/catalogo";

import { avaliarAreas } from "../checklist/avaliar";
import { rotuloDoCliente, rotuloEmTexto } from "../checklist/rotulo-do-cliente";
import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

export const FERRAMENTAS_DO_CHECKLIST: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_implantacao",
    description:
      "O CHECKLIST da implantação de um cliente. Devolve, área por área (empresa, primeiros passos, módulos, números de WhatsApp, funis, catálogo, " +
      "etiquetas, memória, conhecimento, agentes, follow-ups, automações, agenda, equipe, distribuição, mensagens, conversões, plano e cobrança), " +
      "o que está PRONTO, o que FALTA (com a ferramenta que resolve) e o que SÓ UMA PESSOA faz pela tela (com o caminho da tela e o porquê). " +
      "QUANDO USAR: no começo de toda implantação, para saber por onde começar, e no fim, para conferir. " +
      "Chame de novo depois de cada bloco de trabalho: é barato e não escreve nada. " +
      "COMO LER: `proximos_passos` é a fila do que VOCÊ ainda pode fazer; `com_o_humano` é o que você deve pedir à pessoa, com a tela certa. " +
      "`resumo.pode_atender` só fica verdadeiro com um agente publicado num número conectado. " +
      "`rotulo_do_cliente` é o \"o que falta\" que a empresa nova vê no Início e o assistente dela lê (preenchido, posso completar, preciso confirmar, " +
      "não se aplica), com `aparece_no_inicio` (só para empresa que passou pelo passo a passo desta versão, até zerar) e a evolução dos retratos; " +
      "o número oficial que espera a Time ligar aparece ali com quem faz: Time Company. " +
      "Desde a .93, `rotulo_do_cliente.trilhas_que_ensinam` diz a trilha do Me mostra como que ensina cada item preciso confirmar (o número, o agente, a equipe). " +
      "O QUE NÃO FAZ: não grava nada (nem retrato), e não mostra o conteúdo (prompt, produtos, textos). Para o conteúdo, use plataforma_ver_funis, " +
      "plataforma_ver_agentes, plataforma_ver_catalogo e plataforma_ver_configuracao.",
    inputSchema: {
      organization_id: ORGANIZACAO,
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO },
    operacao: null,
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);

      const areas = await avaliarAreas(ctx, org);

      const agentes = areas.find((a) => a.area === "agentes");
      const noAr = ((agentes && "dados" in agentes ? (agentes.dados as { agentes?: Array<{ situacao: string }> } | undefined)?.agentes : undefined) ?? []).filter(
        (a) => a.situacao === "no ar",
      ).length;
      const canais = areas.find((a) => a.area === "canais");
      const numerosConectados = (
        (canais && "dados" in canais ? (canais.dados as { numeros?: Array<{ conectado: boolean }> } | undefined)?.numeros : undefined) ?? []
      ).filter((n) => n.conectado).length;

      // FORK MIA (.91): o rótulo do cliente, na régua de quem administra (a da Time).
      const [saemJunto, evolucao, estado] = await Promise.all([
        followupsQueSaemComOAgente(ctx.admin, org.id),
        lerEvolucao(ctx.admin, org.id).catch(() => null),
        ctx.admin.from("organizations").select("onboarding_state").eq("id", org.id).maybeSingle(),
      ]);
      const rotulo = rotuloDoCliente(areas, { papel: "admin", followupsQueSaemComOAgente: saemJunto });
      const criterio = oQueFaltaAparece({
        onboardingState: (estado.data as { onboarding_state?: unknown } | null)?.onboarding_state ?? null,
        onboardedAt: org.onboarded_at,
        papel: "admin",
        zerou: evolucao?.zerou ?? false,
        demonstracao: org.demonstracao,
      });

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
        rotulo_do_cliente: {
          aparece_no_inicio: criterio.aparece,
          por_que: criterio.motivo,
          ...rotuloEmTexto(rotulo),
          // FORK MIA (.93): o "Me mostra como" de cada item que só uma pessoa faz.
          trilhas_que_ensinam: rotulo.itens
            .filter((i) => i.coluna === "preciso_confirmar" && TRILHA_DO_ITEM_DO_QUE_FALTA[i.chave])
            .map((i) => {
              const t = trilhaPorId(TRILHA_DO_ITEM_DO_QUE_FALTA[i.chave]!)!;
              return { item: i.chave, trilha: t.id, titulo: t.titulo, passos: t.passos.length };
            }),
          evolucao: evolucao
            ? { ao_entrar: evolucao.ao_entrar, ao_entrar_em: evolucao.ao_entrar_em, ultimo_retrato: evolucao.ultimo, zerou_em: evolucao.zerou_em }
            : null,
        },
        areas,
      };
    },
  },
];
