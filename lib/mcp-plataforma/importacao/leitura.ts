/**
 * VER A IMPORTAÇÃO — o retrato do que já entrou na base de um cliente.
 *
 * É a leitura que o agente que migra faz antes de começar (o que já existe?) e
 * depois de cada passo (entrou?). Leitura é livre: não exige operação no token.
 *
 * ── O que NÃO sai daqui ───────────────────────────────────────────────────
 *
 * Contagens e ids. Nome, telefone e e-mail de contato não entram na resposta:
 * quem precisa da pessoa abre a ficha dela na tela, sob o controle de acesso da
 * organização. As duplicatas suspeitas vêm como grupos de ids pelo mesmo motivo.
 *
 * ── As áreas ──────────────────────────────────────────────────────────────
 *
 * Cada área (`AREAS_DE_IMPORTACAO`) responde três perguntas para o checklist da
 * implantação: o que está PRONTO, o que FALTA (com a ferramenta que resolve) e
 * o que é SÓ PELA TELA (o que nenhuma ferramenta faz, porque é decisão de gente
 * ou credencial).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { temChaveDeEmbedding } from "@/lib/ai/embeddings/chave";
import { encontrarContatosDuplicados, type ContatoParaDeduplicar } from "@/lib/contacts/duplicados";
import { capacidadesDaOrganizacao } from "@/lib/organizacao/capacidades";

import { ehObjeto, lerEmPaginas, organizacaoDaImportacao, PREFIXO_DA_ORIGEM, TAMANHO_DA_PAGINA } from "./base";
import type { AreaDeImportacao, ContextoDaFerramenta, FerramentaComExemplo, SituacaoDaArea } from "./tipos";

/** Quantos contatos a varredura de duplicatas lê. Acima disso ela diz que truncou. */
const TETO_DA_VARREDURA_DE_DUPLICATAS = 20_000;
/** Quantos grupos de duplicatas voltam como amostra (só ids). */
const AMOSTRA_DE_DUPLICATAS = 20;
/** Quantas origens distintas de negócio importado são contadas. */
const TETO_DE_ORIGENS = 20;
const AMOSTRA_DE_PRODUTOS_SEM_FOTO = 30;
const ULTIMOS_TRABALHOS = 15;
/**
 * Até onde a lista de trabalhos olha para trás. Sem o corte, uma organização com
 * anos de auditoria e nenhuma importação faria a consulta atravessar a trilha
 * inteira atrás de quinze linhas que não existem.
 */
const DIAS_DE_TRABALHOS = 90;

type Contagem = PromiseLike<{ count: number | null; error: { message: string } | null }>;

async function contar(consulta: Contagem): Promise<number> {
  const { count, error } = await consulta;
  if (error) throw new Error(`não consegui contar: ${error.message}`);
  return count ?? 0;
}

const SO_CONTAR = { count: "exact", head: true } as const;

// ── contatos ──────────────────────────────────────────────────────────────

export interface NumerosDosContatos {
  total: number;
  sem_telefone: number;
  sem_telefone_e_sem_email: number;
  bloqueados: number;
  com_empresa: number;
  importados: number;
  duplicatas_suspeitas: {
    grupos: number;
    contatos_envolvidos: number;
    varreu_tudo: boolean;
    amostra: Array<{ motivos: string[]; ids: string[] }>;
  };
}

/** Os contatos VIVOS: pessoa (não o registro técnico de grupo), não fundido, não anonimizado. */
function vivos(admin: SupabaseClient, orgId: string, colunas: string, opcoes?: typeof SO_CONTAR) {
  return admin
    .from("contacts")
    .select(colunas, opcoes)
    .eq("organization_id", orgId)
    .eq("kind", "person")
    .eq("is_anonymized", false)
    .is("is_merged_into", null);
}

