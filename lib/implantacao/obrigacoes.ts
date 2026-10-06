/**
 * FORK MIA — DOCUMENTOS E OBRIGAÇÕES pelo MCP de plataforma.
 *
 * Três operações, que as ferramentas de `lib/mcp-plataforma/ferramentas/
 * obrigacoes.ts` chamam:
 *
 *   lerObrigacoesDoCliente      o retrato: contadores por situação, os itens e o
 *                               catálogo de tipos por funil
 *   garantirTiposDeObrigacao    o catálogo de um funil, inclusive "usar o modelo
 *                               do segmento"
 *   garantirObrigacoesEmLote    os ITENS, em lote, com reexecução segura. Serve
 *                               para a implantação e para MIGRAR os vencimentos
 *                               que o cliente controlava em planilha.
 *
 * ── O caminho da tela que isto espelha ────────────────────────────────────
 *
 * O catálogo passa por `garantirTipos`/`aplicarModeloDoSegmento`
 * (`lib/obrigacoes/catalogo-servidor.ts`), o mesmo da rota `PUT
 * /api/v1/obrigacoes/tipos`. Os itens passam por `montarLinha` e por
 * `fn_mia_obrigacao_fechar_ciclo`, os mesmos de adicionar, receber e marcar
 * feita. A situação nunca é gravada: é a mesma função pura que a tela usa.
 *
 * ── A chave natural: tipo + a quem está ligado ────────────────────────────
 *
 * Um "Alvará de funcionamento" da empresa X é o MESMO item em toda chamada: a
 * segunda rodada o atualiza em vez de criar outro. A chave fica gravada em
 * `mia_obrigacoes.chave_natural`, com índice único. O item criado pela TELA
 * nasce sem chave: quando a migração encontra um do mesmo tipo com exatamente
 * os mesmos donos, ela o ADOTA (grava a chave nele) em vez de criar um gêmeo; se
 * houver mais de um igual, recusa o item e pede para a pessoa resolver na tela.
 *
 * ── Migrar não acorda automação ───────────────────────────────────────────
 *
 * Datas informadas (pedido, recebido, feita) entram como história: nenhum
 * evento "documento recebido" é emitido, e o item nasce para os avisos HOJE
 * (`sem_aviso_antes_de`): um alvará que venceu no mês passado, migrado hoje,
 * aparece vencido na lista e não dispara o aviso de vencimento atrasado.
 */
import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";
import { comoDia, diaNoFuso, type Dia } from "@/lib/obrigacoes/datas";
import {
  MODELOS_DE_TIPO,
  ROTULO_DO_SEGMENTO_DE_OBRIGACAO,
  SEGMENTOS_DE_OBRIGACAO,
  ehSegmentoDeObrigacao,
  type ModeloDeTipo,
} from "@/lib/obrigacoes/catalogo";
import {
  aplicarModeloDoSegmento,
  garantirTipos,
  lerTipos,
  type EntradaDeTipo,
} from "@/lib/obrigacoes/catalogo-servidor";
import { proximaDataDaAtividade } from "@/lib/obrigacoes/ciclo";
import { ErroDeObrigacao, montarLinha, type EntradaDeObrigacao } from "@/lib/obrigacoes/operacoes";
import {
  ROTULO_DA_SITUACAO,
  contarObrigacoes,
  emDia,
  porUrgencia,
  semResposta,
  situacao,
  urgencia,
  venceEm,
} from "@/lib/obrigacoes/situacao";
import {
  CATEGORIAS,
  COLUNAS_DA_OBRIGACAO,
  QUEM_ENTREGA,
  RECORRENCIAS,
  chaveDoNome,
  normalizarAvisos,
  type Categoria,
  type Obrigacao,
  type TipoDeObrigacao,
} from "@/lib/obrigacoes/tipos";
import {
  Coletor,
  dataDeOrigem,
  ehObjeto,
  listaDeItens,
  organizacaoDaImportacao,
  origemDaImportacao,
  pareceUuid,
  registrarImportacao,
  requestIdDe,
  texto,
} from "@/lib/mcp-plataforma/importacao/base";
import { acharContatoPorEmail, acharContatoPorTelefone } from "@/lib/mcp-plataforma/importacao/contatos";
import { EmpresasDaBase } from "@/lib/mcp-plataforma/importacao/empresas";
import type { ResultadoDoLote } from "@/lib/mcp-plataforma/importacao/tipos";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import type { ContextoDaFerramenta } from "@/lib/mcp-plataforma/tipos";
import { apenasDigitos } from "@/lib/schemas/empresas";
import { normalizePhoneBR } from "@/lib/webhooks/inbound";

import { acharPorNomeOuId, type Implantacao } from "./base";

/** Quantos itens uma chamada de lote aceita. */
export const TETO_DE_OBRIGACOES = 100;
/** Quantos itens a leitura devolve por chamada. */
export const TETO_DA_LEITURA = 200;

