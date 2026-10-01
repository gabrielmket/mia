/**
 * A base das ferramentas de IMPORTAÇÃO: o que as seis têm em comum.
 *
 * ── Para que servem estas ferramentas ─────────────────────────────────────
 *
 * Migrar um cliente de outro CRM para o nosso sem ninguém clicar na tela: um
 * agente lê a base antiga, monta as listas e chama as ferramentas daqui. Por
 * isso tudo o que elas fazem obedece a quatro regras, e as quatro moram neste
 * arquivo:
 *
 *  1. REEXECUÇÃO SEGURA. Toda importação pode ser repetida inteira. Cada item
 *     casa por uma chave natural (telefone, e-mail, CNPJ, id do CRM de origem)
 *     e a resposta diz, item a item, se criou, atualizou, já estava igual ou
 *     recusou. Nada do que não foi mencionado é apagado.
 *  2. UM ITEM RUIM NÃO DERRUBA O LOTE. Os bons entram; os ruins voltam listados,
 *     com a posição, o campo, o que era esperado e um exemplo que passa.
 *  3. NADA É ENVIADO. Importar não manda mensagem, não inscreve em follow-up,
 *     não dispara automação, não registra conversão. Ver `NADA_FOI_ENVIADO`.
 *  4. A AUDITORIA NÃO CARREGA PESSOA. Contagens e ids; nunca nome, telefone ou
 *     e-mail (`lib/mcp-plataforma/importacao/auditoria.ts`).
 *
 * A organização vem como PARÂMETRO (um token serve para vários clientes) e o
 * cliente do banco é o `service_role`, sem RLS embaixo: por isso todo acesso
 * daqui carrega o filtro de organização na mão.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";

import type {
  ContextoDaFerramenta,
  Desfecho,
  ItemDoResultado,
  QuandoJaExiste,
  ResultadoDoLote,
} from "./tipos";

/**
 * A frase que acompanha TODA resposta de importação.
 *
 * Quem lê é o agente que está migrando, e ele precisa repetir isto ao humano
 * sem ter de inferir: a pergunta "vocês mandaram mensagem para a minha base?"
 * é a primeira que o dono da base faz.
 */
export const NADA_FOI_ENVIADO =
  "Importar só grava. Nenhuma mensagem foi enviada, ninguém foi inscrito em follow-up, " +
  "nenhuma automação foi disparada e nenhuma conversão foi registrada para as plataformas de anúncio.";

/** Uma recusa da CHAMADA inteira (organização errada, lista malformada). */
export class RecusaDaImportacao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "RecusaDaImportacao";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pareceUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor.trim());
}

export interface OrganizacaoDaImportacao {
  id: string;
  nome: string;
  demonstracao: boolean;
}

/**
 * A organização alvo, ou a recusa que diz como achar o id certo.
 *
 * É o primeiro passo de toda ferramenta daqui: com `service_role`, um id errado
 * não esbarra em RLS nenhuma. Sem esta leitura, a importação inteira falharia
 * item a item numa chave estrangeira, com a mensagem crua do banco.
 *
 * A empresa de DEMONSTRAÇÃO é aceita: importar nela é gravar dado fictício, e a
 * importação não envia nada em empresa nenhuma.
 */
export async function organizacaoDaImportacao(
  admin: SupabaseClient,
  organizationId: unknown,
): Promise<OrganizacaoDaImportacao> {
  if (!pareceUuid(organizationId)) {
    throw new RecusaDaImportacao(
      "`organization_id` precisa ser o id do cliente, no formato " +
        "00000000-0000-4000-8000-000000000000. Use plataforma_listar_clientes para achar o id.",
    );
  }
  const { data, error } = await admin
    .from("organizations")
    .select("id, display_name, demonstracao")
    .eq("id", organizationId.trim())
    .maybeSingle();
  if (error) throw new Error(`não consegui ler a organização: ${error.message}`);
  if (!data) {
    throw new RecusaDaImportacao(
      `Não existe organização com o id ${organizationId}. ` +
        "Use plataforma_listar_clientes para achar o id certo, ou plataforma_criar_cliente para criar o cliente.",
    );
  }
  const linha = data as { id: string; display_name: string | null; demonstracao?: boolean | null };
  return {
    id: linha.id,
    // É o nome da ORGANIZAÇÃO, não de um contato. Escrito sem o operador de
    // coalescência porque a cerca do rótulo do contato lê essa forma como a
    // cadeia de nome de contato montada à mão.
    nome: typeof linha.display_name === "string" ? linha.display_name : "",
    demonstracao: linha.demonstracao === true,
  };
}

