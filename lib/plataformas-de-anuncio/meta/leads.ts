/**
 * FORK MIA — LER OS LEADS DOS FORMULÁRIOS DA META (cadastro instantâneo).
 *
 * Mora na fronteira do eixo de anúncio (`lib/plataformas-de-anuncio/`), que é o
 * único lugar, com `lib/channels/`, onde o host da Graph pode ser nomeado
 * (`pnpm lint:channels`). Quem usa isto é `lib/leads-da-meta/`, que não sabe do
 * fio. Plano inteiro em docs/fork/leads-da-meta.md.
 *
 * ─── As quatro leituras ────────────────────────────────────────────────────
 *
 *   me/permissions             o que o token da empresa tem (diagnóstico da tela)
 *   me/accounts                as Páginas atribuídas ao usuário do sistema, cada
 *                              uma com o SEU token de Página
 *   {pagina}/leadgen_forms     os formulários da Página
 *   {formulario}/leads         os leads, filtrados por `time_created`
 *   {lead}                     UM lead, pelo id que o aviso em tempo real traz (.62)
 *
 * E uma escrita (.62): `{pagina}/subscribed_apps` assina a Página no app para o
 * campo `leadgen`, que é o que faz a Meta avisar na hora em que alguém preenche.
 *
 * As que leem formulário e lead usam o token DA PÁGINA, derivado do token da empresa a cada
 * rodada e nunca guardado: a Meta pede token de Página (ou de quem anuncia na
 * Página) para ler formulários e leads, e derivar na hora evita guardar um
 * segundo segredo que vence em silêncio.
 *
 * ─── O token vai no cabeçalho, sempre ──────────────────────────────────────
 *
 * Nunca na URL (CLAUDE.md, anti-pattern 12). A paginação também não segue o
 * `paging.next` cru, que a Meta devolve com o token embutido na query: a próxima
 * página é a MESMA URL com o cursor `after`, montada aqui.
 *
 * ─── A origem do anúncio pode faltar, e o lead entra mesmo assim ───────────
 *
 * A Meta devolve `ad_id`, `adset_id` e `campaign_id` de cada lead só para token
 * com permissão de anúncios (`ads_management`, segundo a documentação). Sem ela, o
 * pedido COM esses campos é recusado inteiro. Perder o lead por causa da origem
 * seria trocar o principal pelo acessório: a leitura repete UMA vez sem os campos
 * do anúncio, o lead entra sem a origem e a leitura carrega a ressalva, que a tela
 * mostra. Mesma figura da repetição do Connect rate em `insights.ts`.
 */
import { logger } from "@/lib/logger";

import type { FalhaDeLeitura, ResultadoDeLeitura } from "../types";
import { classificarErroGraph, montarUrl } from "./insights";

const TEMPO_LIMITE_MS = 20_000;

/** 100 por página × 50 páginas = 5.000 leads por formulário numa janela. */
export const LEADS_POR_PAGINA = 100;
export const MAXIMO_DE_PAGINAS_DE_LEADS = 50;

/**
 * As permissões que a leitura dos leads exige, e as que só enriquecem.
 * A tela compara com `me/permissions` e diz qual falta.
 */
export const PERMISSOES_OBRIGATORIAS = [
  "leads_retrieval",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_ads",
] as const;

/** O campo do webhook da Página que avisa lead novo (.62). */
export const CAMPO_DO_AVISO_DE_LEAD = "leadgen";

/** A permissão que a assinatura da Página no app pede ao token (.62). */
export const PERMISSAO_DO_TEMPO_REAL = "pages_manage_metadata";

/**
 * Sem estas o lead entra, mas sem a origem do anúncio, sem a tabela de
 * campanhas, ou só pela leitura a cada 5 minutos: `pages_manage_metadata` é a
 * que deixa assinar a Página no app para o aviso em tempo real (.62).
 */
export const PERMISSOES_RECOMENDADAS = [
  "ads_management",
  "ads_read",
  PERMISSAO_DO_TEMPO_REAL,
] as const;

const CAMPOS_DO_ANUNCIO = [
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "campaign_id",
  "campaign_name",
];
const CAMPOS_DO_LEAD = ["id", "created_time", "form_id", "field_data", "is_organic", "platform"];