export async function numerosDosContatos(admin: SupabaseClient, orgId: string): Promise<NumerosDosContatos> {
  const [total, semTelefone, semNada, bloqueados, comEmpresa, importados] = await Promise.all([
    contar(vivos(admin, orgId, "id", SO_CONTAR)),
    contar(vivos(admin, orgId, "id", SO_CONTAR).is("phone_number", null)),
    contar(vivos(admin, orgId, "id", SO_CONTAR).is("phone_number", null).is("email", null)),
    contar(vivos(admin, orgId, "id", SO_CONTAR).eq("is_blocked", true)),
    contar(vivos(admin, orgId, "id", SO_CONTAR).not("empresa_id", "is", null)),
    contar(vivos(admin, orgId, "id", SO_CONTAR).like("source", `${PREFIXO_DA_ORIGEM}%`)),
  ]);

  // A MESMA detecção da tela Contatos › Duplicados (`encontrarContatosDuplicados`):
  // grafias do mesmo telefone (o nono dígito) e o telefone que a ingestão do
  // WhatsApp deixou em conflito. Aqui ela varre a base inteira, em páginas.
  const linhas = await lerEmPaginas<ContatoParaDeduplicar>((depoisDoId) => {
    const consulta = vivos(
      admin,
      orgId,
      "id, name, display_name, email, email_normalized, phone_number, is_merged_into, is_anonymized, source_metadata, created_at, last_activity_at",
    );
    return (depoisDoId ? consulta.gt("id", depoisDoId) : consulta).order("id", { ascending: true }).limit(TAMANHO_DA_PAGINA);
  }, TETO_DA_VARREDURA_DE_DUPLICATAS);
  const grupos = encontrarContatosDuplicados(linhas);

  return {
    total,
    sem_telefone: semTelefone,
    sem_telefone_e_sem_email: semNada,
    bloqueados,
    com_empresa: comEmpresa,
    importados,
    duplicatas_suspeitas: {
      grupos: grupos.length,
      contatos_envolvidos: grupos.reduce((soma, g) => soma + g.contatos.length, 0),
      varreu_tudo: linhas.length < TETO_DA_VARREDURA_DE_DUPLICATAS,
      amostra: grupos.slice(0, AMOSTRA_DE_DUPLICATAS).map((g) => ({ motivos: g.motivos, ids: g.contatos.map((c) => c.id) })),
    },
  };
}

function areaDeContatos(n: NumerosDosContatos): SituacaoDaArea {
  const pronto: string[] = [];
  const falta: string[] = [];
  if (n.total > 0) {
    pronto.push(`${n.total} contato(s) na base, ${n.importados} vindo(s) de importação por MCP.`);
    if (n.bloqueados > 0) pronto.push(`${n.bloqueados} contato(s) bloqueado(s) para envio (opt-out), respeitado(s) por todo envio.`);
  } else {
    falta.push("Nenhum contato na base. Importe com plataforma_importar_contatos (depois das empresas, se houver).");
  }
  if (n.sem_telefone > 0) {
    falta.push(
      `${n.sem_telefone} contato(s) sem telefone válido: não recebem mensagem nem são reconhecidos quando escreverem. ` +
        "Se o CRM de origem tem o telefone, repita plataforma_importar_contatos com ele (o e-mail liga os dois).",
    );
  }
  if (n.duplicatas_suspeitas.grupos > 0) {
    falta.push(
      `${n.duplicatas_suspeitas.grupos} grupo(s) de contatos que parecem a mesma pessoa (${n.duplicatas_suspeitas.contatos_envolvidos} contatos).`,
    );
  }
  return {
    chave: "contatos",
    rotulo: "Contatos",
    pronto,
    falta,
    so_pela_tela: [
      "Juntar contatos duplicados: Contatos › Duplicados. A fusão não tem desfazer, e quem decide é uma pessoa.",
      "Tirar o bloqueio de quem pediu para não receber mensagens: na ficha do contato, um a um.",
    ],
    numeros: { ...n },
  };
}

