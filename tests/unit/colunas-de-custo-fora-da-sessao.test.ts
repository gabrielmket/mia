/**
 * FORK MIA (MIA-251 G) · A SESSÃO NÃO LÊ CUSTO, TOKENS, PROVEDOR NEM MODELO DE IA.
 *
 * Desde a migration 9175, `authenticated` lê `llm_calls`, `agent_turn_traces` e
 * `ai_agent_runs` coluna por coluna, sem o custo, os tokens, o provedor e o
 * modelo (`lib/ai/colunas-de-ia-fechadas.ts`, a mesma regra de
 * `fn_mia_colunas_de_ia_fechadas()`). Leitor que peça essas colunas pela sessão
 * recebe 42501 em produção e a rota responde 500, calada para quem escreveu (o
 * teste de rota mocka o cliente). Esta cerca é a metade do código:
 *
 *   1. `select` nessas tabelas por cliente que não é o admin, provado pela ORIGEM
 *      ou pelo TIPO (o resolvedor de `./helpers/cliente-admin`), não pode pedir
 *      coluna fechada nem `*` (`select()` sem argumento também é `*`);
 *   2. filtro ou ordem por coluna fechada (`eq("provider")`, `gt("input_tokens")`,
 *      `or("provider.eq…")`, `order("cost_cents")`) também exige o cliente admin:
 *      o banco pede SELECT na coluna do WHERE;
 *   3. o recurso embutido (`ai_agents(…, ai_agent_runs(cost_cents))`) vale igual;
 *   4. as funções `security invoker` do schema que leem coluna fechada (hoje a
 *      `fn_uso_de_ia`) só pelo cliente admin;
 *   5. a regra das colunas é a mesma no TypeScript e na 9175, e o
 *      `baseline-mia.sql` espelha a função.
 *
 * O desenho aceito para a rota que serve os dois públicos é o cliente escolhido
 * pelo portão: `const db = veIa ? createAdminClient() : sessao`, com
 * `.select(veIa ? colunas : colunasDaSessao(colunas))`. A cerca lê a mesma
 * condição nos dois lugares e confere só o ramo da sessão; filtro por coluna
 * fechada nesse cliente só dentro de `if (veIa && …)`.
 *
 * Na fusão do upstream: leitor novo de custo pela sessão vai para o cliente admin
 * depois do portão (`docs/fork/consumo-de-ia.md`, conferência da fusão).
 *
 *     npx vitest run tests/unit/colunas-de-custo-fora-da-sessao.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  COLUNAS_DE_IA_FECHADAS,
  TABELAS_COM_COLUNAS_DE_IA_FECHADAS,
  colunasDaSessao,
  ehColunaDeIaFechada,
  nomeDaColuna,
} from "@/lib/ai/colunas-de-ia-fechadas";

import { arquivosDeCodigo, caminhoRelativo, RAIZ_DO_REPO } from "./helpers/varrer-codigo";
import {
  caminhoDaCadeia,
  caminhosDoClienteAdmin,
  declaracaoDoIdentificador,
  ehReceptorAdmin,
  escopoDeTipos,
  raizDaCadeia,
} from "./helpers/cliente-admin";

const RAIZES = ["app", "lib", "workers", "components", "hooks"] as const;
const TABELAS = new Set<string>(TABELAS_COM_COLUNAS_DE_IA_FECHADAS);
const MIGRATION_9175 = "supabase/migrations-mia/20261127180000_9175_custo_de_ia_a_sessao_nao_le.sql";

/**
 * As funções `security invoker` do schema que leem coluna fechada. Pela sessão
 * dão 42501; só o cliente admin as chama. O teste "o schema não ganhou leitor
 * invoker novo" confere esta lista contra o `baseline.sql` e o `baseline-mia.sql`.
 */
const FUNCOES_INVOKER_QUE_LEEM_CUSTO = new Map<string, string>([
  ["fn_uso_de_ia", "EXECUTE para authenticated; as rotas de uso e de evolução chamam pelo admin depois do portão"],
  ["fn_gasto_de_ia_do_mes", "EXECUTE só para service_role (a régua do teto do plano)"],
  ["fn_previa_historico_analise", "EXECUTE só para service_role (a análise do Histórico em Conexões)"],
  ["fn_resumo_historico_analise", "EXECUTE só para service_role (a análise do Histórico em Conexões)"],
]);

/**
 * As que `authenticated` EXECUTA: chamá-las pela sessão dá 42501 desde a 9175, e
 * só elas pedem o cliente admin no `.rpc(...)`. As outras da lista já recusam a
 * sessão pelo EXECUTE, antes de ler qualquer coluna.
 */
const RPC_SO_PELO_ADMIN = new Set(["fn_uso_de_ia"]);

/**
 * Arquivos cujo cliente chega por parâmetro de tipo genérico (`SupabaseClient`,
 * `Pick<SupabaseClient, "from">`), que o resolvedor não tem como provar, com o
 * motivo escrito: quem chama e com que cliente. Esta lista só encolhe. Quem
 * acrescentar um nome aqui está dizendo que TODO chamador entrega o cliente
 * admin, e diz qual.
 */
