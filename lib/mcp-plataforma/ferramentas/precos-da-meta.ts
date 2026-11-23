/**
 * FORK MIA (MIA-99) · O PREÇO QUE A META COBRA POR MENSAGEM, no MCP de
 * plataforma (docs/fork/consumo-de-ia.md, seção 9). Duas:
 *
 *   plataforma_ver_precos_da_meta      o preço atual de cada categoria e o histórico das vigências
 *   plataforma_definir_precos_da_meta  `definir_custo_da_meta`: muda o preço, a partir de agora
 *
 * É a mesma tabela da tela `/admin/custo-da-meta` (`platform_precos_meta`), e a
 * escrita é a mesma do PUT dela: grava o preço atual, e o gatilho da migration
 * 9165 fecha a vigência anterior e abre a nova. Por isso um mês fechado não
 * muda: as mensagens dele continuam ao preço que valia no instante delas.
 *
 * Preço da PLATAFORMA, não de uma empresa: não recebe `organization_id`, e a
 * trava da demonstração não tem o que barrar (não envia nada a ninguém).
 */
import { z } from "zod";

import { CATEGORIAS_CONHECIDAS, instanteDe, type VigenciaDoPreco } from "@/lib/channels/meta/custo-da-conversa";
import { lerVigenciasDoPreco } from "@/lib/channels/meta/custo-do-periodo";

import { recusar } from "../recusa";
import type { FerramentaDePlataforma } from "../tipos";

export const OPERACAO_DEFINIR_CUSTO_DA_META = "definir_custo_da_meta";

/** O teto do PUT da tela (R$ 1.000,00 por mensagem): acima disso é dedo escorregando. */
const CENTAVOS_MAXIMOS = 100_000;

interface PrecoAtual {
  categoria: string;
  centavos_brl: number;
  atualizado_em: string | null;
}

async function lerPrecosAtuais(admin: Parameters<FerramentaDePlataforma["handler"]>[0]["admin"]): Promise<PrecoAtual[]> {
  const { data, error } = await admin
    .from("platform_precos_meta")
    .select("categoria, centavos_brl, atualizado_em")
    .order("categoria", { ascending: true });
  if (error) throw new Error(`não consegui ler os preços da Meta: ${error.message}`);
  return (data ?? []) as PrecoAtual[];
}