/** A correlação da chamada: a do servidor quando ele a entrega, ou uma nova. */
export function requestIdDe(ctx: ContextoDaFerramenta): string {
  const doServidor = (ctx as { requestId?: unknown }).requestId;
  return typeof doServidor === "string" && doServidor ? doServidor : randomUUID();
}

// ── leitura dos argumentos ────────────────────────────────────────────────

/** Texto aparado, ou `null` quando não veio nada que se aproveite. */
export function texto(valor: unknown, maximo = 4000): string | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor).slice(0, maximo);
  if (typeof valor !== "string") return null;
  const aparado = valor.trim();
  return aparado ? aparado.slice(0, maximo) : null;
}

export function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * A lista de itens de uma chamada, ou a recusa que ensina o formato.
 *
 * O teto é conferido AQUI e não só no schema: a mensagem de quem valida schema
 * diz "too big", e o que o agente precisa ler é "divida em mais chamadas".
 */
export function listaDeItens(
  args: Record<string, unknown>,
  chave: string,
  teto: number,
  exemplo: Record<string, unknown>,
): unknown[] {
  const bruto = args[chave];
  if (!Array.isArray(bruto) || bruto.length === 0) {
    throw new RecusaDaImportacao(
      `\`${chave}\` precisa ser uma lista com pelo menos 1 item. Nada foi gravado.\n\n` +
        `Exemplo de um item válido:\n${JSON.stringify(exemplo, null, 2)}`,
    );
  }
  if (bruto.length > teto) {
    throw new RecusaDaImportacao(
      `\`${chave}\` veio com ${bruto.length} itens e o teto é ${teto} por chamada. Nada foi gravado. ` +
        `Divida a lista em chamadas de até ${teto} itens: a importação pode ser repetida e continuada sem duplicar.`,
    );
  }
  return bruto;
}

/** `completar` é o padrão: é o modo que nunca troca um valor que já existe. */
export function modoQuandoJaExiste(valor: unknown): QuandoJaExiste {
  if (valor === undefined || valor === null || valor === "") return "completar";
  if (valor === "completar" || valor === "atualizar") return valor;
  throw new RecusaDaImportacao(
    '`quando_ja_existe` aceita "completar" (só preenche o que está vazio; é o padrão) ou ' +
      '"atualizar" (o que veio preenchido substitui o que havia). Nada foi gravado.',
  );
}

const ORIGEM = /^[a-z0-9][a-z0-9_-]{1,39}$/;

/**
 * O nome do CRM de origem, na forma em que ele é gravado.
 *
 * É metade da chave de reexecução dos negócios (`origem` + `id_de_origem`), e
 * por isso é recusado quando não está na forma: "RD Station" e "rdstation"
 * seriam duas origens, e a segunda rodada duplicaria a base.
 */
export function origemDaImportacao(valor: unknown, obrigatoria: boolean): string | null {
  const bruto = texto(valor, 80);
  if (!bruto) {
    if (!obrigatoria) return null;
    throw new RecusaDaImportacao(
      "`origem` é obrigatória: o nome do sistema de onde a base vem, em minúsculas, sem espaço " +
        '(ex.: "rdstation", "pipedrive", "planilha"). Use SEMPRE o mesmo nome nas reexecuções: ' +
        "é metade da chave que impede duplicar. Nada foi gravado.",
    );
  }
  const normalizada = bruto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!ORIGEM.test(normalizada)) {
    throw new RecusaDaImportacao(
      `\`origem\` "${bruto}" não serve como nome de sistema. Use de 2 a 40 letras minúsculas, números, ` +
        'hífen ou sublinhado (ex.: "rdstation", "pipedrive", "planilha"). Nada foi gravado.',
    );
  }
  return normalizada;
}

/** O valor de `source` de tudo o que nasce de uma importação por MCP. */
export const PREFIXO_DA_ORIGEM = "importacao:";

export function sourceDaImportacao(origem: string | null): string {
  return `${PREFIXO_DA_ORIGEM}${origem ?? "mcp"}`;
}

// ── o resultado de um lote ────────────────────────────────────────────────

export class Coletor {
  private readonly itens: ItemDoResultado[] = [];

  registrar(posicao: number, desfecho: Desfecho, extra: { id?: string; avisos?: string[] } = {}): void {
    this.itens.push({
      posicao,
      desfecho,
      ...(extra.id ? { id: extra.id } : {}),
      ...(extra.avisos && extra.avisos.length > 0 ? { avisos: extra.avisos } : {}),
    });
  }

