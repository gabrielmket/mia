/**
 * FORK MIA (.84) — COPIAR um fluxo de follow-up para um cliente: de outra
 * empresa da plataforma, ou de um arquivo `.fluxo.json`.
 *
 * ── O caminho da tela que isto espelha (upstream 1.86, #3056) ─────────────
 *
 *   exportar  `GET /api/v1/ai/followup-flows/[id]/export`: o rascunho (ou a
 *             versão publicada, sem rascunho) conferido por `flowGraphSchema`,
 *             os NOMES do que o grafo cita (`nomesDaOrigem`) e o arquivo
 *             (`montarArquivoDeFluxo`);
 *   importar  `POST /api/v1/ai/followup-flows/import`: `arquivoDeFluxoSchema`,
 *             o que a empresa de destino tem (`contextoDaConta`), o casamento
 *             por id e por nome (`reconciliarComAConta`), o fluxo nasce
 *             RASCUNHO e a auditoria `followup_flow.imported`.
 *
 * As regras são TODAS do upstream (`lib/followup/portabilidade.ts`): aqui só se
 * junta a exportação de uma empresa com a importação na outra, sem o arquivo
 * passar pela mão de ninguém. É o caso da implantação: copiar o fluxo que já
 * funciona na Empresa Modelo (ou num cliente parecido) para o cliente novo.
 *
 * ── O que esta operação NUNCA faz ─────────────────────────────────────────
 *
 * Não publica, não arma em agente e não manda mensagem: o fluxo nasce rascunho,
 * como na tela, e passa pela MESMA conferência de publicação
 * (`plataforma_publicar_followup`). Não copia roteiro de atendimento (outra
 * superfície, sem ferramenta de montagem). Não sobrescreve fluxo: a chave é o
 * NOME no destino, e um fluxo com esse nome já existente responde `ja_estava`.
 */
import { audit } from "@/lib/audit";
import { triggerConfigSchema } from "@/lib/followup/api-schemas";
import { flowGraphSchema } from "@/lib/followup/graph-schema";
import { MAX_FOLLOWUP_FLOW_NAME } from "@/lib/followup/nome-da-copia";
import {
  arquivoDeFluxoSchema,
  idsCitados,
  montarArquivoDeFluxo,
  problemasDoArquivo,
  reconciliarComAConta,
  TAMANHO_MAXIMO_DO_ARQUIVO,
  type Pendencia,
} from "@/lib/followup/portabilidade";
import { contextoDaConta, nomesDaOrigem } from "@/lib/followup/portabilidade-db";
import { rascunhoDoFluxo } from "@/lib/followup/rascunho";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

import { acharPorNomeOuId, chaveDoNome, organizacaoDaImplantacao, type Desfecho, type Implantacao } from "./base";
import { lerFluxos } from "./followup";

export interface PedidoDeCopiaDeFollowup {
  /** De outra empresa da plataforma: a empresa e o fluxo (nome ou id). */
  de_outra_empresa?: { organization_id: string; fluxo: string };
  /** Ou o conteúdo de um `.fluxo.json` que a tela exportou. */
  arquivo?: unknown;
  /** O nome do fluxo no cliente. Sem ele, o nome do fluxo de origem. É a chave. */
  nome?: string;
}

export interface FollowupCopiado {
  fluxo: { id: string; nome: string; situacao: string; desfecho: Desfecho };
  pendencias: Array<Pendencia & { o_que_fazer: string }>;
  avisos: string[];
}