// ── empresas ──────────────────────────────────────────────────────────────

export interface NumerosDasEmpresas {
  total: number;
  sem_cnpj: number;
}

export async function numerosDasEmpresas(admin: SupabaseClient, orgId: string): Promise<NumerosDasEmpresas> {
  const vivas = () =>
    admin.from("crm_empresas").select("id", SO_CONTAR).eq("organization_id", orgId).is("mesclada_em", null);
  const [total, semCnpj] = await Promise.all([contar(vivas()), contar(vivas().is("cnpj", null))]);
  return { total, sem_cnpj: semCnpj };
}

function areaDeEmpresas(n: NumerosDasEmpresas): SituacaoDaArea {
  return {
    chave: "empresas",
    rotulo: "Empresas",
    pronto: n.total > 0 ? [`${n.total} empresa(s) na base.`] : [],
    falta: [
      ...(n.total === 0
        ? ["Nenhuma empresa na base. Se o cliente vende para empresas, importe com plataforma_importar_empresas antes dos contatos."]
        : []),
      ...(n.sem_cnpj > 0
        ? [`${n.sem_cnpj} empresa(s) sem CNPJ: são reconhecidas só pelo nome. Com o CNPJ na lista, plataforma_importar_empresas o preenche.`]
        : []),
    ],
    so_pela_tela: ["Juntar empresas duplicadas: Empresas › Mesclar. A fusão não tem desfazer."],
    numeros: { ...n },
  };
}

// ── negócios ──────────────────────────────────────────────────────────────

export interface NegociosDeUmaOrigem {
  origem: string;
  total: number;
  abertos: number;
  ganhos: number;
  perdidos: number;
}

export interface NumerosDosNegocios {
  total: number;
  abertos: number;
  ganhos: number;
  perdidos: number;
  importados_por_origem: NegociosDeUmaOrigem[];
}

/**
 * As origens distintas de negócio importado, sem ler todos os negócios.
 *
 * O PostgREST não tem `distinct`. Cada consulta pede UMA linha depois da última
 * origem achada: o custo é uma leitura por origem (uma migração tem uma ou
 * duas), e não uma por negócio.
 */
async function origensDeNegocio(admin: SupabaseClient, orgId: string): Promise<string[]> {
  const sources: string[] = [];
  let ultima: string | null = null;
  while (sources.length < TETO_DE_ORIGENS) {
    const base = admin
      .from("crm_leads")
      .select("source")
      .eq("organization_id", orgId)
      .like("source", `${PREFIXO_DA_ORIGEM}%`);
    const resposta: { data: unknown; error: { message: string } | null } = await (ultima ? base.gt("source", ultima) : base)
      .order("source", { ascending: true })
      .limit(1);
    if (resposta.error) throw new Error(`não consegui ler as origens dos negócios: ${resposta.error.message}`);
    const proxima: string | undefined = ((resposta.data ?? []) as Array<{ source: string }>)[0]?.source;
    if (!proxima || proxima === ultima) break;
    sources.push(proxima);
    ultima = proxima;
  }
  return sources;
}

export async function numerosDosNegocios(admin: SupabaseClient, orgId: string): Promise<NumerosDosNegocios> {
  const todos = () => admin.from("crm_leads").select("id", SO_CONTAR).eq("organization_id", orgId);
  const [total, abertos, ganhos, perdidos, sources] = await Promise.all([
    contar(todos()),
    contar(todos().eq("status", "open")),
    contar(todos().eq("status", "won")),
    contar(todos().eq("status", "lost")),
    origensDeNegocio(admin, orgId),
  ]);
  const porOrigem = await Promise.all(
    sources.map(async (source) => {
      const daOrigem = () => todos().eq("source", source);
      const [t, a, g, p] = await Promise.all([
        contar(daOrigem()),
        contar(daOrigem().eq("status", "open")),
        contar(daOrigem().eq("status", "won")),
        contar(daOrigem().eq("status", "lost")),
      ]);
      return { origem: source.slice(PREFIXO_DA_ORIGEM.length), total: t, abertos: a, ganhos: g, perdidos: p };
    }),
  );
  return { total, abertos, ganhos, perdidos, importados_por_origem: porOrigem };
}