const LIBERADOS = new Map<string, string>([
  [
    "lib/ai/custo/consumo-de-ia.ts",
    "`lerConsumoDeIa(admin, …)`: os chamadores são `/api/v1/admin/ai-saldo` e " +
      "`lib/ai/custo/saldo-da-plataforma.ts`, ambos com `createAdminClient()`, atrás do portão da plataforma.",
  ],
  [
    "lib/ai/usage/consumo-do-periodo.ts",
    "`lerConsumoDoPeriodo`/`lerRankingDoConsumo(admin, …)`: os chamadores são `/api/v1/admin/tenants/[id]/usage` " +
      "e o MCP de plataforma (`lib/mcp-plataforma/ferramentas/consumo-de-ia.ts`), com o cliente admin.",
  ],
  [
    "lib/mcp-plataforma/ferramentas/assistente.ts",
    "`c.admin` é o cliente de serviço do contexto do MCP de plataforma (`lib/mcp-plataforma/tipos.ts`), " +
      "que só o token da plataforma alcança.",
  ],
]);

/** Filtros e ordem cujo 1º argumento é uma coluna. */
const FILTROS_POR_COLUNA = new Set([
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "likeAllOf", "likeAnyOf", "ilikeAllOf",
  "ilikeAnyOf", "is", "in", "contains", "containedBy", "overlaps", "textSearch", "not", "filter", "order",
  "rangeGt", "rangeGte", "rangeLt", "rangeLte", "rangeAdjacent",
]);

interface Achado {
  arquivo: string;
  linha: number;
  tabela: string;
  cliente: string;
  motivo: string;
}

// ─── as colunas de um texto de `select` ─────────────────────────────────────

/** Separa a lista do PostgREST nas vírgulas de fora dos parênteses. */
function itensDoSelect(texto: string): string[] {
  const itens: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const ch of texto) {
    if (ch === "(") nivel++;
    if (ch === ")") nivel--;
    if (ch === "," && nivel === 0) {
      itens.push(atual);
      atual = "";
    } else {
      atual += ch;
    }
  }
  itens.push(atual);
  return itens.map((i) => i.trim()).filter((i) => i !== "");
}

/** As colunas fechadas (ou `*`) pedidas por um texto de `select` desta tabela. */
function fechadasNoTexto(texto: string): string[] {
  const achadas: string[] = [];
  for (const item of itensDoSelect(texto)) {
    // Recurso embutido: as colunas são da OUTRA tabela, que tem a sua conferência.
    if (item.includes("(")) continue;
    const nome = nomeDaColuna(item);
    if (nome === "*" || ehColunaDeIaFechada(nome)) achadas.push(nome);
  }
  return achadas;
}

/** O que vem embutido de uma das três tabelas num `select` de outra. */
function embutidasNoTexto(texto: string): { tabela: string; fechadas: string[] }[] {
  const achados: { tabela: string; fechadas: string[] }[] = [];
  const rx = /(?:^|[,(\s])(?:\w+:)?(llm_calls|agent_turn_traces|ai_agent_runs)(?:!\w+)*\s*\(([^()]*)\)/g;
  for (const m of texto.matchAll(rx)) {
    const fechadas = fechadasNoTexto(m[2] ?? "");
    if (fechadas.length > 0) achados.push({ tabela: m[1] as string, fechadas });
  }
  return achados;
}

// ─── o valor de uma expressão de colunas ────────────────────────────────────

interface Valor {
  /** Os textos que a expressão pode ter. */
  textos: string[];
  /** Alguma parte não deu para ler (parâmetro, chamada, template com `${}`). */
  desconhecido: boolean;
}

const VAZIO: Valor = { textos: [], desconhecido: false };

function desembrulhar(no: ts.Expression): ts.Expression {
  let atual = no;
  while (
    ts.isParenthesizedExpression(atual) ||
    ts.isAsExpression(atual) ||
    ts.isSatisfiesExpression(atual) ||
    ts.isNonNullExpression(atual) ||
    ts.isAwaitExpression(atual)
  ) {
    atual = atual.expression;
  }
  return atual;
}

const fontesLidas = new Map<string, ts.SourceFile | null>();

function fonteDoModulo(modulo: string, deOnde: string): ts.SourceFile | null {
  const base = modulo.startsWith("@/")
    ? path.join(RAIZ_DO_REPO, modulo.slice(2))
    : modulo.startsWith(".")
      ? path.resolve(path.dirname(deOnde), modulo)
      : null;
  if (base === null) return null;
  if (fontesLidas.has(base)) return fontesLidas.get(base) ?? null;
  let fonte: ts.SourceFile | null = null;
  for (const ext of [".ts", ".tsx", "/index.ts"]) {
    try {
      const texto = readFileSync(base + ext, "utf8");
      fonte = ts.createSourceFile(base + ext, texto, ts.ScriptTarget.Latest, true);
      break;
    } catch {
      fonte = null;
    }
  }
  fontesLidas.set(base, fonte);
  return fonte;
}

/** A constante de topo `export const NOME = …` de um arquivo. */
function inicialDoTopo(fonte: ts.SourceFile, nome: string): ts.Expression | null {
  for (const st of fonte.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === nome && d.initializer) return d.initializer;
    }
  }
  return null;
}