/** A frase de cada pendência, a mesma da tela (`ImportFlowDialog.tsx`), para quem implanta. */
function oQueFazer(p: Pendencia): string {
  switch (p.codigo) {
    case "etapa_remapeada":
      return "a etapa foi ligada à etapa de mesmo nome deste cliente.";
    case "etapa_nao_encontrada":
      return "a etapa não existe neste cliente. Escolha a etapa (no editor, ou criando a etapa com plataforma_garantir_funil e copiando de novo) antes de publicar.";
    case "modelo_remapeado":
      return "o modelo de mensagem foi ligado ao modelo de mesmo nome deste cliente.";
    case "modelo_nao_encontrado":
      return "o modelo de mensagem não existe neste cliente. Crie-o com plataforma_garantir_respostas_prontas (ou escolha outro no editor) antes de publicar: a publicação recusa.";
    case "modelo_reserva_removido":
      return "o modelo de reserva não existe neste cliente e foi retirado.";
    case "responsavel_trocado":
      return "a pessoa da tarefa não é deste cliente; a tarefa vai para o dono do negócio.";
    case "proximo_fluxo_remapeado":
      return "o próximo fluxo foi ligado ao fluxo de mesmo nome deste cliente.";
    case "proximo_fluxo_removido":
      return "o próximo fluxo não existe neste cliente; ao terminar, nada é iniciado.";
    case "gatilho_trocado_para_manual":
      return "o gatilho apontava para algo que não existe neste cliente e voltou para Manual. Escolha o gatilho na tela (IA › Follow-ups) antes de publicar.";
    default:
      return String(p.codigo);
  }
}

/** O arquivo do fluxo de origem, pelo caminho da exportação da tela. */
async function exportarDeOutraEmpresa(
  c: Implantacao,
  origem: NonNullable<PedidoDeCopiaDeFollowup["de_outra_empresa"]>,
): Promise<unknown> {
  const empresa = await organizacaoDaImplantacao(c.admin, origem.organization_id);
  const fluxos = await lerFluxos(c.admin, empresa.id);
  const fluxo = acharPorNomeOuId(fluxos, origem.fluxo, (f) => f.name, {
    singular: "o fluxo de follow-up de origem",
    comoListar: "Os fluxos de cada empresa estão em plataforma_ver_configuracao (seção followups) daquela empresa.",
  });
  const bruto = await rascunhoDoFluxo(c.admin, fluxo, empresa.id);
  const grafo = flowGraphSchema.safeParse(bruto);
  if (!grafo.success) {
    throw new Recusa(
      `O fluxo «${fluxo.name}» da empresa de origem ainda não tem caixas suficientes para copiar. Monte o fluxo no editor e salve antes.`,
    );
  }
  const gatilho = triggerConfigSchema.safeParse(fluxo.trigger_config ?? { kind: "manual" });
  const nomes = await nomesDaOrigem(c.admin, empresa.id, idsCitados(grafo.data, gatilho.success ? gatilho.data : null));
  return montarArquivoDeFluxo(
    {
      name: fluxo.name,
      surface: fluxo.surface ?? null,
      handoff_policy: fluxo.handoff_policy ?? "pause",
      trigger_config: fluxo.trigger_config,
      graph: grafo.data,
    },
    nomes,
    new Date(),
  );
}