function areaDeNegocios(n: NumerosDosNegocios): SituacaoDaArea {
  const importados = n.importados_por_origem.reduce((soma, o) => soma + o.total, 0);
  return {
    chave: "negocios",
    rotulo: "Negócios",
    pronto:
      n.total > 0
        ? [
            `${n.total} negócio(s) no funil: ${n.abertos} aberto(s), ${n.ganhos} ganho(s) e ${n.perdidos} perdido(s).`,
            ...n.importados_por_origem.map(
              (o) => `${o.total} vindo(s) de "${o.origem}": ${o.abertos} aberto(s), ${o.ganhos} ganho(s), ${o.perdidos} perdido(s).`,
            ),
          ]
        : [],
    falta:
      importados === 0
        ? ["Nenhum negócio importado. Com funis, empresas e contatos prontos, importe com plataforma_importar_negocios."]
        : [],
    so_pela_tela: [
      "Mover de etapa, ganhar, perder ou trocar o dono de um negócio que já foi importado: pela tela, porque essas mudanças " +
        "disparam os efeitos de etapa (automação, follow-up, conversão).",
    ],
    numeros: { ...n },
  };
}

// ── conhecimento ──────────────────────────────────────────────────────────

export interface NumerosDoConhecimento {
  total: number;
  indexadas: number;
  com_falha: number;
  aguardando: number;
  indexacao_habilitada: boolean;
  fontes: Array<{ id: string; nome: string; tipo: string; situacao: string; trechos: number; erro: string | null }>;
}

export async function numerosDoConhecimento(admin: SupabaseClient, orgId: string): Promise<NumerosDoConhecimento> {
  const [{ data, error }, habilitada] = await Promise.all([
    admin
      .from("ai_knowledge_sources")
      .select("id, name, source_type, last_index_status, last_index_error, chunks_count")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(100),
    temChaveDeEmbedding(orgId).catch(() => false),
  ]);
  if (error) throw new Error(`não consegui ler os materiais: ${error.message}`);
  const fontes = ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    id: String(f.id),
    nome: String(f.name ?? ""),
    tipo: String(f.source_type ?? ""),
    // `null` = ainda não rodou. Os demais são o vocabulário do indexador.
    situacao: typeof f.last_index_status === "string" ? f.last_index_status : "aguardando",
    trechos: Number(f.chunks_count ?? 0),
    erro: typeof f.last_index_error === "string" ? f.last_index_error.slice(0, 200) : null,
  }));
  return {
    total: fontes.length,
    indexadas: fontes.filter((f) => f.situacao === "success" || f.situacao === "partial").length,
    com_falha: fontes.filter((f) => f.situacao === "failed").length,
    aguardando: fontes.filter((f) => !["success", "partial", "failed"].includes(f.situacao)).length,
    indexacao_habilitada: habilitada,
    fontes,
  };
}

function areaDeConhecimento(n: NumerosDoConhecimento): SituacaoDaArea {
  const falta: string[] = [];
  if (n.total === 0) {
    falta.push("Nenhum material na base de conhecimento. Arquivos entram por plataforma_importar_conhecimento.");
  }
  if (n.com_falha > 0) falta.push(`${n.com_falha} material(is) com falha de indexação: abra na tela Conhecimento para ver o motivo.`);
  if (n.total > 0 && !n.indexacao_habilitada) {
    falta.push("O cliente não tem chave de indexação: os materiais estão gravados e PARADOS, e o agente ainda não os consulta.");
  }
  return {
    chave: "conhecimento",
    rotulo: "Base de conhecimento",
    pronto: n.indexadas > 0 ? [`${n.indexadas} de ${n.total} material(is) indexado(s) e consultado(s) pelo agente.`] : [],
    falta,
    so_pela_tela: [
      "A chave de IA do cliente (a credencial que indexa e responde) é configurada por uma pessoa, na tela.",
      "Trocar o conteúdo de um material que já existe, ou arquivá-lo: tela Conhecimento.",
    ],
    numeros: { ...n },
  };
}