  /**
   * A recusa de UM item: posição, campo, o que era esperado e um exemplo.
   *
   * O texto é montado aqui para as seis ferramentas recusarem do mesmo jeito.
   */
  recusar(posicao: number, campo: string, esperado: string, exemplo?: string): void {
    this.itens.push({
      posicao,
      desfecho: "recusou",
      motivo:
        `Item ${posicao}, campo \`${campo}\`: ${esperado}` + (exemplo ? ` Exemplo que passa: ${exemplo}` : ""),
    });
  }

  ids(desfecho: Desfecho): string[] {
    return this.itens.filter((i) => i.desfecho === desfecho && i.id).map((i) => i.id as string);
  }

  contar(desfecho: Desfecho): number {
    return this.itens.filter((i) => i.desfecho === desfecho).length;
  }

  resultado(organizacao: OrganizacaoDaImportacao): ResultadoDoLote {
    const ordenados = [...this.itens].sort((a, b) => a.posicao - b.posicao);
    return {
      organizacao,
      total: ordenados.length,
      criou: this.contar("criou"),
      atualizou: this.contar("atualizou"),
      ja_estava: this.contar("ja_estava"),
      recusou: this.contar("recusou"),
      itens: ordenados,
      nada_foi_enviado: NADA_FOI_ENVIADO,
    };
  }
}

// ── o rastro ──────────────────────────────────────────────────────────────

/** Quantos ids uma linha de auditoria carrega. O resto fica só na contagem. */
const TETO_DE_IDS_NA_AUDITORIA = 200;

/**
 * UMA linha de auditoria por chamada de importação, dentro da organização.
 *
 * É o "trabalho de importação" que `plataforma_ver_importacao` lista depois.
 * Carrega CONTAGENS E IDS, e mais nada: o nome, o telefone e o e-mail de quem
 * foi importado estão na base, sob o controle de acesso dela, e não precisam
 * de uma segunda cópia numa trilha que é lida por mais gente.
 */
export async function registrarImportacao(
  ctx: ContextoDaFerramenta,
  entrada: {
    organizacao: OrganizacaoDaImportacao;
    ferramenta: string;
    tipo: string;
    origem: string | null;
    coletor: Coletor;
    requestId: string;
    extra?: Record<string, unknown>;
  },
): Promise<void> {
  const { coletor } = entrada;
  await audit({
    action: "plataforma.importacao",
    actorUserId: ctx.autorUserId,
    organizationId: entrada.organizacao.id,
    resourceType: entrada.tipo,
    resourceId: null,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    requestId: entrada.requestId,
    metadata: {
      via: "mcp_plataforma",
      ferramenta: entrada.ferramenta,
      tipo: entrada.tipo,
      origem: entrada.origem,
      token_id: ctx.tokenId,
      total: coletor.contar("criou") + coletor.contar("atualizou") + coletor.contar("ja_estava") + coletor.contar("recusou"),
      criou: coletor.contar("criou"),
      atualizou: coletor.contar("atualizou"),
      ja_estava: coletor.contar("ja_estava"),
      recusou: coletor.contar("recusou"),
      ids_criados: coletor.ids("criou").slice(0, TETO_DE_IDS_NA_AUDITORIA),
      ids_atualizados: coletor.ids("atualizou").slice(0, TETO_DE_IDS_NA_AUDITORIA),
      ...(entrada.extra ?? {}),
    },
  });
}

// ── comparação ────────────────────────────────────────────────────────────

/**
 * Minúsculas, sem acento e sem espaço sobrando: o que uma pessoa lê como "o
 * mesmo nome". A mesma conta de `chaveDeNome` (`lib/leads/stage-editing.ts`),
 * que é a régua do produto para nome de funil e de etapa.
 */
export function chaveDoNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Lista para uma frase: "a, b e c". Corta em `teto` para não virar parede. */
export function emFrase(nomes: readonly string[], teto = 12): string {
  if (nomes.length === 0) return "(nenhum)";
  const visiveis = nomes.slice(0, teto).map((n) => `"${n}"`);
  const resto = nomes.length - visiveis.length;
  return visiveis.join(", ") + (resto > 0 ? ` e mais ${resto}` : "");
}

/** Soma etiquetas sem repetir, preservando a ordem das que já estavam. */
export function somarEtiquetas(atuais: readonly string[], novas: readonly string[]): string[] {
  const vistas = new Set(atuais);
  const saida = [...atuais];
  for (const etiqueta of novas) {
    if (vistas.has(etiqueta)) continue;
    vistas.add(etiqueta);
    saida.push(etiqueta);
  }
  return saida;
}

/** Igualdade de conteúdo de dois valores de jsonb, sem depender da ordem das chaves. */
export function mesmoValor(a: unknown, b: unknown): boolean {
  return estavel(a) === estavel(b);
}