/** A frase da ressalva quando a origem do anúncio não veio. */
export const AVISO_SEM_ORIGEM_DO_ANUNCIO =
  "A Meta não devolveu a origem do anúncio (campanha, conjunto e anúncio) destes leads. Eles entraram mesmo assim. Para ter a origem, gere o token de novo com a permissão ads_management.";

interface ErroGraph {
  error?: { code?: number; error_subcode?: number; message?: string };
}

interface RespostaPaginada<T> {
  data?: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

/**
 * A classificação do eixo, com UMA diferença para leads: código 100 com
 * subcódigo 33 ("o objeto não existe ou não pode ser carregado por falta de
 * permissão") é o que a Meta responde quando o formulário ou a Página não está ao
 * alcance do token — por exemplo, o Acesso a leads do Gerenciador não inclui o
 * usuário do sistema. Tratar como "campo inválido" mandaria avisar o suporte do
 * sistema; o conserto é na Meta, por quem administra a Página.
 */
export function classificarErroDeLeads(
  status: number,
  codigo: number | null,
  subcodigo: number | null,
): FalhaDeLeitura {
  if (codigo === 100 && subcodigo === 33) return "permissao_insuficiente";
  return classificarErroGraph(status, codigo);
}

type ResultadoDaBusca<T> = ResultadoDeLeitura<{ itens: T[]; truncado: boolean }>;

/** A recusa da Graph, classificada. Nem a URL nem o token entram no log. */
function recusa(
  status: number,
  texto: string,
  contexto: string,
): { ok: false; falha: FalhaDeLeitura; detalhe: string } {
  let codigo: number | null = null;
  let subcodigo: number | null = null;
  let mensagem = texto.slice(0, 300);
  try {
    const json = JSON.parse(texto) as ErroGraph;
    if (typeof json.error?.code === "number") codigo = json.error.code;
    if (typeof json.error?.error_subcode === "number") subcodigo = json.error.error_subcode;
    if (json.error?.message) mensagem = json.error.message.slice(0, 300);
  } catch {
    // Corpo não-JSON num erro é gateway no meio. Fica o texto cru, cortado.
  }
  const falha = classificarErroDeLeads(status, codigo, subcodigo);
  logger.warn("[ads.meta.leads] leitura recusada", {
    contexto,
    status,
    codigo,
    subcodigo,
    falha,
  });
  return { ok: false, falha, detalhe: mensagem };
}

/**
 * UMA chamada que devolve um objeto (não uma lista): o lead pelo id e a
 * assinatura da Página (.62). Token no cabeçalho, como em todo o resto; o corpo
 * do POST vai como formulário, que é o que a Graph lê.
 */
async function requisitar<T>(
  metodo: "GET" | "POST",
  caminho: string,
  parametros: Record<string, string>,
  token: string,
  contexto: string,
): Promise<ResultadoDeLeitura<T>> {
  const ehPost = metodo === "POST";
  const url = montarUrl(caminho, ehPost ? {} : parametros);
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: metodo,
      headers: {
        authorization: `Bearer ${token}`,
        ...(ehPost ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(ehPost ? { body: new URLSearchParams(parametros).toString() } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch (erro) {
    return {
      ok: false,
      falha: "transitorio",
      detalhe: erro instanceof Error ? erro.message : "falha de rede",
    };
  }
  const texto = await resposta.text().catch(() => "");
  if (!resposta.ok) return recusa(resposta.status, texto, contexto);
  try {
    return { ok: true, dados: JSON.parse(texto) as T };
  } catch {
    return { ok: false, falha: "transitorio", detalhe: "resposta ilegível da plataforma" };
  }
}

/**
 * GET paginado pelo cursor `after`. `truncado` diz que havia mais páginas do que
 * o teto — quem chama decide o que isso significa (para leads, leitura incompleta).
 */
async function buscarPaginado<T>(
  caminho: string,
  parametros: Record<string, string>,
  token: string,
  contexto: string,
  maximoDePaginas: number,
): Promise<ResultadoDaBusca<T>> {
  const itens: T[] = [];
  let depois: string | null = null;

  for (let pagina = 0; pagina < maximoDePaginas; pagina += 1) {
    const url = montarUrl(caminho, depois ? { ...parametros, after: depois } : parametros);

    let resposta: Response;
    try {
      resposta = await fetch(url, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      });
    } catch (erro) {
      return {
        ok: false,
        falha: "transitorio",
        detalhe: erro instanceof Error ? erro.message : "falha de rede",
      };
    }

    const texto = await resposta.text().catch(() => "");

    if (!resposta.ok) return recusa(resposta.status, texto, contexto);

    let json: RespostaPaginada<T>;
    try {
      json = JSON.parse(texto) as RespostaPaginada<T>;
    } catch {
      return { ok: false, falha: "transitorio", detalhe: "resposta ilegível da plataforma" };
    }

    itens.push(...(json.data ?? []));
    const proximo = json.paging?.next ? (json.paging.cursors?.after ?? null) : null;
    if (!proximo) return { ok: true, dados: { itens, truncado: false } };
    depois = proximo;
  }

  return { ok: true, dados: { itens, truncado: true } };
}

// ─── me/permissions ─────────────────────────────────────────────────────────

/** As permissões CONCEDIDAS ao token (as recusadas e vencidas ficam de fora). */
export async function lerPermissoes(token: string): Promise<ResultadoDeLeitura<string[]>> {
  const r = await buscarPaginado<{ permission?: string; status?: string }>(
    "me/permissions",
    { limit: "200" },
    token,
    "permissions",
    3,
  );
  if (!r.ok) return r;
  return {
    ok: true,
    dados: r.dados.itens
      .filter((p) => p.status === "granted" && typeof p.permission === "string")
      .map((p) => p.permission as string),
  };
}

// ─── me ─────────────────────────────────────────────────────────────────────

/**
 * FORK MIA (.64) — de QUEM é o token: o id do usuário (ou usuário do sistema)
 * na Meta. Tokens diferentes do mesmo usuário do sistema devolvem o mesmo id.
 *
 * É o que separa a conta própria de uma empresa da conta da agência colada nela
 * (`lib/leads-da-meta/autoatendimento.ts`): o token da agência alcança as
 * Páginas de todos os clientes, e deixá-lo escolher Página seria reabrir o que a
 * 9004 fechou.
 */
export async function lerIdentidade(token: string): Promise<ResultadoDeLeitura<string>> {
  const r = await requisitar<{ id?: unknown }>("GET", "me", { fields: "id" }, token, "identidade");
  if (!r.ok) return r;
  if (typeof r.dados.id !== "string" || r.dados.id === "") {
    return { ok: false, falha: "transitorio", detalhe: "a Meta não devolveu o id do token" };
  }
  return { ok: true, dados: r.dados.id };
}

// ─── me/accounts ────────────────────────────────────────────────────────────

export interface PaginaDoToken {
  id: string;
  nome: string;
  /** O token da Página. `null` quando a Meta não o devolve (falta de tarefa na Página). */
  tokenDaPagina: string | null;
  tarefas: string[];
}

/** As Páginas que o token alcança, cada uma com o token dela. */
export async function listarPaginas(token: string): Promise<ResultadoDeLeitura<PaginaDoToken[]>> {
  const r = await buscarPaginado<{
    id?: string;
    name?: string;
    access_token?: string;
    tasks?: string[];
  }>("me/accounts", { fields: "id,name,access_token,tasks", limit: "100" }, token, "accounts", 10);
  if (!r.ok) return r;
  return {
    ok: true,
    dados: r.dados.itens
      .filter((p): p is typeof p & { id: string } => typeof p.id === "string" && p.id !== "")
      .map((p) => ({
        id: p.id,
        nome: p.name ?? p.id,
        tokenDaPagina: typeof p.access_token === "string" && p.access_token ? p.access_token : null,
        tarefas: Array.isArray(p.tasks) ? p.tasks.filter((t) => typeof t === "string") : [],
      })),
  };
}

// ─── {pagina}/leadgen_forms ─────────────────────────────────────────────────

export interface FormularioDaPagina {
  id: string;
  nome: string;
  /** `ACTIVE`, `ARCHIVED`, … como a Meta devolve. */
  status: string | null;
  /** chave da pergunta → texto da pergunta. */
  perguntas: Record<string, string>;
}

export async function listarFormularios(
  tokenDaPagina: string,
  paginaId: string,
): Promise<ResultadoDeLeitura<FormularioDaPagina[]>> {
  const r = await buscarPaginado<{
    id?: string;
    name?: string;
    status?: string;
    questions?: Array<{ key?: string; label?: string }>;
  }>(
    `${encodeURIComponent(paginaId)}/leadgen_forms`,
    { fields: "id,name,status,questions", limit: "100" },
    tokenDaPagina,
    "leadgen_forms",
    10,
  );
  if (!r.ok) return r;
  return {
    ok: true,
    dados: r.dados.itens
      .filter((f): f is typeof f & { id: string } => typeof f.id === "string" && f.id !== "")
      .map((f) => {
        const perguntas: Record<string, string> = {};
        for (const q of f.questions ?? []) {
          if (q.key && q.label) perguntas[q.key] = q.label;
        }
        return { id: f.id, nome: f.name ?? f.id, status: f.status ?? null, perguntas };
      }),
  };
}

// ─── {formulario}/leads ─────────────────────────────────────────────────────

/** Um lead como a Meta devolve. Tudo opcional: o fio não promete nada. */
export interface LeadCru {
  id?: string;
  created_time?: string;
  form_id?: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  is_organic?: boolean;
  platform?: string;
  field_data?: Array<{ name?: string; values?: unknown[] }>;
}

export interface LeadsDaJanela {
  leads: LeadCru[];
  /** Havia mais leads do que o teto de páginas: a janela NÃO foi lida inteira. */
  truncado: boolean;
}

function filtroDaJanela(de: Date, ate: Date): string {
  const s = (d: Date) => Math.floor(d.getTime() / 1000);
  return JSON.stringify([
    { field: "time_created", operator: "GREATER_THAN", value: s(de) - 1 },
    { field: "time_created", operator: "LESS_THAN", value: s(ate) + 1 },
  ]);
}

/**
 * Os leads criados na janela `[de, ate]` (as duas pontas incluídas). Repete uma
 * vez sem os campos do anúncio quando a Meta recusa o pedido por permissão ou por
 * campo — ver o cabeçalho.
 */
export async function lerLeadsDoFormulario(
  tokenDaPagina: string,
  formularioId: string,
  janela: { de: Date; ate: Date },
): Promise<ResultadoDeLeitura<LeadsDaJanela>> {
  const caminho = `${encodeURIComponent(formularioId)}/leads`;
  const base = {
    filtering: filtroDaJanela(janela.de, janela.ate),
    limit: String(LEADS_POR_PAGINA),
  };

  const completo = await buscarPaginado<LeadCru>(
    caminho,
    { ...base, fields: [...CAMPOS_DO_LEAD, ...CAMPOS_DO_ANUNCIO].join(",") },
    tokenDaPagina,
    "leads",
    MAXIMO_DE_PAGINAS_DE_LEADS,
  );
  if (completo.ok) {
    return { ok: true, dados: { leads: completo.dados.itens, truncado: completo.dados.truncado } };
  }
  if (completo.falha !== "permissao_insuficiente" && completo.falha !== "campo_invalido") {
    return completo;
  }

  const semAnuncio = await buscarPaginado<LeadCru>(
    caminho,
    { ...base, fields: CAMPOS_DO_LEAD.join(",") },
    tokenDaPagina,
    "leads_sem_anuncio",
    MAXIMO_DE_PAGINAS_DE_LEADS,
  );
  // A repetição também recusou: o problema não era a origem do anúncio. Vale a
  // recusa ORIGINAL, que é a que descreve o pedido que a tela promete.
  if (!semAnuncio.ok) return completo;

  logger.warn("[ads.meta.leads] leads lidos SEM a origem do anúncio", {
    motivo: completo.detalhe.slice(0, 200),
  });
  return {
    ok: true,
    dados: { leads: semAnuncio.dados.itens, truncado: semAnuncio.dados.truncado },
    aviso: AVISO_SEM_ORIGEM_DO_ANUNCIO,
  };
}

// ─── {lead}: um lead só, pelo id (.62) ──────────────────────────────────────

/**
 * UM lead, pelo id que o aviso em tempo real (webhook `leadgen`) traz. O aviso
 * não traz as respostas, só os ids: nome, telefone e perguntas vêm daqui.
 *
 * A mesma repetição sem os campos do anúncio de `lerLeadsDoFormulario`: perder o
 * lead por causa da origem seria trocar o principal pelo acessório.
 */
export async function lerLead(
  tokenDaPagina: string,
  leadgenId: string,
): Promise<ResultadoDeLeitura<LeadCru>> {
  const caminho = encodeURIComponent(leadgenId);
  const completo = await requisitar<LeadCru>(
    "GET",
    caminho,
    { fields: [...CAMPOS_DO_LEAD, ...CAMPOS_DO_ANUNCIO].join(",") },
    tokenDaPagina,
    "lead",
  );
  if (completo.ok) return completo;
  if (completo.falha !== "permissao_insuficiente" && completo.falha !== "campo_invalido") {
    return completo;
  }
  const semAnuncio = await requisitar<LeadCru>(
    "GET",
    caminho,
    { fields: CAMPOS_DO_LEAD.join(",") },
    tokenDaPagina,
    "lead_sem_anuncio",
  );
  if (!semAnuncio.ok) return completo;
  return { ok: true, dados: semAnuncio.dados, aviso: AVISO_SEM_ORIGEM_DO_ANUNCIO };
}

// ─── {pagina}/subscribed_apps: o aviso em tempo real (.62) ──────────────────

export interface AssinaturaDaPagina {
  /** A Página já estava assinada para `leadgen`: nada foi escrito na Meta. */
  jaEstava: boolean;
}

interface AppAssinadoCru {
  id?: string;
  subscribed_fields?: unknown[];
}

/**
 * Assina a Página no app para o campo `leadgen`: sem isto a Meta não avisa, e o
 * lead só entra pela leitura a cada 5 minutos.
 *
 * ─── Por que ler antes de escrever ─────────────────────────────────────────
 *
 * O POST SUBSTITUI a lista de campos do app naquela Página. Se o app já tiver
 * outro campo assinado ali, mandar só `leadgen` o apagaria em silêncio. Então:
 * já assinada para `leadgen`, nada é escrito; um app só na lista (o do token de
 * Página, que é o nosso), os campos dele entram junto; lista ilegível ou com
 * vários apps, vai só `leadgen`, porque não há como saber qual é o nosso.
 *
 * ─── A recusa que importa ──────────────────────────────────────────────────
 *
 * Sem `pages_manage_metadata` no token a Meta responde 200 ("permissão"), que
 * sai daqui como `permissao_insuficiente`. Quem chama grava o motivo e a tela
 * diz qual permissão falta. O lead continua entrando pela leitura.
 */
export async function assinarLeadsDaPagina(
  tokenDaPagina: string,
  paginaId: string,
): Promise<ResultadoDeLeitura<AssinaturaDaPagina>> {
  const caminho = `${encodeURIComponent(paginaId)}/subscribed_apps`;

  const atual = await requisitar<{ data?: AppAssinadoCru[] }>(
    "GET",
    caminho,
    {},
    tokenDaPagina,
    "subscribed_apps",
  );
  let existentes: string[] = [];
  if (atual.ok) {
    const apps = Array.isArray(atual.dados.data) ? atual.dados.data : [];
    const camposDe = (app: AppAssinadoCru) =>
      (Array.isArray(app.subscribed_fields) ? app.subscribed_fields : []).filter(
        (c): c is string => typeof c === "string" && c !== "",
      );
    if (apps.some((app) => camposDe(app).includes(CAMPO_DO_AVISO_DE_LEAD))) {
      return { ok: true, dados: { jaEstava: true } };
    }
    if (apps.length === 1) existentes = camposDe(apps[0]!);
  }

  const campos = [...new Set([...existentes, CAMPO_DO_AVISO_DE_LEAD])].join(",");
  const escrita = await requisitar<{ success?: boolean }>(
    "POST",
    caminho,
    { subscribed_fields: campos },
    tokenDaPagina,
    "subscribed_apps_escrita",
  );
  if (!escrita.ok) return escrita;
  if (escrita.dados.success !== true) {
    return {
      ok: false,
      falha: "transitorio",
      detalhe: "A Meta respondeu sem confirmar a assinatura da Página.",
    };
  }
  return { ok: true, dados: { jaEstava: false } };
}