// ── fotos de produto ──────────────────────────────────────────────────────

export interface NumerosDasFotos {
  produtos: number;
  sem_foto: number;
  amostra_sem_foto: Array<{ codigo: string; nome: string }>;
}

export async function numerosDasFotos(admin: SupabaseClient, orgId: string): Promise<NumerosDasFotos> {
  const ativos = () => admin.from("catalog_products").select("id", SO_CONTAR).eq("organization_id", orgId).eq("ativo", true);
  const [produtos, semFoto, amostra] = await Promise.all([
    contar(ativos()),
    contar(ativos().eq("fotos", "{}")),
    admin
      .from("catalog_products")
      .select("codigo, nome")
      .eq("organization_id", orgId)
      .eq("ativo", true)
      .eq("fotos", "{}")
      .order("nome", { ascending: true })
      .limit(AMOSTRA_DE_PRODUTOS_SEM_FOTO),
  ]);
  if (amostra.error) throw new Error(`não consegui ler os produtos sem foto: ${amostra.error.message}`);
  return {
    produtos,
    sem_foto: semFoto,
    amostra_sem_foto: ((amostra.data ?? []) as Array<{ codigo: string; nome: string }>).map((p) => ({ codigo: p.codigo, nome: p.nome })),
  };
}

function areaDeFotos(n: NumerosDasFotos): SituacaoDaArea {
  return {
    chave: "fotos_de_produto",
    rotulo: "Fotos de produto",
    pronto: n.produtos > 0 && n.sem_foto < n.produtos ? [`${n.produtos - n.sem_foto} de ${n.produtos} produto(s) ativo(s) com foto.`] : [],
    falta:
      n.sem_foto > 0
        ? [`${n.sem_foto} produto(s) ativo(s) sem foto: o agente os apresenta só com texto. Fotos entram por plataforma_importar_fotos_de_produto.`]
        : [],
    so_pela_tela: ["Reordenar as fotos (a primeira é a capa) e tirar foto: tela Produtos."],
    numeros: { ...n },
  };
}

// ── modelos de proposta ───────────────────────────────────────────────────

export interface NumerosDosModelos {
  propostas_ligadas: boolean;
  modelos_proprios: number;
}

export async function numerosDosModelos(admin: SupabaseClient, orgId: string): Promise<NumerosDosModelos> {
  const [capacidades, modelos] = await Promise.all([
    capacidadesDaOrganizacao(admin, orgId),
    contar(admin.from("proposal_templates").select("id", SO_CONTAR).eq("organization_id", orgId).eq("is_active", true)),
  ]);
  return { propostas_ligadas: capacidades.includes("propostas"), modelos_proprios: modelos };
}

function areaDeModelos(n: NumerosDosModelos): SituacaoDaArea {
  return {
    chave: "modelos_de_proposta",
    rotulo: "Modelos de proposta",
    pronto: n.modelos_proprios > 0 ? [`${n.modelos_proprios} modelo(s) próprio(s) do cliente ativo(s).`] : [],
    falta:
      n.propostas_ligadas && n.modelos_proprios === 0
        ? ["Nenhum modelo próprio. A proposta que o cliente já usa vira modelo por plataforma_importar_modelo_de_proposta."]
        : [],
    so_pela_tela: [
      ...(n.propostas_ligadas ? [] : ["As Propostas estão desligadas neste cliente: liga-se em Configurações › Propostas."]),
      "Revisar o modelo importado antes de usar (as seções foram divididas por IA): Configurações › Propostas › Modelos.",
    ],
    numeros: { ...n },
  };
}