/** A ponta da vigência como sai para quem lê: `null` = sem ponta (desde sempre, ou ainda vale). */
function ponta(valor: VigenciaDoPreco["vigente_desde"] | null): string | null {
  if (valor === null) return null;
  const ms = instanteDe(valor);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export const FERRAMENTAS_DE_PRECOS_DA_META: FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_precos_da_meta",
    description:
      "O preço que a META cobra por mensagem, por categoria (marketing, utility, authentication, service), em CENTAVOS DE REAL: o preço de CUSTO da plataforma, " +
      "o mesmo da tela /admin/custo-da-meta. `atuais` é o preço de hoje de cada categoria; `sem_preco` são as categorias conhecidas sem preço (as mensagens delas " +
      "aparecem como contagem, nunca como zero). `historico` é cada vigência, da mais antiga para a mais nova: `vigente_desde` null = desde sempre (o primeiro preço " +
      "de uma categoria vale para o passado também), `vigente_ate` null = é o preço atual. Uma mensagem custa o preço cuja vigência contém o instante dela, por isso " +
      "o custo de um mês fechado não muda quando o preço muda depois. O custo por cliente está em plataforma_ver_consumo_de_ia (`mensagens_cobradas`). Só lê.",
    inputSchema: {},
    exemplo: {},
    operacao: null,
    handler: async ({ admin }) => {
      const [atuais, historico] = await Promise.all([lerPrecosAtuais(admin), lerVigenciasDoPreco(admin)]);
      if ("erro" in historico) throw new Error(`não consegui ler o histórico de preços da Meta: ${historico.erro}`);
      const comPreco = new Set(atuais.map((p) => p.categoria));
      return {
        moeda: "BRL",
        unidade: "centavos por mensagem cobrada",
        atuais,
        sem_preco: CATEGORIAS_CONHECIDAS.filter((c) => !comPreco.has(c)),
        historico: historico.vigencias.map((v) => ({
          categoria: v.categoria,
          centavos_brl: v.centavos_brl,
          vigente_desde: ponta(v.vigente_desde),
          vigente_ate: ponta(v.vigente_ate),
        })),
      };
    },
  },
  {
    name: "plataforma_definir_precos_da_meta",
    description:
      "Muda o preço que a META cobra por mensagem, por categoria, em CENTAVOS DE REAL (ex.: 35 = R$ 0,35 por mensagem de marketing cobrada). É o preço de CUSTO " +
      "da plataforma, a mesma tabela da tela /admin/custo-da-meta, e vale para TODOS os clientes. O preço novo vale A PARTIR DE AGORA: a vigência anterior fecha neste " +
      "instante e as mensagens de antes continuam ao preço antigo, então um mês fechado não muda. Exceção: o PRIMEIRO preço de uma categoria que nunca teve preço vale " +
      "desde sempre (não há histórico para reconstruir). Categoria ausente do pedido fica como está; o mesmo preço de hoje responde `ja_estava` e não escreve. " +
      "ANTES DE: confira em plataforma_ver_precos_da_meta o preço atual e a tabela vigente da Meta para o Brasil. " +
      "O QUE NÃO FAZ: não muda o que nenhum cliente paga (isso é plataforma_definir_preco), não envia mensagem, não muda o custo de um mês que já passou e não apaga preço.",
    inputSchema: {
      precos: z
        .array(
          z.object({
            categoria: z
              .enum(CATEGORIAS_CONHECIDAS)
              .describe(`A categoria como a Meta a manda: ${CATEGORIAS_CONHECIDAS.join(", ")}.`),
            centavos_brl: z
              .number()
              .int()
              .min(0)
              .max(CENTAVOS_MAXIMOS)
              .describe("Centavos de REAL por mensagem cobrada (35 = R$ 0,35). Zero quer dizer de graça, não \"sem preço\"."),
          }),
        )
        .min(1)
        .max(CATEGORIAS_CONHECIDAS.length)
        .describe("Os preços a mudar, um por categoria. Categoria fora da lista fica como está."),
    },
    exemplo: { precos: [{ categoria: "marketing", centavos_brl: 35 }] },
    operacao: OPERACAO_DEFINIR_CUSTO_DA_META,
    handler: async ({ admin, autorUserId }, args) => {
      const pedidos = args.precos as Array<{ categoria: (typeof CATEGORIAS_CONHECIDAS)[number]; centavos_brl: number }>;
      const repetidas = pedidos.map((p) => p.categoria).filter((c, i, todas) => todas.indexOf(c) !== i);
      if (repetidas.length > 0) {
        recusar(`a categoria ${repetidas[0]} veio duas vezes: mande um preço por categoria.`);
      }

      const antes = new Map((await lerPrecosAtuais(admin)).map((p) => [p.categoria, p.centavos_brl]));
      const mudam = pedidos.filter((p) => antes.get(p.categoria) !== p.centavos_brl);

      // O primeiro preço vale desde sempre só se a categoria NUNCA teve vigência
      // (o gatilho decide igual). Uma que teve preço e foi apagada recomeça agora.
      let comHistorico = new Set<string>();
      if (pedidos.some((p) => !antes.has(p.categoria))) {
        const historico = await lerVigenciasDoPreco(admin);
        if ("erro" in historico) throw new Error(`não consegui ler o histórico de preços da Meta: ${historico.erro}`);
        comHistorico = new Set(historico.vigencias.map((v) => v.categoria));
      }

      if (mudam.length > 0) {
        const agora = new Date().toISOString();
        // Grava o preço ATUAL, como o PUT da tela. Quem fecha a vigência anterior
        // e abre a nova é o gatilho da 9165, na mesma transação deste upsert.
        const { error } = await admin.from("platform_precos_meta").upsert(
          mudam.map((p) => ({
            categoria: p.categoria,
            centavos_brl: p.centavos_brl,
            atualizado_em: agora,
            atualizado_por: autorUserId,
          })),
          { onConflict: "categoria" },
        );
        if (error) throw new Error(`não consegui gravar os preços da Meta: ${error.message}`);
      }

      // O valor volta na resposta de propósito, como em plataforma_definir_preco:
      // preço é dinheiro, e quem acabou de gravá-lo precisa ver o número que ficou.
      return {
        precos: pedidos.map((p) => {
          const anterior = antes.get(p.categoria);
          return {
            categoria: p.categoria,
            centavos_brl: p.centavos_brl,
            antes: anterior ?? null,
            // `ja_estava`: nada escrito. `mudou`: vale a partir de agora.
            // `primeiro_preco`: a categoria nunca teve preço, e este vale desde sempre.
            resultado:
              anterior === p.centavos_brl
                ? "ja_estava"
                : anterior === undefined && !comHistorico.has(p.categoria)
                  ? "primeiro_preco"
                  : "mudou",
          };
        }),
      };
    },
  },
];