function valorImportado(nome: string, fonte: ts.SourceFile, vistos: Set<string>): Valor | null {
  for (const st of fonte.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const ligacoes = st.importClause?.namedBindings;
    if (ligacoes === undefined || !ts.isNamedImports(ligacoes)) continue;
    for (const el of ligacoes.elements) {
      if (el.name.text !== nome) continue;
      const outra = fonteDoModulo(st.moduleSpecifier.text, fonte.fileName);
      const exportado = el.propertyName?.text ?? el.name.text;
      const inicial = outra ? inicialDoTopo(outra, exportado) : null;
      return inicial && outra ? valorDe(inicial, outra, vistos) : { textos: [], desconhecido: true };
    }
  }
  return null;
}

/** Os textos possíveis de uma expressão de colunas, até onde dá para ler. */
function valorDe(no: ts.Expression, fonte: ts.SourceFile, vistos = new Set<string>()): Valor {
  const e = desembrulhar(no);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { textos: [e.text], desconhecido: false };
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "colunasDaSessao") {
    // Seguro por construção: tira toda coluna fechada (testado abaixo).
    return VAZIO;
  }
  if (ts.isConditionalExpression(e)) {
    const a = valorDe(e.whenTrue, fonte, vistos);
    const b = valorDe(e.whenFalse, fonte, vistos);
    return { textos: [...a.textos, ...b.textos], desconhecido: a.desconhecido || b.desconhecido };
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = valorDe(e.left, fonte, vistos);
    const b = valorDe(e.right, fonte, vistos);
    const textos: string[] = [];
    for (const x of a.textos.length ? a.textos : [""]) for (const y of b.textos.length ? b.textos : [""]) textos.push(x + y);
    return { textos, desconhecido: a.desconhecido || b.desconhecido };
  }
  if (ts.isIdentifier(e)) {
    const chave = `${fonte.fileName}#${e.text}`;
    if (vistos.has(chave)) return { textos: [], desconhecido: true };
    vistos.add(chave);
    const decl = declaracaoDoIdentificador(e, fonte);
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer) return valorDe(decl.initializer, fonte, vistos);
    if (decl === null) {
      const importado = valorImportado(e.text, fonte, vistos);
      if (importado) return importado;
    }
    return { textos: [], desconhecido: true };
  }
  return { textos: [], desconhecido: true };
}

// ─── o cliente da cadeia ────────────────────────────────────────────────────

type Cliente =
  | { tipo: "admin" }
  | { tipo: "sessao" }
  /** `cond ? admin : sessao` (ou o contrário): o portão escolhe. */
  | { tipo: "portao"; condicao: string; sessaoNoFalso: boolean };

type Escopo = ReturnType<typeof escopoDeTipos>;

function clienteDe(
  receptor: ts.Expression,
  fonte: ts.SourceFile,
  escopo: Escopo,
  caminhos: ReadonlySet<string>,
): Cliente {
  if (ehReceptorAdmin(receptor, fonte, escopo, caminhos)) return { tipo: "admin" };
  let e = desembrulhar(receptor);
  if (ts.isIdentifier(e)) {
    const decl = declaracaoDoIdentificador(e, fonte);
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer) e = desembrulhar(decl.initializer);
  }
  if (ts.isConditionalExpression(e)) {
    const verdadeAdmin = ehReceptorAdmin(e.whenTrue, fonte, escopo, caminhos);
    const falsoAdmin = ehReceptorAdmin(e.whenFalse, fonte, escopo, caminhos);
    if (verdadeAdmin !== falsoAdmin) {
      return { tipo: "portao", condicao: e.condition.getText(fonte), sessaoNoFalso: verdadeAdmin };
    }
  }
  return { tipo: "sessao" };
}

/** O ramo da sessão de uma expressão de colunas, quando ela segue o mesmo portão. */
function ramoDaSessao(arg: ts.Expression, cliente: Cliente, fonte: ts.SourceFile): ts.Expression {
  if (cliente.tipo !== "portao") return arg;
  const e = desembrulhar(arg);
  if (ts.isConditionalExpression(e) && e.condition.getText(fonte) === cliente.condicao) {
    return cliente.sessaoNoFalso ? e.whenFalse : e.whenTrue;
  }
  return arg;
}

/** A chamada está no `then` de um `if` cuja condição exige o portão (`cond && …`)? */
function guardadoPeloPortao(no: ts.Node, condicao: string, fonte: ts.SourceFile): boolean {
  const operandos = (e: ts.Expression): string[] => {
    const d = desembrulhar(e);
    if (ts.isBinaryExpression(d) && d.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return [...operandos(d.left), ...operandos(d.right)];
    }
    return [d.getText(fonte)];
  };
  let filho: ts.Node = no;
  let pai: ts.Node | undefined = no.parent;
  while (pai !== undefined) {
    if (ts.isIfStatement(pai) && pai.thenStatement === filho && operandos(pai.expression).includes(condicao)) return true;
    if (ts.isConditionalExpression(pai) && pai.whenTrue === filho && operandos(pai.condition).includes(condicao)) return true;
    filho = pai;
    pai = pai.parent;
  }
  return false;
}