// ── os últimos trabalhos ──────────────────────────────────────────────────

/** As ações de auditoria que são um "trabalho de importação", pela tela ou por MCP. */
const ACOES_DE_IMPORTACAO = [
  "plataforma.importacao",
  "contacts.imported",
  "lead.imported",
  "imports.companies_people",
  "catalog_product.imported",
  "proposal_template.imported",
] as const;

export interface TrabalhoDeImportacao {
  quando: string;
  acao: string;
  por: "mcp_de_plataforma" | "tela";
  tipo: string | null;
  origem: string | null;
  resultado: Record<string, unknown>;
}

/** Só números e textos curtos do `metadata`: a trilha é de contagens, e a resposta também. */
function resultadoDoTrabalho(metadata: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(metadata)) {
    if (chave.startsWith("ids_") || chave === "token_id" || chave === "via" || chave === "tipo" || chave === "origem") continue;
    if (typeof valor === "number" || typeof valor === "boolean") saida[chave] = valor;
    else if (typeof valor === "string" && valor.length <= 80) saida[chave] = valor;
  }
  return saida;
}

export async function ultimosTrabalhos(admin: SupabaseClient, orgId: string): Promise<TrabalhoDeImportacao[]> {
  const { data, error } = await admin
    .from("api_audit_log")
    .select("action, created_at, resource_type, metadata")
    .eq("organization_id", orgId)
    .in("action", [...ACOES_DE_IMPORTACAO])
    .gt("created_at", new Date(Date.now() - DIAS_DE_TRABALHOS * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(ULTIMOS_TRABALHOS);
  if (error) throw new Error(`não consegui ler os trabalhos de importação: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((linha) => {
    const metadata = ehObjeto(linha.metadata) ? linha.metadata : {};
    const porMcp = metadata.via === "mcp_plataforma";
    return {
      quando: String(linha.created_at),
      acao: String(linha.action),
      por: porMcp ? "mcp_de_plataforma" : "tela",
      tipo: typeof metadata.tipo === "string" ? metadata.tipo : typeof linha.resource_type === "string" ? linha.resource_type : null,
      origem: typeof metadata.origem === "string" ? metadata.origem : null,
      resultado: resultadoDoTrabalho(metadata),
    };
  });
}

// ── o que pode ENVIAR depois ──────────────────────────────────────────────

/** Gatilhos de automação que nascem do RELÓGIO, e que por isso alcançam o que foi importado. */
const GATILHOS_DO_RELOGIO = ["lead.silent_for", "lead.stage_stale", "lead.date_field_due", "contact.birthday"] as const;

export interface RegraDoRelogio {
  id: string;
  nome: string;
  gatilho: string;
  acoes: string[];
}

/**
 * As automações ativas que rodam por TEMPO.
 *
 * A importação não dispara nada. Mas uma regra "30 dias na mesma etapa" ou "no
 * aniversário do contato" não nasce de um evento: nasce do relógio, e vale para
 * todo negócio e contato da base, importado ou não. Quem migra precisa ver
 * quais existem ANTES de importar negócios abertos.
 */
export async function regrasDoRelogio(admin: SupabaseClient, orgId: string): Promise<RegraDoRelogio[]> {
  const { data, error } = await admin
    .from("automation_rules")
    .select("id, name, trigger_event, actions")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .in("trigger_event", [...GATILHOS_DO_RELOGIO]);
  if (error) throw new Error(`não consegui ler as automações: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    nome: String(r.name ?? ""),
    gatilho: String(r.trigger_event),
    acoes: Array.isArray(r.actions)
      ? r.actions.map((a) => (ehObjeto(a) && typeof a.type === "string" ? a.type : "?"))
      : [],
  }));
}