export async function copiarFollowup(c: Implantacao, pedido: PedidoDeCopiaDeFollowup): Promise<FollowupCopiado> {
  const temOrigem = pedido.de_outra_empresa !== undefined;
  const temArquivo = pedido.arquivo !== undefined;
  if (temOrigem === temArquivo) {
    throw new Recusa(
      "Diga de onde vem o fluxo: `de_outra_empresa` (a empresa e o fluxo) OU `arquivo` (o conteúdo de um .fluxo.json exportado pela tela), um dos dois.",
    );
  }

  const bruto = temOrigem ? await exportarDeOutraEmpresa(c, pedido.de_outra_empresa!) : pedido.arquivo;
  if (JSON.stringify(bruto ?? null).length > TAMANHO_MAXIMO_DO_ARQUIVO) {
    throw new Recusa("O arquivo é grande demais para um fluxo (máximo de 512 KB).");
  }
  const lido = arquivoDeFluxoSchema.safeParse(bruto);
  if (!lido.success) {
    throw new Recusa(
      "O arquivo não é um fluxo válido. Confira os itens abaixo e tente de novo:\n" +
        problemasDoArquivo(lido.error)
          .map((p) => `- ${p}`)
          .join("\n"),
    );
  }
  const arquivo = lido.data;
  if ((arquivo.flow.surface ?? "followup") === "atendimento") {
    throw new Recusa(
      "Este é um fluxo de ATENDIMENTO (roteiro), não de follow-up. Roteiro de atendimento é outra superfície, sem ferramenta de montagem: importe pela tela (IA › Fluxos de atendimento).",
    );
  }

  const nome = (pedido.nome ?? arquivo.flow.name).trim();
  if (nome.length === 0 || nome.length > MAX_FOLLOWUP_FLOW_NAME) {
    throw new Recusa(`O nome do fluxo tem de 1 a ${MAX_FOLLOWUP_FLOW_NAME} caracteres.`);
  }

  // GARANTIR: o nome no destino é a chave. Um fluxo com esse nome (de qualquer
  // superfície: o nome é único na empresa) não é sobrescrito.
  const conta = await contextoDaConta(c.admin, c.admin, c.orgId);
  const existente = [...conta.flows.entries()].find(([, n]) => chaveDoNome(n) === chaveDoNome(nome));
  if (existente) {
    return {
      fluxo: { id: existente[0], nome: existente[1], situacao: "existente", desfecho: "ja_estava" },
      pendencias: [],
      avisos: [
        `O cliente já tem um fluxo chamado «${existente[1]}»: nada foi copiado. Para ter outra cópia, chame de novo com outro \`nome\`; para mudar o que existe, use plataforma_garantir_followup.`,
      ],
    };
  }

  const resultado = reconciliarComAConta(arquivo, conta);
  const { data: criado, error } = await c.admin
    .from("followup_flow_pointers")
    .insert({
      organization_id: c.orgId,
      name: nome,
      status: "draft",
      draft_graph: resultado.graph,
      trigger_config: resultado.trigger_config,
      handoff_policy: arquivo.flow.handoff_policy,
      surface: "followup",
    })
    .select("id, name, status")
    .single();
  if (error || !criado) {
    if (error?.code === "23505") {
      throw new Recusa(`Já existe um fluxo com o nome «${nome}» neste cliente. Chame de novo com outro \`nome\`.`);
    }
    throw new Error(`não consegui criar o fluxo: ${error?.message ?? "sem linha"}`);
  }
  const linha = criado as { id: string; name: string; status: string };

  void audit({
    action: "followup_flow.imported",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "followup_flow_pointer",
    resourceId: linha.id,
    requestId: c.requestId,
    // Contagens e códigos, nunca o texto das mensagens do fluxo (como a rota).
    metadata: {
      name: nome,
      surface: "followup",
      nodes: resultado.graph.nodes.length,
      edges: resultado.graph.edges.length,
      trigger_kind: resultado.trigger_config.kind,
      pendencias: resultado.pendencias.map((p) => p.codigo),
      origem: temOrigem ? "outra_empresa" : "arquivo",
      via: "mcp_plataforma",
    },
  });

  const avisos = [
    "O fluxo nasceu RASCUNHO: não manda mensagem para ninguém. Para rodar, publique com plataforma_publicar_followup e, se o gatilho é automático, arme num agente publicado (plataforma_garantir_agente com `followups`).",
  ];
  const bloqueiam = resultado.pendencias.filter((p) => p.bloqueia);
  if (bloqueiam.length > 0) {
    avisos.push(
      `${bloqueiam.length === 1 ? "Uma pendência impede" : `${bloqueiam.length} pendências impedem`} a publicação até ser resolvida: veja \`pendencias\` (as que têm \`bloqueia: true\`).`,
    );
  }
  return {
    fluxo: { id: linha.id, nome: linha.name, situacao: linha.status, desfecho: "criou" },
    pendencias: resultado.pendencias.map((p) => ({ ...p, o_que_fazer: oQueFazer(p) })),
    avisos,
  };
}