// ─── a cadeia de um `.from(...)` ────────────────────────────────────────────

/** As chamadas encadeadas a partir de `inicio` (`inicio.a(…).b(…)`), e o topo. */
function chamadasEncadeadas(inicio: ts.Node): { chamadas: ts.CallExpression[]; topo: ts.Node } {
  const chamadas: ts.CallExpression[] = [];
  let atual: ts.Node = inicio;
  for (;;) {
    const pai = atual.parent;
    if (pai && ts.isPropertyAccessExpression(pai) && pai.expression === atual) {
      const avo = pai.parent;
      if (avo && ts.isCallExpression(avo) && avo.expression === pai) {
        chamadas.push(avo);
        atual = avo;
        continue;
      }
      break;
    }
    if (pai && (ts.isParenthesizedExpression(pai) || ts.isNonNullExpression(pai) || ts.isAsExpression(pai))) {
      atual = pai;
      continue;
    }
    break;
  }
  return { chamadas, topo: atual };
}

/** A cadeia e as continuações por variável (`let q = …; q = q.eq(…)`). */
function cadeiaCompleta(fromCall: ts.CallExpression, fonte: ts.SourceFile): ts.CallExpression[] {
  const todas: ts.CallExpression[] = [];
  const declsVistas = new Set<ts.Node>();
  const seguir = (inicio: ts.Node): void => {
    const { chamadas, topo } = chamadasEncadeadas(inicio);
    todas.push(...chamadas);
    const pai = topo.parent;
    let decl: ts.Declaration | null = null;
    if (pai && ts.isVariableDeclaration(pai) && pai.initializer === topo && ts.isIdentifier(pai.name)) decl = pai;
    if (
      pai &&
      ts.isBinaryExpression(pai) &&
      pai.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      pai.right === topo &&
      ts.isIdentifier(pai.left)
    ) {
      decl = declaracaoDoIdentificador(pai.left, fonte);
    }
    if (decl === null || declsVistas.has(decl)) return;
    declsVistas.add(decl);
    const visitar = (no: ts.Node): void => {
      if (
        ts.isIdentifier(no) &&
        no.parent &&
        ts.isPropertyAccessExpression(no.parent) &&
        no.parent.expression === no &&
        declaracaoDoIdentificador(no, fonte) === decl
      ) {
        seguir(no);
      }
      ts.forEachChild(no, visitar);
    };
    visitar(fonte);
  };
  seguir(fromCall);
  return todas;
}

/** As colunas que um filtro do PostgREST cita. */
function colunasDoFiltro(chamada: ts.CallExpression, fonte: ts.SourceFile): { colunas: string[]; desconhecido: boolean } {
  const metodo = (chamada.expression as ts.PropertyAccessExpression).name.text;
  const arg = chamada.arguments[0];
  if (arg === undefined) return { colunas: [], desconhecido: false };
  if (FILTROS_POR_COLUNA.has(metodo)) {
    const v = valorDe(arg, fonte);
    return { colunas: v.textos.map(nomeDaColuna), desconhecido: v.desconhecido };
  }
  if (metodo === "or") {
    const e = desembrulhar(arg);
    let texto: string | null = null;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) texto = e.text;
    if (ts.isTemplateExpression(e)) texto = e.head.text + e.templateSpans.map((s) => `X${s.literal.text}`).join("");
    if (texto === null) return { colunas: [], desconhecido: true };
    const rx = /(?:^|[,(])\s*([a-z_][a-z0-9_]*)\.(?:not\.)?[a-z]+\./g;
    return {
      colunas: [...texto.matchAll(rx)].map((m) => m[1] as string).filter((c) => c !== "and" && c !== "or"),
      desconhecido: false,
    };
  }
  if (metodo === "match") {
    const e = desembrulhar(arg);
    if (!ts.isObjectLiteralExpression(e)) return { colunas: [], desconhecido: true };
    const colunas: string[] = [];
    for (const p of e.properties) {
      if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
        colunas.push(p.name.text);
      } else {
        return { colunas, desconhecido: true };
      }
    }
    return { colunas, desconhecido: false };
  }
  return { colunas: [], desconhecido: false };
}

// ─── a varredura de um arquivo ──────────────────────────────────────────────

function nomeDoMetodo(chamada: ts.CallExpression): string | null {
  return ts.isPropertyAccessExpression(chamada.expression) ? chamada.expression.name.text : null;
}