// ── as áreas e a ferramenta ───────────────────────────────────────────────

export const AREAS_DE_IMPORTACAO: readonly AreaDeImportacao[] = [
  {
    chave: "empresas",
    rotulo: "Empresas",
    situacao: async (ctx, orgId) => areaDeEmpresas(await numerosDasEmpresas(ctx.admin, orgId)),
  },
  {
    chave: "contatos",
    rotulo: "Contatos",
    situacao: async (ctx, orgId) => areaDeContatos(await numerosDosContatos(ctx.admin, orgId)),
  },
  {
    chave: "negocios",
    rotulo: "Negócios",
    situacao: async (ctx, orgId) => areaDeNegocios(await numerosDosNegocios(ctx.admin, orgId)),
  },
  {
    chave: "conhecimento",
    rotulo: "Base de conhecimento",
    situacao: async (ctx, orgId) => areaDeConhecimento(await numerosDoConhecimento(ctx.admin, orgId)),
  },
  {
    chave: "fotos_de_produto",
    rotulo: "Fotos de produto",
    situacao: async (ctx, orgId) => areaDeFotos(await numerosDasFotos(ctx.admin, orgId)),
  },
  {
    chave: "modelos_de_proposta",
    rotulo: "Modelos de proposta",
    situacao: async (ctx, orgId) => areaDeModelos(await numerosDosModelos(ctx.admin, orgId)),
  },
] as const;

export async function verImportacao(ctx: ContextoDaFerramenta, args: Record<string, unknown>): Promise<unknown> {
  const organizacao = await organizacaoDaImportacao(ctx.admin, args.organization_id);
  const orgId = organizacao.id;

  const [areas, trabalhos, regras] = await Promise.all([
    Promise.all(AREAS_DE_IMPORTACAO.map((area) => area.situacao(ctx, orgId))),
    ultimosTrabalhos(ctx.admin, orgId),
    regrasDoRelogio(ctx.admin, orgId),
  ]);

  return {
    organizacao,
    ordem_da_migracao: "equipe → funis → empresas → contatos → negócios → materiais",
    areas,
    ultimos_trabalhos_de_importacao: trabalhos,
    automacoes_por_tempo_ativas: {
      regras,
      aviso:
        regras.length > 0
          ? "Importar não dispara nada. Estas regras rodam pelo relógio e valem para toda a base, inclusive o que for importado: " +
            "um negócio aberto importado hoje conta os dias a partir de hoje. Confira se alguma delas ENVIA mensagem antes de " +
            "importar negócios abertos, e pause na tela Automações se não for a hora."
          : "Nenhuma automação por tempo ativa neste cliente.",
    },
  };
}

export const FERRAMENTA_VER_IMPORTACAO: FerramentaComExemplo = {
  name: "plataforma_ver_importacao",
  description:
    "O retrato da base de um cliente, para conferir uma migração: quantos contatos (e quantos sem telefone válido, bloqueados e " +
    "vindos de importação), duplicatas suspeitas, empresas, negócios importados por origem (abertos, ganhos e perdidos), os " +
    "materiais da base de conhecimento e a situação da indexação de cada um, produtos sem foto, modelos de proposta, os últimos " +
    "trabalhos de importação dos últimos 90 dias (pela tela e por MCP) com o resultado, e as automações por tempo que estão ativas.\n\n" +
    "Use ANTES de migrar (o que já existe?) e DEPOIS de cada passo (entrou?). Para cada área diz o que está pronto, o que falta " +
    "(com a ferramenta que resolve) e o que só uma pessoa faz, pela tela. A resposta traz contagens e ids, nunca nome, telefone " +
    "ou e-mail de contato.",
  inputSchema: {
    organization_id: z.string().describe("O id do cliente (de plataforma_listar_clientes)."),
  },
  operacao: null,
  exemplo: { organization_id: "00000000-0000-4000-8000-000000000001" },
  handler: verImportacao,
};