function estavel(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(estavel).join(",")}]`;
  if (ehObjeto(valor)) {
    return `{${Object.keys(valor)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${estavel(valor[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(valor ?? null);
}

/**
 * Uma data que veio de outro sistema, em ISO. `null` quando não é data.
 *
 * Aceita ISO (`2026-03-14`, `2026-03-14T10:00:00Z`) e o formato brasileiro
 * (`14/03/2026`), que é como toda exportação de planilha traz. Data sem hora
 * vira meio-dia UTC: à meia-noite UTC ela cairia no dia anterior no fuso de
 * Brasília, e o negócio ganho em 1º de março apareceria em fevereiro.
 */
export function dataDeOrigem(valor: unknown): string | null {
  const bruto = texto(valor, 40);
  if (!bruto) return null;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(bruto);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : bruto;
  const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (soData) {
    const [ano, mes, dia] = [Number(soData[1]), Number(soData[2]), Number(soData[3])];
    const d = new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0));
    const real = d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
    return real ? d.toISOString() : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}[T ]/.test(iso)) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── a validação do schema da TELA, dita para quem migra ───────────────────

interface ProblemaDoSchema {
  code?: string;
  path: ReadonlyArray<PropertyKey>;
  message: string;
  origin?: string;
  maximum?: unknown;
  minimum?: unknown;
  expected?: unknown;
  format?: unknown;
}

const TIPOS: Record<string, string> = {
  string: "texto",
  number: "número",
  int: "número inteiro",
  boolean: "verdadeiro ou falso",
  array: "lista",
  object: "objeto",
};

/**
 * Um problema apontado pelo schema que a TELA usa, na frase de uma recusa.
 *
 * A importação valida cada item com o MESMO schema do cadastro pela tela
 * (`contactCreateSchema`, `empresaCreateSchema`, `createLeadSchema`), para não
 * existir uma segunda régua do que é um contato válido. O preço é que a
 * mensagem do validador fala inglês e cita o nome da COLUNA. Aqui ela vira o
 * nome do campo como a ferramenta o chama e uma frase em português.
 */
export function explicarProblemaDoSchema(
  problema: ProblemaDoSchema,
  nomeDoCampo: Record<string, string>,
): { campo: string; esperado: string } {
  const coluna = String(problema.path[0] ?? "item");
  const campo = nomeDoCampo[coluna] ?? coluna;
  const propria = /^(Invalid|Too |Unrecognized|Expected)/i.test(problema.message) ? null : problema.message;

  switch (problema.code) {
    case "too_big":
      return {
        campo,
        esperado:
          problema.origin === "array"
            ? `aceita no máximo ${String(problema.maximum)} itens.`
            : problema.origin === "string"
              ? `aceita no máximo ${String(problema.maximum)} caracteres.`
              : `pode ser no máximo ${String(problema.maximum)}.`,
      };
    case "too_small":
      return {
        campo,
        esperado:
          problema.origin === "string"
            ? `precisa de pelo menos ${String(problema.minimum)} caractere(s).`
            : `precisa ser no mínimo ${String(problema.minimum)}.`,
      };
    case "invalid_type":
      return { campo, esperado: `deveria ser ${TIPOS[String(problema.expected)] ?? String(problema.expected)}.` };
    default:
      return { campo, esperado: propria ?? "o valor não está no formato esperado." };
  }
}

// ── leitura em páginas ────────────────────────────────────────────────────

/** Linhas por página. O PostgREST corta em `max-rows` (1000 por padrão no Supabase). */
export const TAMANHO_DA_PAGINA = 1000;

/**
 * Lê uma tabela INTEIRA de uma organização, em páginas por `id`.
 *
 * ⚠️ Um `select` sem paginar devolve no máximo `max-rows` linhas, sem erro. A
 * deduplicação que confiasse numa leitura só acharia "não existe" para a
 * empresa de número 1001 e criaria a duplicata que ela existe para impedir.
 *
 * O laço só para quando uma página volta VAZIA: parar em "veio menos que o
 * pedido" quebraria numa instalação com `max-rows` menor que a página.
 */
export async function lerEmPaginas<T extends { id: string }>(
  pagina: (depoisDoId: string | null) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  tetoDeLinhas = 50_000,
): Promise<T[]> {
  const todas: T[] = [];
  let depoisDoId: string | null = null;
  while (todas.length < tetoDeLinhas) {
    const { data, error } = await pagina(depoisDoId);
    if (error) throw new Error(`não consegui ler a base da organização: ${error.message}`);
    const linhas = (data ?? []) as T[];
    if (linhas.length === 0) break;
    todas.push(...linhas);
    depoisDoId = linhas[linhas.length - 1]!.id;
  }
  return todas;
}