function achadosNaFonte(fonte: ts.SourceFile, arquivo: string): Achado[] {
  const achados: Achado[] = [];
  // Caros (o resolvedor segue tipos entre arquivos): só quando há chamada a conferir.
  let escopoECaminhos: { escopo: Escopo; caminhos: ReadonlySet<string> } | null = null;
  const tipos = () => (escopoECaminhos ??= { escopo: escopoDeTipos(fonte), caminhos: caminhosDoClienteAdmin(fonte) });
  const cliente_ = (r: ts.Expression) => clienteDe(r, fonte, tipos().escopo, tipos().caminhos);
  const linhaDe = (no: ts.Node) => fonte.getLineAndCharacterOfPosition(no.getStart(fonte)).line + 1;
  const nomeDoCliente = (r: ts.Expression) => caminhoDaCadeia(r) ?? raizDaCadeia(r) ?? "?";

  const visitar = (no: ts.Node): void => {
    if (ts.isCallExpression(no) && ts.isPropertyAccessExpression(no.expression)) {
      const metodo = no.expression.name.text;
      const receptor = no.expression.expression;
      const alvo = no.arguments[0];
      const literal = alvo !== undefined && ts.isStringLiteralLike(alvo) ? alvo.text : null;

      // 4 · funções invoker que leem custo
      if (metodo === "rpc" && literal !== null && RPC_SO_PELO_ADMIN.has(literal)) {
        if (cliente_(receptor).tipo !== "admin") {
          achados.push({ arquivo, linha: linhaDe(no), tabela: literal, cliente: nomeDoCliente(receptor), motivo: "rpc de função invoker que lê custo" });
        }
      }

      if (metodo === "from" && literal !== null && TABELAS.has(literal)) {
        const cliente = cliente_(receptor);
        const cadeia = cliente.tipo === "admin" ? [] : cadeiaCompleta(no, fonte);
        for (const chamada of cadeia) {
          const m = nomeDoMetodo(chamada);
          if (m === null) continue;
          // 1 · as colunas do select (`select()` sem argumento é `*`)
          if (m === "select") {
            const arg = chamada.arguments[0];
            const v = arg === undefined ? { textos: ["*"], desconhecido: false } : valorDe(ramoDaSessao(arg, cliente, fonte), fonte);
            const fechadas = v.textos.flatMap(fechadasNoTexto);
            if (fechadas.length > 0 || v.desconhecido) {
              achados.push({
                arquivo,
                linha: linhaDe(chamada),
                tabela: literal,
                cliente: nomeDoCliente(receptor),
                motivo: v.desconhecido
                  ? "select com colunas que a cerca não consegue ler (use um texto fixo ou colunasDaSessao)"
                  : `select pede ${[...new Set(fechadas)].join(", ")}`,
              });
            }
            continue;
          }
          // 2 · filtro e ordem por coluna fechada. Coluna vinda de variável num
          // filtro comum passa (não dá para dizer que é fechada); `or` e `match`
          // ilegíveis, não.
          const { colunas, desconhecido } = colunasDoFiltro(chamada, fonte);
          const fechadas = colunas.filter(ehColunaDeIaFechada);
          const ilegivel = desconhecido && (m === "or" || m === "match");
          if (fechadas.length === 0 && !ilegivel) continue;
          if (cliente.tipo === "portao" && guardadoPeloPortao(chamada, cliente.condicao, fonte)) continue;
          achados.push({
            arquivo,
            linha: linhaDe(chamada),
            tabela: literal,
            cliente: nomeDoCliente(receptor),
            motivo: ilegivel && fechadas.length === 0 ? `${m}(...) com filtro que a cerca não consegue ler` : `${m}(...) filtra por ${fechadas.join(", ")}`,
          });
        }
      }
      // 3 · recurso embutido das três tabelas no select de outra
      if (metodo === "from" && literal !== null && !TABELAS.has(literal)) {
        const selects = chamadasEncadeadas(no).chamadas.filter(
          (c) => nomeDoMetodo(c) === "select" && c.arguments[0] !== undefined && EMBUTE.test(c.arguments[0].getText(fonte)),
        );
        const cliente = selects.length > 0 ? cliente_(receptor) : null;
        if (cliente !== null && cliente.tipo !== "admin") {
          for (const chamada of selects) {
            const v = valorDe(ramoDaSessao(chamada.arguments[0] as ts.Expression, cliente, fonte), fonte);
            for (const e of v.textos.flatMap(embutidasNoTexto)) {
              achados.push({
                arquivo,
                linha: linhaDe(chamada),
                tabela: e.tabela,
                cliente: nomeDoCliente(receptor),
                motivo: `embute ${e.tabela}(${e.fechadas.join(", ")}) em ${literal}`,
              });
            }
          }
        }
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return achados;
}

const EMBUTE = /\b(llm_calls|agent_turn_traces|ai_agent_runs)\b|^[A-Z_]+$/;
const TOCA = /\b(llm_calls|agent_turn_traces|ai_agent_runs|fn_uso_de_ia|fn_gasto_de_ia_do_mes|fn_previa_historico_analise|fn_resumo_historico_analise)\b/;
const ARQUIVOS = arquivosDeCodigo(RAIZES);
const QUE_TOCAM = ARQUIVOS.filter((a) => TOCA.test(readFileSync(a, "utf8")));

const achadosPorArquivo = new Map<string, Achado[]>();
function achadosDoArquivo(caminho: string): Achado[] {
  const lido = achadosPorArquivo.get(caminho);
  if (lido) return lido;
  const texto = readFileSync(caminho, "utf8");
  const achados = achadosNaFonte(ts.createSourceFile(caminho, texto, ts.ScriptTarget.Latest, true), caminhoRelativo(caminho));
  achadosPorArquivo.set(caminho, achados);
  return achados;
}

const fonteDe = (codigo: string): ts.SourceFile => ts.createSourceFile("sintetico.ts", codigo, ts.ScriptTarget.Latest, true);
const achadosDe = (codigo: string) => achadosNaFonte(fonteDe(codigo), "sintetico.ts");

const IMPORTA_ADMIN = 'import { createAdminClient } from "@/lib/supabase/admin";\n';
const IMPORTA_SESSAO = 'import { createClient } from "@/lib/supabase/server";\n';
const IMPORTA_COLUNAS = 'import { colunasDaSessao } from "@/lib/ai/colunas-de-ia-fechadas";\n';

/** Os leitores da tabela do desenho (MIA-285, ponto 4) e os achados depois dela. */
const LEITORES_CONHECIDOS = [
  "app/api/v1/ai/runs/route.ts",
  "app/api/v1/ai/agents/[id]/runs/route.ts",
  "app/api/v1/ai/turn-traces/route.ts",
  "app/app/ai/usage/page.tsx",
  "app/api/v1/ai/jev/route.ts",
  "lib/mcp/tools/agentes.ts",
  "app/api/v1/ai/usage/route.ts",
  "app/api/v1/ai/evolution/route.ts",
];

describe("a sessão não lê custo, tokens, provedor nem modelo de IA (9175)", () => {
  it("CONTROLE: a varredura enxerga os leitores conhecidos, e eles passam", { timeout: 120_000 }, () => {
    expect(ARQUIVOS.length).toBeGreaterThan(500);
    expect(QUE_TOCAM.length, "quase ninguém tocando as três tabelas é indistinguível de 'está tudo em ordem'").toBeGreaterThan(20);
    for (const conhecido of LEITORES_CONHECIDOS) {
      const achado = QUE_TOCAM.find((a) => caminhoRelativo(a) === conhecido);
      expect(achado, `${conhecido} sumiu da varredura`).toBeDefined();
      expect(achadosDoArquivo(achado as string), conhecido).toEqual([]);
    }
  });

  it("nenhum leitor pede coluna fechada pela sessão, nem filtra por ela", () => {
    const achados = QUE_TOCAM.filter((a) => !LIBERADOS.has(caminhoRelativo(a))).flatMap(achadosDoArquivo);
    expect(
      achados.map((a) => `${a.arquivo}:${a.linha} ${a.cliente} · ${a.tabela} · ${a.motivo}`),
      "leitura de custo, tokens, provedor ou modelo de IA por cliente que não é o admin. Desde a 9175 a " +
        "sessão recebe 42501 nessas colunas e a rota responde 500. Quem precisa delas é a plataforma " +
        "(`podeVerCusto`): leia com o cliente admin (`createAdminClient()` ou parâmetro tipado " +
        "`ReturnType<typeof createAdminClient>`) DEPOIS do portão, filtrando `organization_id`, e marque a " +
        "linha com `FORK MIA` se o arquivo for do upstream. A sessão fica com `colunasDaSessao(...)`.",
    ).toEqual([]);
  }, 120_000);

  it("todo liberado ainda existe e ainda lê coluna fechada (a lista só encolhe)", () => {
    for (const [arquivo] of LIBERADOS) {
      const achado = QUE_TOCAM.find((a) => caminhoRelativo(a) === arquivo);
      expect(achado, `${arquivo} não toca mais as tabelas: tire da lista de liberados`).toBeDefined();
      expect(
        achadosDoArquivo(achado as string).length,
        `${arquivo} já lê por um cliente provado: tire da lista de liberados`,
      ).toBeGreaterThan(0);
    }
  });

  it("a regra das colunas é a mesma no código e na 9175, e o baseline-mia.sql espelha a função", () => {
    const migration = readFileSync(path.join(RAIZ_DO_REPO, MIGRATION_9175), "utf8");
    const lista = /v_fechadas constant text\[\] := array\[([^\]]*)\]/.exec(migration)?.[1];
    expect(lista, "a 9175 não declara mais `v_fechadas`").toBeDefined();
    const doBanco = [...(lista as string).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(doBanco).toEqual([...COLUNAS_DE_IA_FECHADAS]);
    expect(migration).toMatch(/strpos\(col\.column_name::text, 'tokens'\) > 0/);
    const tabelas = /v_leitura constant text\[\] := array\[([^\]]*)\]/.exec(migration)?.[1] ?? "";
    expect([...tabelas.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...TABELAS_COM_COLUNAS_DE_IA_FECHADAS]);

    // O baseline-mia.sql roda a cada implantação: a ÚLTIMA definição da função lá é a desta migration.
    const baselineMia = readFileSync(path.join(RAIZ_DO_REPO, "supabase/baseline-mia.sql"), "utf8");
    const corpo = (texto: string) => {
      const inicio = texto.lastIndexOf("create or replace function public.fn_mia_colunas_de_ia_fechadas()");
      return texto.slice(inicio, texto.indexOf("$$;", inicio));
    };
    expect(corpo(baselineMia).length).toBeGreaterThan(1000);
    expect(corpo(baselineMia)).toBe(corpo(migration));
    // E o bloco é chamado depois da definição, antes da varredura anon.
    const varredura = baselineMia.indexOf("-- ---- VARREDURA anon");
    const chamada = baselineMia.lastIndexOf("select public.fn_mia_colunas_de_ia_fechadas();");
    expect(chamada).toBeGreaterThan(baselineMia.lastIndexOf("create or replace function public.fn_mia_colunas_de_ia_fechadas()"));
    expect(chamada).toBeLessThan(varredura);
  });

  it("o schema não ganhou leitor invoker de custo fora da lista", () => {
    // Função `security invoker` lê com os privilégios de quem chama: pela sessão,
    // a que toca coluna fechada das três tabelas dá 42501. Função nova do upstream
    // assim entra na lista com o motivo, e quem a chama vai pelo admin.
    const ultimas = new Map<string, { corpo: string; definer: boolean }>();
    for (const arquivo of ["supabase/baseline.sql", "supabase/baseline-mia.sql"]) {
      const texto = readFileSync(path.join(RAIZ_DO_REPO, arquivo), "utf8");
      const rx = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\)\s*returns([\s\S]*?)\bas\s+(\$\w*\$)([\s\S]*?)\4([\s\S]*?);/gi;
      for (const m of texto.matchAll(rx)) {
        const cabeca = `${m[3]} ${m[6]}`.toLowerCase();
        ultimas.set(m[1] as string, { corpo: m[5] as string, definer: cabeca.includes("security definer") });
      }
    }
    const leitores: string[] = [];
    for (const [nome, { corpo, definer }] of ultimas) {
      if (definer || nome === "fn_mia_colunas_de_ia_fechadas") continue;
      if (!/\b(llm_calls|agent_turn_traces|ai_agent_runs)\b/.test(corpo)) continue;
      const citadas = [...corpo.matchAll(/\b([a-z_]+)\b/g)].map((x) => x[1] as string);
      if (citadas.some((c) => ehColunaDeIaFechada(c) && c !== "model" && c !== "provider")) leitores.push(nome);
    }
    expect(leitores.sort()).toEqual([...FUNCOES_INVOKER_QUE_LEEM_CUSTO.keys()].sort());
  });

  it("colunasDaSessao tira toda coluna fechada e mantém o resto, na ordem", () => {
    expect(colunasDaSessao("id, provider, model, status, input_tokens, cache_read_tokens, cost_cents, latency_ms")).toBe(
      "id, status, latency_ms",
    );
    expect(colunasDaSessao("id,tokens_in,tokens_out,entrada_do_primeiro_passo,error_code")).toBe("id, error_code");
    expect(colunasDaSessao("id, custo:cost_cents, modelo:model::text, status")).toBe("id, status");
    expect(fechadasNoTexto(colunasDaSessao("*"))).toEqual(["*"]);
  });

  it("CONTROLE: a leitura de custo pela sessão é reprovada; o admin, o portão e as colunas abertas passam", () => {
    const vermelhos: readonly { forma: string; codigo: string }[] = [
      {
        forma: "sessão pede o custo",
        codigo: `${IMPORTA_SESSAO}export async function f(org: string) { const db = await createClient();\n  await db.from("llm_calls").select("id, cost_cents").eq("organization_id", org); }`,
      },
      {
        forma: "sessão pede tudo",
        codigo: `${IMPORTA_SESSAO}export async function f(org: string) { const db = await createClient();\n  await db.from("ai_agent_runs").select("*").eq("organization_id", org); }`,
      },
      {
        forma: "sessão sem argumento no select (é `*`)",
        codigo: `${IMPORTA_SESSAO}export async function f() { const db = await createClient();\n  await db.from("agent_turn_traces").select(); }`,
      },
      {
        forma: "sessão pede o modelo por constante",
        codigo: `${IMPORTA_SESSAO}const COLUNAS = "id, " + "model";\nexport async function f() { const db = await createClient();\n  await db.from("agent_turn_traces").select(COLUNAS); }`,
      },
      {
        forma: "sessão filtra por tokens",
        codigo: `${IMPORTA_SESSAO}export async function f() { const db = await createClient();\n  let q = db.from("llm_calls").select("id", { count: "exact", head: true });\n  q = q.gt("input_tokens", 100000);\n  await q; }`,
      },
      {
        forma: "sessão filtra por provedor num or",
        codigo: `${IMPORTA_SESSAO}export async function f(p: string) { const db = await createClient();\n  await db.from("llm_calls").select("id").or(\`provider.eq.\${p},status.eq.ok\`); }`,
      },
      {
        forma: "sessão ordena por custo",
        codigo: `${IMPORTA_SESSAO}export async function f() { const db = await createClient();\n  await db.from("ai_agent_runs").select("id").order("cost_cents"); }`,
      },
      {
        forma: "sessão embute o custo do run",
        codigo: `${IMPORTA_SESSAO}export async function f() { const db = await createClient();\n  await db.from("ai_agents").select("id, ai_agent_runs(id, cost_cents)"); }`,
      },
      {
        forma: "sessão chama a função invoker que soma custo",
        codigo: `${IMPORTA_SESSAO}export async function f(org: string) { const db = await createClient();\n  await db.rpc("fn_uso_de_ia", { p_org: org }); }`,
      },
      {
        forma: "portão com o ramo da sessão pedindo custo",
        codigo: `${IMPORTA_ADMIN}${IMPORTA_SESSAO}export async function f(veIa: boolean) { const sessao = await createClient();\n  const db = veIa ? createAdminClient() : sessao;\n  await db.from("llm_calls").select(veIa ? "id, cost_cents" : "id, provider"); }`,
      },
      {
        forma: "portão com filtro fechado fora do if do portão",
        codigo: `${IMPORTA_ADMIN}${IMPORTA_SESSAO}export async function f(veIa: boolean, p?: string) { const sessao = await createClient();\n  const db = veIa ? createAdminClient() : sessao;\n  let q = db.from("llm_calls").select("id");\n  if (p) q = q.eq("provider", p);\n  await q; }`,
      },
      {
        forma: "portão com condições diferentes no cliente e nas colunas",
        codigo: `${IMPORTA_ADMIN}${IMPORTA_SESSAO}export async function f(veIa: boolean, outro: boolean) { const sessao = await createClient();\n  const db = veIa ? createAdminClient() : sessao;\n  await db.from("llm_calls").select(outro ? "id, cost_cents" : "id"); }`,
      },
      {
        forma: "colunas que não dá para ler",
        codigo: `${IMPORTA_SESSAO}export async function f(colunas: string) { const db = await createClient();\n  await db.from("llm_calls").select(colunas); }`,
      },
      {
        forma: "cliente chamado de `admin` sem ser admin",
        codigo: `${IMPORTA_SESSAO}export async function f() { const admin = await createClient();\n  await admin.from("llm_calls").select("cost_cents"); }`,
      },
    ];
    for (const { forma, codigo } of vermelhos) {
      expect.soft(achadosDe(codigo).length, `${forma}: passou pela cerca`).toBeGreaterThan(0);
    }

    const verdes: readonly { forma: string; codigo: string }[] = [
      {
        forma: "admin lê o custo",
        codigo: `${IMPORTA_ADMIN}export async function f(org: string) { const admin = createAdminClient();\n  await admin.from("llm_calls").select("*").eq("organization_id", org).gt("input_tokens", 1); }`,
      },
      {
        forma: "admin tipado por parâmetro",
        codigo: `import type { createAdminClient } from "@/lib/supabase/admin";\nexport async function f(admin: ReturnType<typeof createAdminClient>) {\n  await admin.from("agent_turn_traces").select("id, provider, model, cost_cents"); }`,
      },
      {
        forma: "sessão lê status, erro e tempo",
        codigo: `${IMPORTA_SESSAO}export async function f(org: string) { const db = await createClient();\n  await db.from("llm_calls").select("id, status, error_code, latency_ms").eq("organization_id", org).order("created_at"); }`,
      },
      {
        forma: "sessão conta linhas",
        codigo: `${IMPORTA_SESSAO}export async function f() { const db = await createClient();\n  await db.from("llm_calls").select("id", { count: "exact", head: true }).eq("status", "erro"); }`,
      },
      {
        forma: "portão com colunasDaSessao e filtro fechado dentro do if",
        codigo: `${IMPORTA_ADMIN}${IMPORTA_SESSAO}${IMPORTA_COLUNAS}const COLUNAS = "id, provider, cost_cents, status";\nexport async function f(veIa: boolean, p?: string) { const sessao = await createClient();\n  const db = veIa ? createAdminClient() : sessao;\n  let q = db.from("llm_calls").select(veIa ? COLUNAS : colunasDaSessao(COLUNAS));\n  if (veIa && p) q = q.eq("provider", p);\n  await q; }`,
      },
      {
        forma: "admin chama a função invoker",
        codigo: `${IMPORTA_ADMIN}export async function f(org: string) {\n  await createAdminClient().rpc("fn_uso_de_ia", { p_org: org }); }`,
      },
      {
        forma: "anonimização grava tool_calls pela sessão",
        codigo: `${IMPORTA_SESSAO}export async function f(id: string) { const db = await createClient();\n  await db.from("ai_agent_runs").update({ tool_calls: [] }).eq("id", id); }`,
      },
    ];
    for (const { forma, codigo } of verdes) {
      expect.soft(achadosDe(codigo), `${forma}: reprovado sem motivo`).toEqual([]);
    }
  });
});
