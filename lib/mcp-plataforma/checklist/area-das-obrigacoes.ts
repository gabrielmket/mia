/**
 * A ÁREA "DOCUMENTOS E OBRIGAÇÕES" DO CHECKLIST DA IMPLANTAÇÃO.
 *
 * Diz o que o cliente já tem: quantos tipos no catálogo, quantos itens e em que
 * situação (vencidos, vencendo, pedidos sem resposta, em dia), e se há regra de
 * automação ligada a algum dos cinco gatilhos de obrigação.
 *
 * ── Por que ela nunca entra em "falta" ────────────────────────────────────
 *
 * Nem todo cliente controla documento ou atividade recorrente dos próprios
 * clientes: uma loja que só vende não tem o que cadastrar aqui. Se "nenhuma
 * obrigação cadastrada" contasse como pendência, toda implantação terminaria
 * com uma falta que ninguém vai resolver, e o checklist deixaria de dizer a
 * verdade sobre o que falta para atender. O que merece atenção (item vencido,
 * itens sem regra de aviso) vai em `dados.atencao`, com a ferramenta que
 * resolve.
 */
import { lerRegras } from "@/lib/implantacao/automacoes";
import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";
import { diaNoFuso } from "@/lib/obrigacoes/datas";
import { ehGatilhoDeObrigacao } from "@/lib/obrigacoes/gatilhos";
import { contarObrigacoes } from "@/lib/obrigacoes/situacao";
import { COLUNAS_DA_OBRIGACAO, type Obrigacao } from "@/lib/obrigacoes/tipos";

import { contarNoBanco } from "../contar";
import type { AreaDoChecklist } from "./tipos";

/**
 * Quantas páginas de 1000 itens a área lê: as 5 mil que o `.limit(5000)` antigo
 * declarava e o PostgREST nunca entregou (ele corta em 1000 sem avisar). Os
 * itens vêm em linhas porque a situação de cada um é CALCULADA pelas datas; os
 * tipos são só contados, no banco.
 */
const PAGINAS_DE_ITENS = 5;

export const obrigacoes: AreaDoChecklist = {
  chave: "obrigacoes",
  titulo: "Documentos e obrigações com vencimento (opcional)",
  avaliar: async ({ admin }, org) => {
    const [itens, tiposNoCatalogo, regras] = await Promise.all([
      lerTodasAsPaginas<Obrigacao>(
        (de, ate, pedirContagem) =>
          admin
            .from("mia_obrigacoes")
            .select(COLUNAS_DA_OBRIGACAO, pedirContagem ? { count: "exact" } : undefined)
            .eq("organization_id", org.id)
            .is("arquivado_em", null)
            // Ordem única: paginar por `range` só é correto assim.
            .order("id", { ascending: true })
            .range(de, ate),
        { paginasMaximas: PAGINAS_DE_ITENS },
      ),
      contarNoBanco(
        admin
          .from("mia_obrigacoes_tipos")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", org.id)
          .is("arquivado_em", null),
        "os tipos de obrigação",
      ),
      lerRegras(admin, org.id),
    ]);
    if (itens.erro) throw new Error(itens.erro);

    const todos = itens.linhas;
    const contadores = contarObrigacoes(todos, diaNoFuso(new Date(), org.timezone));
    const deObrigacao = regras.filter((r) => ehGatilhoDeObrigacao(r.trigger_event));
    const ligadas = deObrigacao.filter((r) => r.is_active);

    const pronto: string[] = [];
    const atencao: string[] = [];
    if (tiposNoCatalogo > 0) pronto.push(`${tiposNoCatalogo} tipo(s) de obrigação no catálogo.`);
    if (todos.length > 0) {
      pronto.push(
        `${todos.length} item(ns): ${contadores.vencidos} vencido(s), ${contadores.vencendo_em_30_dias} vencendo em 30 dias, ` +
          `${contadores.pedidos_sem_resposta} pedido(s) sem resposta, ${contadores.em_dia} em dia.`,
      );
    }
    if (ligadas.length > 0) pronto.push(`${ligadas.length} regra(s) de aviso ligada(s).`);
    if (todos.length === 0 && tiposNoCatalogo === 0) pronto.push("Nenhum documento ou obrigação cadastrado (opcional).");

    if (todos.length > 0 && ligadas.length === 0) {
      atencao.push(
        "Há itens cadastrados e nenhuma regra de aviso ligada: ninguém é avisado quando um documento vence. " +
          "Monte com plataforma_garantir_automacao (gatilhos obrigacao.*, em plataforma_listar_modelos, seção automacoes) e ligue com plataforma_ligar_automacao.",
      );
    }
    if (itens.truncado) {
      atencao.push(
        `Há mais itens do que esta área lê (${itens.total ?? "mais de " + todos.length} no banco, ${todos.length} lidos): ` +
          "os contadores acima cobrem só os lidos.",
      );
    }
    if (contadores.vencidos > 0) {
      atencao.push(`${contadores.vencidos} item(ns) já vencido(s): veja em plataforma_ver_obrigacoes com \`situacao: "vencidas"\`.`);
    }

    return {
      pronto,
      falta: [],
      so_pela_tela: [],
      dados: {
        opcional: true,
        tipos_no_catalogo: tiposNoCatalogo,
        contadores,
        regras_de_aviso: { existentes: deObrigacao.length, ligadas: ligadas.length },
        atencao,
        como_montar:
          "plataforma_garantir_tipos_de_obrigacao (o catálogo do funil, com o modelo do segmento), plataforma_garantir_obrigacoes " +
          "(os itens, inclusive os que vêm de planilha) e plataforma_garantir_automacao com um gatilho obrigacao.* (os avisos). " +
          "O retrato está em plataforma_ver_obrigacoes.",
      },
    };
  },
};
