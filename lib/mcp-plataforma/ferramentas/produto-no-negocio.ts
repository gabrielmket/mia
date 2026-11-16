/**
 * FORK MIA (.109) · O PRODUTO NO NEGÓCIO NO MCP DE PLATAFORMA
 * (docs/fork/produto-no-negocio.md).
 *
 *   plataforma_configurar_produto_no_negocio   `implantar_configuracao`: a palavra
 *                                              de UM funil e as duas opções (pedir
 *                                              o produto no ganho, mostrar o valor
 *                                              recorrente)
 *   plataforma_garantir_palavra_do_segmento    `implantar_configuracao`: a palavra do
 *                                              segmento (clínica, loja, escritório)
 *                                              nos funis do cliente, sem atropelar
 *                                              palavra já escolhida
 *
 * As duas gravam pela MESMA porta da tela de Funis (`gravarConfiguracaoDoFunil`,
 * com `pipelineConfigPatchSchema`). A leitura é a de `plataforma_ver_funis`, que
 * passou a trazer `produto_no_negocio` em cada funil.
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { acharPorNomeOuId } from "@/lib/implantacao/base";
import { gravarConfiguracaoDoFunil } from "@/lib/pipelines/pipeline-config";
import {
  PALAVRA_DO_SEGMENTO,
  SEGMENTOS_DA_PALAVRA,
  TAMANHO_MAXIMO_DA_PALAVRA,
  funilDoProduto,
  palavraDoSegmentoNoFunil,
  type SegmentoDaPalavra,
} from "@/lib/produto-no-negocio/funil";
import { pipelineConfigPatchSchema, type PipelineConfigPatch } from "@/lib/schemas/settings";

import { recusar } from "../recusa";
import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

interface FunilLido {
  id: string;
  name: string;
  is_archived: boolean;
  vocabulary: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
}

async function lerFunis(admin: Parameters<typeof gravarConfiguracaoDoFunil>[0], orgId: string): Promise<FunilLido[]> {
  const { data, error } = await admin
    .from("crm_pipelines")
    .select("id, name, is_archived, vocabulary, settings")
    .eq("organization_id", orgId)
    .order("position", { ascending: true });
  if (error) throw new Error(`não consegui ler os funis: ${error.message}`);
  return (data ?? []) as FunilLido[];
}

/** O que o MCP devolve de cada funil (o mesmo de `produto_no_negocio` em plataforma_ver_funis). */
export function produtoNoNegocioDoFunil(f: { id: string; vocabulary: unknown; settings: unknown }) {
  const p = funilDoProduto(f);
  return {
    palavra: p.palavra,
    palavra_vale: p.palavra ?? "Produto ou serviço (o padrão do sistema)",
    pedir_no_ganho: p.pedir_no_ganho,
    mostrar_valor_recorrente: p.mostrar_valor_recorrente,
  };
}

async function gravar(
  ctx: Parameters<FerramentaDePlataforma["handler"]>[0],
  orgId: string,
  pipelineId: string,
  patch: PipelineConfigPatch,
): Promise<boolean> {
  const validado = pipelineConfigPatchSchema.safeParse(patch);
  if (!validado.success) {
    recusar(`Pedido inválido: ${validado.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}.`);
  }
  const r = await gravarConfiguracaoDoFunil(ctx.admin, { organizationId: orgId, pipelineId, patch: validado.data });
  if (!r.ok) recusar(`Não consegui gravar o funil: ${r.error}.`);
  return r.mudou;
}