/**
 * Quantas páginas de 1000 o retrato lê: as 5 mil obrigações que o `.limit(5000)`
 * antigo declarava. O PostgREST corta toda resposta em 1000 linhas sem avisar,
 * então os contadores e o "de quantos" saíam das 1000 mais antigas, com cara de
 * total. Acima do teto o retrato DIZ que cortou.
 */
const PAGINAS_DO_RETRATO = 5;

export const SITUACOES_DA_LEITURA = ["todas", "pendentes", "vencidas", "vencendo", "pedidas_sem_resposta", "em_dia"] as const;
export type SituacaoDaLeitura = (typeof SITUACOES_DA_LEITURA)[number];

async function hojeDoCliente(c: Pick<Implantacao, "admin" | "orgId">): Promise<Dia> {
  const { data } = await c.admin.from("organizations").select("timezone").eq("id", c.orgId).maybeSingle();
  return diaNoFuso(new Date(), (data as { timezone?: string | null } | null)?.timezone ?? null);
}

async function lerFunis(c: Pick<Implantacao, "admin" | "orgId">): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await c.admin
    .from("crm_pipelines")
    .select("id, name")
    .eq("organization_id", c.orgId)
    .eq("is_archived", false)
    .order("position", { ascending: true });
  if (error) throw new Error(`não consegui ler os funis: ${error.message}`);
  return (data ?? []) as Array<{ id: string; name: string }>;
}

function tipoParaOAgente(t: TipoDeObrigacao, nomeDoFunil: string | null) {
  return {
    nome: t.nome,
    funil: nomeDoFunil,
    categoria: t.categoria,
    quem_entrega: t.quem_entrega,
    recorrencia: t.recorrencia,
    recorrencia_meses: t.recorrencia_meses,
    validade_meses: t.validade_meses,
    avisos_dias: t.avisos_dias,
    liga_a: t.liga_a,
  };
}

/**
 * Do mais antigo para o mais novo, com `id` no empate.
 *
 * A leitura já pede essa ordem ao banco (`created_at`, depois `id`, que é o que
 * deixa o `range` correto entre as páginas). Repetir aqui garante a MESMA ordem
 * em cliente que só guarda a última ordenação pedida, como o adaptador de
 * Postgres dos invariantes: lá o desempate por `id` apagaria o `created_at`.
 */