export const FERRAMENTAS_DO_PRODUTO_NO_NEGOCIO: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_configurar_produto_no_negocio",
    description:
      "Configura o PRODUTO NO NEGÓCIO de UM funil: a palavra com que o funil chama o que o negócio vende e as duas opções. " +
      "Cada negócio tem uma lista de itens escolhidos SÓ do catálogo de Produtos (plataforma_garantir_produtos), com quantidade e desconto; o preço entra " +
      "congelado no dia em que o item é adicionado, e o valor do negócio passa a ser a soma (a não ser que alguém digite o valor à mão). " +
      "(1) `palavra`: \"Tratamento\", \"Produto\", \"Serviço\"... aparece no bloco do negócio, na janela de ganho, no cartão e no relatório; \"\" volta ao padrão do sistema, " +
      "\"Produto ou serviço\". (2) `pedir_no_ganho`: true faz Marcar como ganho (o botão e o arrasto até a etapa de ganho) só confirmar com pelo menos um item. " +
      "(3) `mostrar_valor_recorrente`: false esconde Valor recorrente, Duração e Tipo de receita de Editar negócio, Novo negócio e do cartão deste funil, e o " +
      "funil passa a contar como avulso nas metas (o que já estava gravado fica). Só o que vier no pedido muda; chamar de novo com os mesmos valores responde " +
      "`ja_estava`. Nos funis que nunca foram configurados vale o de hoje: pedir desligado e valor recorrente ligado. " +
      "ATENÇÃO: ligar `pedir_no_ganho` faz a equipe deixar de conseguir fechar como ganho o negócio sem item (o botão e o arrasto recusam); confira antes que " +
      "o catálogo tem os produtos do cliente. O QUE NÃO FAZ: não cria produto (plataforma_garantir_produtos), não mexe nos itens de negócio nenhum e não " +
      "apaga o valor recorrente já gravado. Para preencher a palavra pelo segmento em todos os funis de uma vez: plataforma_garantir_palavra_do_segmento.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      funil: z.string().trim().min(1).max(120).describe("Nome ou id do funil (de plataforma_ver_funis)."),
      palavra: z
        .string()
        .trim()
        .max(TAMANHO_MAXIMO_DA_PALAVRA)
        .optional()
        .describe('No singular, com maiúscula: "Tratamento", "Produto", "Serviço". "" volta ao padrão do sistema.'),
      pedir_no_ganho: z.boolean().optional().describe("true: Marcar como ganho só confirma com pelo menos um item do negócio."),
      mostrar_valor_recorrente: z
        .boolean()
        .optional()
        .describe("false: some o valor recorrente, a duração e o Tipo de receita deste funil, e ele conta como avulso nas metas."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, funil: "Comercial", palavra: "Tratamento", pedir_no_ganho: true, mostrar_valor_recorrente: false },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      if (args.palavra === undefined && args.pedir_no_ganho === undefined && args.mostrar_valor_recorrente === undefined) {
        recusar("Informe ao menos um campo: palavra, pedir_no_ganho ou mostrar_valor_recorrente. Para só ver, use plataforma_ver_funis.");
      }
      const funis = await lerFunis(c.admin, c.orgId);
      const funil = acharPorNomeOuId(
        funis.filter((f) => !f.is_archived),
        String(args.funil),
        (f) => f.name,
        { singular: "o funil", comoListar: "Os funis estão em plataforma_ver_funis." },
      );
      const antes = produtoNoNegocioDoFunil(funil);
      const patch: PipelineConfigPatch = {
        ...(typeof args.palavra === "string" ? { vocabulary: { produto: args.palavra } } : {}),
        ...(typeof args.pedir_no_ganho === "boolean" ? { pedir_produto_no_ganho: args.pedir_no_ganho } : {}),
        ...(typeof args.mostrar_valor_recorrente === "boolean" ? { mostrar_valor_recorrente: args.mostrar_valor_recorrente } : {}),
      };
      const mudou = await gravar(ctx, c.orgId, funil.id, patch);
      const [depoisLido] = (await lerFunis(c.admin, c.orgId)).filter((f) => f.id === funil.id);
      const depois = depoisLido ? produtoNoNegocioDoFunil(depoisLido) : antes;
      if (mudou) {
        await audit({
          action: "funil.produto_no_negocio_configurado",
          actorUserId: ctx.autorUserId,
          organizationId: c.orgId,
          resourceType: "crm_pipeline",
          resourceId: funil.id,
          requestId: ctx.requestId,
          bypassedRls: true,
          metadata: { origem: "mcp_de_plataforma", antes, depois },
        });
      }
      return { empresa: org.display_name, funil: { id: funil.id, nome: funil.name }, antes, depois, ja_estava: !mudou };
    },
  },

  {
    name: "plataforma_garantir_palavra_do_segmento",
    description:
      "Na IMPLANTAÇÃO, preenche a palavra do produto no negócio pelo SEGMENTO do cliente, nos funis dele: clinica = \"Tratamento\", loja = \"Produto\", " +
      "escritorio = \"Serviço\". É a palavra do bloco de itens do negócio, da janela de ganho, do cartão e do relatório (o padrão do sistema é \"Produto ou serviço\"). " +
      "Na clínica, o funil cujo negócio já se chama \"Tratamento\" passa a chamá-lo \"Plano de tratamento\", para a mesma tela não dizer \"Tratamento\" duas vezes. " +
      "GARANTIR não atropela: funil que já tem OUTRA palavra fica com ela (vem em `mantidos`), a não ser que `sobrescrever` seja true. Sem `funis`, vale para " +
      "todos os funis ativos do cliente. Chamar de novo responde `ja_estava` em cada funil. O QUE NÃO FAZ: as duas opções do funil (pedir no ganho, " +
      "valor recorrente) não mudam aqui (plataforma_configurar_produto_no_negocio), e nenhum produto é criado no catálogo.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      segmento: z.enum(SEGMENTOS_DA_PALAVRA).describe("clinica (Tratamento), loja (Produto) ou escritorio (Serviço)."),
      funis: z
        .array(z.string().trim().min(1).max(120))
        .max(50)
        .optional()
        .describe("Nome ou id de cada funil. Sem isto, todos os funis ativos."),
      sobrescrever: z.boolean().optional().describe("true troca também a palavra que outra pessoa já escolheu. Padrão: não."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, segmento: "clinica" },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      const segmento = args.segmento as SegmentoDaPalavra;
      const sobrescrever = args.sobrescrever === true;
      const ativos = (await lerFunis(c.admin, c.orgId)).filter((f) => !f.is_archived);
      const alvos = Array.isArray(args.funis)
        ? (args.funis as string[]).map((ref) =>
            acharPorNomeOuId(ativos, ref, (f) => f.name, { singular: "o funil", comoListar: "Os funis estão em plataforma_ver_funis." }),
          )
        : ativos;
      if (alvos.length === 0) recusar("Este cliente ainda não tem funil ativo. Crie com plataforma_garantir_funil.");
      const resultado: Array<{ id: string; nome: string; desfecho: "atualizou" | "ja_estava" | "mantido"; vocabulario: Record<string, string> }> = [];
      for (const f of alvos) {
        const mudanca = palavraDoSegmentoNoFunil(f.vocabulary, segmento, sobrescrever);
        if (Object.keys(mudanca.vocabulario).length === 0) {
          resultado.push({ id: f.id, nome: f.name, desfecho: mudanca.mantida ? "mantido" : "ja_estava", vocabulario: {} });
          continue;
        }
        const mudou = await gravar(ctx, c.orgId, f.id, { vocabulary: mudanca.vocabulario });
        resultado.push({ id: f.id, nome: f.name, desfecho: mudou ? "atualizou" : "ja_estava", vocabulario: mudanca.vocabulario });
      }
      const atualizados = resultado.filter((r) => r.desfecho === "atualizou");
      if (atualizados.length > 0) {
        await audit({
          action: "funil.palavra_do_segmento_garantida",
          actorUserId: ctx.autorUserId,
          organizationId: c.orgId,
          resourceType: "crm_pipeline",
          requestId: ctx.requestId,
          bypassedRls: true,
          metadata: { origem: "mcp_de_plataforma", segmento, funis: atualizados.map((r) => ({ id: r.id, vocabulario: r.vocabulario })) },
        });
      }
      return {
        empresa: org.display_name,
        segmento,
        palavra: PALAVRA_DO_SEGMENTO[segmento].produto,
        funis: resultado,
        mantidos: resultado.filter((r) => r.desfecho === "mantido").map((r) => r.nome),
        ja_estava: atualizados.length === 0,
      };
    },
  },
];