function doMaisAntigoParaOMaisNovo<T extends { id: string; created_at: string }>(itens: T[]): T[] {
  return [...itens].sort((a, b) => {
    const quando = Date.parse(a.created_at) - Date.parse(b.created_at);
    if (quando !== 0 && !Number.isNaN(quando)) return quando;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** O retrato das obrigações de um cliente: contadores, itens e catálogo. */
export async function lerObrigacoesDoCliente(
  c: Implantacao,
  pedido: { situacao?: SituacaoDaLeitura; limite?: number },
): Promise<Record<string, unknown>> {
  const hoje = await hojeDoCliente(c);
  const lido = await lerTodasAsPaginas<Obrigacao>(
    (de, ate, pedirContagem) =>
      c.admin
        .from("mia_obrigacoes")
        .select(COLUNAS_DA_OBRIGACAO, pedirContagem ? { count: "exact" } : undefined)
        .eq("organization_id", c.orgId)
        .is("arquivado_em", null)
        .order("created_at", { ascending: true })
        // `id` desempata: paginar por `range` só é correto sobre uma ordem única.
        .order("id", { ascending: true })
        .range(de, ate),
    { paginasMaximas: PAGINAS_DO_RETRATO },
  );
  if (lido.erro) throw new Error(`não consegui ler as obrigações: ${lido.erro}`);
  const todos = doMaisAntigoParaOMaisNovo(lido.linhas);
  const filtro = pedido.situacao ?? "pendentes";
  const passa = (i: Obrigacao): boolean => {
    if (filtro === "todas") return true;
    if (filtro === "vencidas") return urgencia(i, hoje).tipo === "vencido";
    if (filtro === "vencendo") return venceEm(i, 30, hoje);
    if (filtro === "pedidas_sem_resposta") return semResposta(i, hoje);
    if (filtro === "em_dia") return emDia(i, hoje);
    return !emDia(i, hoje);
  };
  const limite = Math.min(Math.max(pedido.limite ?? 50, 1), TETO_DA_LEITURA);
  const escolhidos = porUrgencia(todos.filter(passa), hoje);

  const empresaIds = [...new Set(escolhidos.slice(0, limite).map((i) => i.empresa_id).filter((v): v is string => !!v))];
  const leadIds = [...new Set(escolhidos.slice(0, limite).map((i) => i.lead_id).filter((v): v is string => !!v))];
  const [empresas, negocios, funis, tipos] = await Promise.all([
    empresaIds.length
      ? c.admin.from("crm_empresas").select("id, nome").eq("organization_id", c.orgId).in("id", empresaIds)
      : Promise.resolve({ data: [] }),
    leadIds.length
      ? c.admin.from("crm_leads").select("id, title").eq("organization_id", c.orgId).in("id", leadIds)
      : Promise.resolve({ data: [] }),
    lerFunis(c),
    lerTipos(c.admin, c.orgId),
  ]);
  const nomeDaEmpresa = new Map(((empresas.data ?? []) as Array<{ id: string; nome: string }>).map((e) => [e.id, e.nome]));
  const tituloDoNegocio = new Map(((negocios.data ?? []) as Array<{ id: string; title: string }>).map((n) => [n.id, n.title]));
  const nomeDoFunil = new Map(funis.map((f) => [f.id, f.name]));

  return {
    hoje,
    contadores: contarObrigacoes(todos, hoje),
    filtro,
    // A leitura passou do teto: os contadores e a lista cobrem só as mais
    // antigas. Dito aqui para quem lê não tomar o retrato por inteiro.
    ...(lido.truncado
      ? {
          lista_cortada: true,
          aviso:
            `Este cliente tem mais obrigações do que o retrato lê (${lido.total ?? "mais de " + todos.length} no banco, ` +
            `${todos.length} lidas): os contadores e a lista cobrem só as mais antigas.`,
        }
      : {}),
    mostrando: Math.min(escolhidos.length, limite),
    de: escolhidos.length,
    itens: escolhidos.slice(0, limite).map((i) => ({
      id: i.id,
      tipo: i.nome,
      categoria: i.categoria,
      situacao: ROTULO_DA_SITUACAO[situacao(i, hoje)],
      quem_entrega: i.quem_entrega,
      // A pessoa vai só pelo id: o nome dela está na base, sob o controle de acesso de lá.
      ligado_a: {
        negocio: i.lead_id ? { id: i.lead_id, titulo: tituloDoNegocio.get(i.lead_id) ?? null } : null,
        empresa: i.empresa_id ? { id: i.empresa_id, nome: nomeDaEmpresa.get(i.empresa_id) ?? null } : null,
        contato_id: i.contact_id,
      },
      pedido_em: i.pedido_em,
      prazo_em: i.prazo_em,
      recebido_em: i.recebido_em,
      valido_ate: i.valido_ate,
      proxima_em: i.proxima_em,
      feita_em: i.feita_em,
      recorrencia: i.recorrencia,
      recorrencia_meses: i.recorrencia_meses,
      avisos_dias: i.avisos_dias,
      ciclo: i.ciclo,
      tem_arquivo: Boolean(i.arquivo_path),
      origem: i.origem,
    })),
    catalogo: tipos.map((t) => tipoParaOAgente(t, t.pipeline_id ? (nomeDoFunil.get(t.pipeline_id) ?? null) : null)),
    como_usar:
      "A situação é CALCULADA pelas datas (ninguém a grava). Para mudar um item, mande-o de novo em " +
      "plataforma_garantir_obrigacoes com as datas novas: a chave é o tipo mais a quem ele está ligado.",
  };
}

export interface PedidoDeTipos {
  funil?: string | null;
  modelo_do_segmento?: string;
  tipos?: EntradaDeTipo[];
}

/** Garante o catálogo de tipos de um funil (ou de todos, sem `funil`). */
export async function garantirTiposDeObrigacao(c: Implantacao, pedido: PedidoDeTipos): Promise<Record<string, unknown>> {
  if (!pedido.modelo_do_segmento && !(pedido.tipos && pedido.tipos.length > 0)) {
    throw new Recusa(
      "Informe `modelo_do_segmento` (um de: " +
        SEGMENTOS_DE_OBRIGACAO.join(", ") +
        "), `tipos`, ou os dois. Os modelos de cada segmento estão em plataforma_listar_modelos, seção obrigacoes.",
    );
  }
  if (pedido.modelo_do_segmento !== undefined && !ehSegmentoDeObrigacao(pedido.modelo_do_segmento)) {
    throw new Recusa(
      `\`modelo_do_segmento\` "${pedido.modelo_do_segmento}" não existe. Os segmentos são: ${SEGMENTOS_DE_OBRIGACAO.join(", ")}.`,
    );
  }
  let pipelineId: string | null = null;
  let nomeDoFunil: string | null = null;
  if (pedido.funil) {
    const funil = acharPorNomeOuId(await lerFunis(c), pedido.funil, (f) => f.name, {
      singular: "o funil",
      comoListar: "Veja os funis em plataforma_ver_funis, ou crie com plataforma_garantir_funil.",
    });
    pipelineId = funil.id;
    nomeDoFunil = funil.name;
  }
  const alvo = { org: c.orgId, ator: c.autorUserId, pipelineId };
  try {
    const doModelo = pedido.modelo_do_segmento && ehSegmentoDeObrigacao(pedido.modelo_do_segmento)
      ? await aplicarModeloDoSegmento(c.admin, alvo, pedido.modelo_do_segmento)
      : [];
    const daLista = pedido.tipos?.length ? await garantirTipos(c.admin, alvo, pedido.tipos) : [];
    const tipos = [...doModelo, ...daLista].map(({ nome, desfecho, mudancas }) => ({ nome, desfecho, mudancas }));
    return {
      funil: nomeDoFunil ?? "(todos os funis)",
      criados: tipos.filter((t) => t.desfecho === "criou").length,
      atualizados: tipos.filter((t) => t.desfecho === "atualizou").length,
      ja_estavam: tipos.filter((t) => t.desfecho === "ja_estava").length,
      tipos,
    };
  } catch (err) {
    if (err instanceof ErroDeObrigacao) throw new Recusa(err.message);
    throw err;
  }
}

/** Os modelos por segmento, para `plataforma_listar_modelos`. */
export function modelosDeObrigacaoParaOAgente(): Record<string, unknown> {
  return {
    como_usar:
      "plataforma_garantir_tipos_de_obrigacao com `modelo_do_segmento` instala num funil os tipos do segmento. " +
      "Os tipos que o funil já tem pelo nome ficam como estão. `tipos` acrescenta ou ajusta um a um. " +
      "Documento de saúde (atestado, laudo, exame) é dado sensível e não está em modelo nenhum.",
    categorias: { documento: "algo que o cliente entrega, ou que tem validade", atividade: "algo que se repete e precisa ser lembrado" },
    recorrencias: RECORRENCIAS,
    liga_a: { negocio: "fica só no negócio", empresa: "aparece em todos os negócios da empresa", contato: "acompanha a pessoa" },
    segmentos: SEGMENTOS_DE_OBRIGACAO.map((s) => ({
      id: s,
      rotulo: ROTULO_DO_SEGMENTO_DE_OBRIGACAO[s],
      tipos: MODELOS_DE_TIPO.filter((m) => m.segmento === s).map((m) => ({
        nome: m.nome,
        categoria: m.categoria,
        validade_meses: m.validade_meses,
        recorrencia: m.recorrencia,
        recorrencia_meses: m.recorrencia_meses,
        avisos_dias: m.avisos_dias,
        quem_entrega: m.quem_entrega,
        liga_a: m.liga_a,
      })),
    })),
  };
}

/** A configuração que cada gatilho de obrigação pede, para `plataforma_listar_modelos`. */
export const CONFIGURACAO_DOS_GATILHOS_DE_OBRIGACAO: Record<string, string> = {
  "obrigacao.documento_vencendo": '{ "dias": 30, "tipo": "<opcional: nome do tipo>" } (dias ANTES do "válido até")',
  "obrigacao.documento_vencido": '{ "tipo": "<opcional>" } (dispara no dia seguinte ao vencimento; não pede dias)',
  "obrigacao.documento_nao_enviado": '{ "dias": 5, "tipo": "<opcional>" } (pedido há N dias sem receber)',
  "obrigacao.documento_recebido": '{ "tipo": "<opcional>" } (quando uma pessoa confirma o recebimento; não pede dias)',
  "obrigacao.atividade_chegando": '{ "dias": 15, "tipo": "<opcional>" } (dias ANTES da próxima data)',
};

// ── os itens, em lote ──────────────────────────────────────────────────────

export const EXEMPLO_DE_OBRIGACAO = {
  tipo: "Alvará de funcionamento",
  empresa_cnpj: "00.111.222/0001-00",
  recebido_em: "2025-10-14",
  valido_ate: "2026-10-13",
};

type Padroes = Pick<
  ModeloDeTipo,
  "nome" | "nome_curto" | "categoria" | "quem_entrega" | "recorrencia" | "recorrencia_meses" | "validade_meses" | "avisos_dias" | "dias_sem_resposta"
> & { tipo_id: string | null };

/** O tipo pelo nome: primeiro o catálogo do cliente (o do funil do negócio vence), depois os modelos. */
function padroesDoTipo(nome: string, tipos: readonly TipoDeObrigacao[], pipelineId: string | null): Padroes | null {
  const chave = chaveDoNome(nome);
  const doCatalogo = tipos.filter((t) => chaveDoNome(t.nome) === chave);
  const escolhido = doCatalogo.find((t) => t.pipeline_id === pipelineId) ?? doCatalogo.find((t) => t.pipeline_id === null) ?? doCatalogo[0];
  if (escolhido) return { ...escolhido, nome_curto: escolhido.nome_curto ?? escolhido.nome, tipo_id: escolhido.id };
  const modelo = MODELOS_DE_TIPO.find((m) => chaveDoNome(m.nome) === chave);
  return modelo ? { ...modelo, tipo_id: null } : null;
}

function diaDoItem(valor: unknown): Dia | null | undefined {
  if (valor === undefined || valor === null || valor === "") return undefined;
  const iso = dataDeOrigem(valor);
  return iso ? comoDia(iso.slice(0, 10)) : null;
}

/**
 * As pessoas da equipe do cliente, por e-mail. O e-mail mora no Auth, e não
 * numa tabela do produto: é lido pessoa a pessoa, como faz a importação de
 * negócios para o dono do card.
 */
async function equipePorEmail(ctx: ContextoDaFerramenta, orgId: string): Promise<Map<string, string>> {
  const { data, error } = await ctx.admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", orgId)
    .is("revoked_at", null);
  if (error) throw new Error(`não consegui ler a equipe: ${error.message}`);
  const porEmail = new Map<string, string>();
  for (const membro of (data ?? []) as Array<{ user_id: string }>) {
    const { data: achado } = await ctx.admin.auth.admin.getUserById(membro.user_id);
    const email = achado?.user?.email?.trim().toLowerCase();
    if (email) porEmail.set(email, membro.user_id);
  }
  return porEmail;
}

const CAMPOS_DE_DATA = ["pedido_em", "prazo_em", "recebido_em", "valido_ate", "proxima_em", "feita_em"] as const;

/**
 * Garante os itens de um lote. Um item ruim não derruba os outros: os bons
 * entram e os ruins voltam com a posição, o campo e o que era esperado.
 */
export async function garantirObrigacoesEmLote(
  ctx: ContextoDaFerramenta,
  args: Record<string, unknown>,
): Promise<ResultadoDoLote> {
  const organizacao = await organizacaoDaImportacao(ctx.admin, args.organization_id);
  const origem = origemDaImportacao(args.origem, false);
  const itens = listaDeItens(args, "obrigacoes", TETO_DE_OBRIGACOES, EXEMPLO_DE_OBRIGACAO);
  const requestId = requestIdDe(ctx);
  const c = { admin: ctx.admin, orgId: organizacao.id };
  const hoje = await hojeDoCliente(c);
  const coletor = new Coletor();
  const [tipos, empresas] = await Promise.all([lerTipos(ctx.admin, organizacao.id), EmpresasDaBase.carregar(ctx, organizacao.id)]);
  // A equipe por e-mail só é lida se algum item citar um responsável.
  let equipe: Map<string, string> | null = null;

  for (const [indice, bruto] of itens.entries()) {
    const posicao = indice + 1;
    if (!ehObjeto(bruto)) {
      coletor.recusar(posicao, "(item)", "cada item é um objeto.", JSON.stringify(EXEMPLO_DE_OBRIGACAO));
      continue;
    }
    const nome = texto(bruto.tipo, 120);
    if (!nome) {
      coletor.recusar(posicao, "tipo", "o nome do documento ou da atividade é obrigatório.", '"Alvará de funcionamento"');
      continue;
    }

    // ── a quem o item está ligado ──
    let leadId: string | null = null;
    let pipelineId: string | null = null;
    if (bruto.negocio_id !== undefined && bruto.negocio_id !== null) {
      if (!pareceUuid(bruto.negocio_id)) {
        coletor.recusar(posicao, "negocio_id", "é o id do negócio na plataforma (de plataforma_importar_negocios).", '"00000000-0000-4000-8000-000000000002"');
        continue;
      }
      const { data } = await ctx.admin
        .from("crm_leads")
        .select("id, pipeline_id")
        .eq("organization_id", organizacao.id)
        .eq("id", bruto.negocio_id.trim())
        .maybeSingle();
      const lead = data as { id: string; pipeline_id: string | null } | null;
      if (!lead) {
        coletor.recusar(posicao, "negocio_id", "não existe negócio com este id neste cliente.");
        continue;
      }
      leadId = lead.id;
      pipelineId = lead.pipeline_id;
    }

    let empresaId: string | null = null;
    const cnpj = apenasDigitos(texto(bruto.empresa_cnpj, 40) ?? "") || null;
    const nomeDaEmpresa = texto(bruto.empresa_nome, 200);
    if (bruto.empresa_id !== undefined && bruto.empresa_id !== null) {
      if (!pareceUuid(bruto.empresa_id)) {
        coletor.recusar(posicao, "empresa_id", "é o id da empresa na plataforma. Sem o id, use `empresa_cnpj` ou `empresa_nome`.");
        continue;
      }
      const { data } = await ctx.admin.from("crm_empresas").select("id").eq("organization_id", organizacao.id).eq("id", bruto.empresa_id.trim()).maybeSingle();
      if (!data) {
        coletor.recusar(posicao, "empresa_id", "não existe empresa com este id neste cliente.");
        continue;
      }
      empresaId = (data as { id: string }).id;
    } else if (cnpj || nomeDaEmpresa) {
      const achada = empresas.achar(nomeDaEmpresa, cnpj);
      if (!achada.empresa) {
        coletor.recusar(
          posicao,
          cnpj ? "empresa_cnpj" : "empresa_nome",
          "não achei esta empresa neste cliente. Importe as empresas antes (plataforma_importar_empresas).",
        );
        continue;
      }
      empresaId = achada.empresa.id;
    }

    let contatoId: string | null = null;
    const telefoneBruto = texto(bruto.contato_telefone, 40);
    const email = texto(bruto.contato_email, 200);
    if (bruto.contato_id !== undefined && bruto.contato_id !== null) {
      if (!pareceUuid(bruto.contato_id)) {
        coletor.recusar(posicao, "contato_id", "é o id do contato na plataforma. Sem o id, use `contato_telefone` ou `contato_email`.");
        continue;
      }
      const { data } = await ctx.admin.from("contacts").select("id").eq("organization_id", organizacao.id).eq("id", bruto.contato_id.trim()).maybeSingle();
      if (!data) {
        coletor.recusar(posicao, "contato_id", "não existe contato com este id neste cliente.");
        continue;
      }
      contatoId = (data as { id: string }).id;
    } else if (telefoneBruto || email) {
      const telefone = telefoneBruto ? normalizePhoneBR(telefoneBruto) : null;
      const contato =
        (telefone ? await acharContatoPorTelefone(ctx.admin, organizacao.id, telefone) : null) ??
        (email ? await acharContatoPorEmail(ctx.admin, organizacao.id, email) : null);
      if (!contato) {
        coletor.recusar(
          posicao,
          telefoneBruto ? "contato_telefone" : "contato_email",
          "não achei este contato neste cliente. Importe os contatos antes (plataforma_importar_contatos).",
        );
        continue;
      }
      contatoId = contato.id;
    }

    if (!leadId && !empresaId && !contatoId) {
      coletor.recusar(
        posicao,
        "(vínculo)",
        "ligue o item a um negócio (`negocio_id`), a uma empresa (`empresa_cnpj`, `empresa_nome` ou `empresa_id`) ou a um contato (`contato_telefone`, `contato_email` ou `contato_id`).",
        JSON.stringify(EXEMPLO_DE_OBRIGACAO),
      );
      continue;
    }

    // ── o tipo e as regras ──
    const padroes = padroesDoTipo(nome, tipos, pipelineId);
    const categoriaBruta = texto(bruto.categoria, 20);
    if (categoriaBruta && !(CATEGORIAS as readonly string[]).includes(categoriaBruta)) {
      coletor.recusar(posicao, "categoria", 'é "documento" ou "atividade".', '"documento"');
      continue;
    }
    const categoria = (categoriaBruta as Categoria | null) ?? padroes?.categoria ?? null;
    if (!categoria) {
      coletor.recusar(
        posicao,
        "categoria",
        `o tipo "${nome}" não está no catálogo do cliente nem nos modelos: diga se é "documento" ou "atividade".`,
        '"documento"',
      );
      continue;
    }

    const datas: Partial<Record<(typeof CAMPOS_DE_DATA)[number], Dia>> = {};
    let dataRuim: string | null = null;
    for (const campo of CAMPOS_DE_DATA) {
      const lida = diaDoItem(bruto[campo]);
      if (lida === null) dataRuim = campo;
      else if (lida !== undefined) datas[campo] = lida;
    }
    if (dataRuim) {
      coletor.recusar(posicao, dataRuim, "é uma data em AAAA-MM-DD ou DD/MM/AAAA.", '"2026-10-13"');
      continue;
    }

    const recorrenciaBruta = texto(bruto.recorrencia, 20);
    if (recorrenciaBruta && !(RECORRENCIAS as readonly string[]).includes(recorrenciaBruta)) {
      coletor.recusar(posicao, "recorrencia", `é uma de: ${RECORRENCIAS.join(", ")}.`, '"anual"');
      continue;
    }
    const quemBruto = texto(bruto.quem_entrega, 20);
    if (quemBruto && !(QUEM_ENTREGA as readonly string[]).includes(quemBruto)) {
      coletor.recusar(posicao, "quem_entrega", 'é "cliente" (ele entrega) ou "nos" (a empresa entrega).', '"cliente"');
      continue;
    }

    let responsavel: string | null | undefined;
    const emailDoResponsavel = texto(bruto.responsavel_email, 200)?.toLowerCase();
    if (emailDoResponsavel) {
      equipe ??= await equipePorEmail(ctx, organizacao.id);
      responsavel = equipe.get(emailDoResponsavel) ?? null;
      if (!responsavel) {
        coletor.recusar(posicao, "responsavel_email", "não é de ninguém da equipe deste cliente (veja plataforma_ver_configuracao, seção equipe).");
        continue;
      }
    }

    const entrada: EntradaDeObrigacao = {
      nome: padroes?.nome ?? nome,
      nome_curto: padroes?.nome_curto ?? null,
      tipo_id: padroes?.tipo_id ?? null,
      categoria,
      lead_id: leadId,
      empresa_id: empresaId,
      contact_id: contatoId,
      quem_entrega: (quemBruto as EntradaDeObrigacao["quem_entrega"]) ?? padroes?.quem_entrega,
      recorrencia: (recorrenciaBruta as EntradaDeObrigacao["recorrencia"]) ?? padroes?.recorrencia,
      recorrencia_meses:
        typeof bruto.recorrencia_meses === "number" ? bruto.recorrencia_meses : (padroes?.recorrencia_meses ?? null),
      validade_meses: typeof bruto.validade_meses === "number" ? bruto.validade_meses : (padroes?.validade_meses ?? 0),
      avisos_dias: Array.isArray(bruto.avisos_dias) ? normalizarAvisos(bruto.avisos_dias) : padroes?.avisos_dias,
      dias_sem_resposta: padroes?.dias_sem_resposta,
      ...datas,
      responsavel_user_id: responsavel ?? null,
      observacao: texto(bruto.observacao, 2000),
      origem: origem ? `importacao:${origem}` : "mcp",
      chave_natural: [chaveDoNome(padroes?.nome ?? nome), `n:${leadId ?? ""}`, `e:${empresaId ?? ""}`, `c:${contatoId ?? ""}`].join("|"),
    };

    try {
      const linha = montarLinha(entrada, hoje);
      const { data: existenteBruto, error: erroAoLer } = await ctx.admin
        .from("mia_obrigacoes")
        .select(COLUNAS_DA_OBRIGACAO)
        .eq("organization_id", organizacao.id)
        .eq("chave_natural", entrada.chave_natural as string)
        .is("arquivado_em", null)
        .maybeSingle();
      if (erroAoLer) throw new Error(erroAoLer.message);
      let existente = existenteBruto as unknown as Obrigacao | null;

      // O item pode já existir SEM chave: foi criado pela tela (ou pela empresa
      // de demonstração). O mesmo tipo com exatamente os mesmos donos é o mesmo
      // item, e a migração o ADOTA em vez de criar um gêmeo. Mais de um igual é
      // dúvida que a ferramenta não resolve sozinha.
      let adotado = false;
      if (!existente) {
        let semChave = ctx.admin
          .from("mia_obrigacoes")
          .select(COLUNAS_DA_OBRIGACAO)
          .eq("organization_id", organizacao.id)
          .is("arquivado_em", null)
          .is("chave_natural", null);
        semChave = leadId ? semChave.eq("lead_id", leadId) : semChave.is("lead_id", null);
        semChave = empresaId ? semChave.eq("empresa_id", empresaId) : semChave.is("empresa_id", null);
        semChave = contatoId ? semChave.eq("contact_id", contatoId) : semChave.is("contact_id", null);
        const { data: candidatos, error: erroDosCandidatos } = await semChave.order("created_at", { ascending: true }).limit(50);
        if (erroDosCandidatos) throw new Error(erroDosCandidatos.message);
        const iguais = ((candidatos ?? []) as unknown as Obrigacao[]).filter(
          (i) => chaveDoNome(i.nome) === chaveDoNome(entrada.nome) && i.categoria === categoria,
        );
        if (iguais.length > 1) {
          coletor.recusar(
            posicao,
            "tipo",
            `já existem ${iguais.length} itens "${entrada.nome}" ligados a este mesmo dono, criados pela tela. Arquive os repetidos pela tela (Obrigações) e mande de novo.`,
          );
          continue;
        }
        if (iguais.length === 1) {
          existente = iguais[0]!;
          adotado = true;
        }
      }
      const chaveAoAdotar = adotado ? { chave_natural: entrada.chave_natural } : {};
      const avisoDeAdocao = adotado ? ["Este item já existia (criado pela tela) e passou a ser acompanhado pela migração."] : [];

      if (!existente) {
        const { data: criado, error } = await ctx.admin
          .from("mia_obrigacoes")
          .insert({ ...linha, organization_id: organizacao.id, created_by_user_id: ctx.autorUserId, updated_by_user_id: ctx.autorUserId })
          .select("id")
          .single();
        if (error || !criado) throw new Error(error?.message ?? "sem linha");
        coletor.registrar(posicao, "criou", { id: (criado as { id: string }).id });
        continue;
      }

      // Um recebimento (ou uma execução) mais novo que o que está gravado fecha o
      // ciclo: o anterior vai para o histórico, como na tela. Sem evento.
      const recebidoNovo = datas.recebido_em && (!existente.recebido_em || datas.recebido_em > existente.recebido_em);
      const feitaNova = datas.feita_em && (!existente.feita_em || datas.feita_em > existente.feita_em);
      if (categoria === "documento" && recebidoNovo && (existente.recebido_em || existente.valido_ate)) {
        const { error } = await ctx.admin.rpc("fn_mia_obrigacao_fechar_ciclo", {
          p_obrigacao: existente.id,
          p_ciclo_esperado: existente.ciclo,
          p_como: "recebido",
          p_dia: datas.recebido_em,
          p_valido_ate: (linha.valido_ate as string | null) ?? null,
          p_proxima_em: null,
          // O arquivo do ciclo anterior vai com ele para o histórico; a migração não traz arquivo.
          p_arquivo: null,
          p_ator: ctx.autorUserId,
          p_proposta: null,
        });
        if (error) throw new Error(error.message);
        await ctx.admin.from("mia_obrigacoes").update({ sem_aviso_antes_de: hoje, ...chaveAoAdotar }).eq("organization_id", organizacao.id).eq("id", existente.id);
        coletor.registrar(posicao, "atualizou", {
          id: existente.id,
          avisos: ["Recebimento mais novo: o ciclo anterior foi para o histórico do item.", ...avisoDeAdocao],
        });
        continue;
      }
      if (categoria === "atividade" && feitaNova && existente.proxima_em) {
        const { error } = await ctx.admin.rpc("fn_mia_obrigacao_fechar_ciclo", {
          p_obrigacao: existente.id,
          p_ciclo_esperado: existente.ciclo,
          p_como: "feita",
          p_dia: datas.feita_em,
          p_valido_ate: null,
          p_proxima_em: datas.proxima_em ?? proximaDataDaAtividade(existente, hoje),
          p_arquivo: null,
          p_ator: ctx.autorUserId,
          p_proposta: null,
        });
        if (error) throw new Error(error.message);
        await ctx.admin.from("mia_obrigacoes").update({ sem_aviso_antes_de: hoje, ...chaveAoAdotar }).eq("organization_id", organizacao.id).eq("id", existente.id);
        coletor.registrar(posicao, "atualizou", {
          id: existente.id,
          avisos: ["Execução mais nova: o ciclo anterior foi para o histórico do item.", ...avisoDeAdocao],
        });
        continue;
      }

      // Só o que VEIO no item é comparado: campo ausente fica como está.
      const patch: Record<string, unknown> = {};
      const atual = existente;
      const veio = (campo: string) => bruto[campo] !== undefined && bruto[campo] !== null && bruto[campo] !== "";
      const comparar = (campo: keyof Obrigacao, chaveDoItem: string) => {
        if (!veio(chaveDoItem)) return;
        if (JSON.stringify(atual[campo]) !== JSON.stringify(linha[campo])) patch[campo] = linha[campo];
      };
      for (const campo of CAMPOS_DE_DATA) comparar(campo, campo);
      comparar("recorrencia", "recorrencia");
      comparar("recorrencia_meses", "recorrencia_meses");
      comparar("validade_meses", "validade_meses");
      comparar("avisos_dias", "avisos_dias");
      comparar("quem_entrega", "quem_entrega");
      comparar("observacao", "observacao");
      if (veio("responsavel_email") && existente.responsavel_user_id !== (responsavel ?? null)) patch.responsavel_user_id = responsavel ?? null;
      // Recorrência mudou junto com o N: os dois viajam juntos, pelo CHECK do banco.
      if (patch.recorrencia !== undefined && patch.recorrencia_meses === undefined) patch.recorrencia_meses = linha.recorrencia_meses;

      if (Object.keys(patch).length === 0) {
        if (adotado) {
          // Só a chave muda: as datas e as regras do item ficam como a tela deixou.
          const { error } = await ctx.admin
            .from("mia_obrigacoes")
            .update(chaveAoAdotar)
            .eq("organization_id", organizacao.id)
            .eq("id", existente.id);
          if (error) throw new Error(error.message);
          coletor.registrar(posicao, "atualizou", { id: existente.id, avisos: avisoDeAdocao });
          continue;
        }
        coletor.registrar(posicao, "ja_estava", { id: existente.id });
        continue;
      }
      const { error } = await ctx.admin
        .from("mia_obrigacoes")
        .update({ ...patch, ...chaveAoAdotar, sem_aviso_antes_de: hoje, updated_at: new Date().toISOString(), updated_by_user_id: ctx.autorUserId })
        .eq("organization_id", organizacao.id)
        .eq("id", existente.id);
      if (error) throw new Error(error.message);
      coletor.registrar(posicao, "atualizou", { id: existente.id, ...(adotado ? { avisos: avisoDeAdocao } : {}) });
    } catch (err) {
      coletor.recusar(posicao, "(item)", err instanceof Error ? err.message : String(err));
    }
  }

  await registrarImportacao(ctx, {
    organizacao,
    ferramenta: "plataforma_garantir_obrigacoes",
    tipo: "obrigacoes",
    origem,
    coletor,
    requestId,
  });
  return coletor.resultado(organizacao);
}
