/**
 * Quais funções (e tipos) exportados do upstream mudaram de assinatura numa
 * faixa, e quais arquivos NOSSOS os usam.
 *
 * FORK: o upstream não tem este arquivo (ver docs/FORK-MIA.md, regra 4).
 *
 * ── Por que isto existe ──────────────────────────────────────────────────────
 *
 * Função do upstream que muda de assinatura quebra arquivo nosso que nem deu
 * conflito: o merge passa limpo, e o erro só aparece no typecheck da CI, que
 * derruba build, e2e e imagens de uma vez. Na fusão 1.107 foram 13 erros, e cada
 * rodada de CI custa de 30 a 60 min. O typecheck inteiro não cabe no contêiner
 * do time (pede uns 6 GB), então a medição aqui é por LEITURA do código das duas
 * versões: o parser do TypeScript do próprio repositório, sem checker, sem build.
 *
 * O que ela compara, por arquivo do upstream que mudou na faixa:
 *   · função exportada (`export function`, `export const f = (...) =>`):
 *     parâmetro novo, parâmetro removido, parâmetro que trocou de tipo ou passou
 *     a obrigatório, retorno trocado, parâmetros de tipo (genéricos), função
 *     renomeada ou removida;
 *   · tipo exportado (`export interface`, `export type`): campo novo
 *     obrigatório, campo removido, campo que trocou de tipo, ou o tipo inteiro
 *     trocado. Foi assim que entraram 3 dos 13 erros da 1.107.
 * Mudança só de corpo, de comentário ou de nome de parâmetro não aparece.
 *
 * Quem chama: arquivo da cabeça (HEAD) que é nosso, isto é, que o upstream não
 * tem na base da faixa ou que tem um bloco `FORK MIA`, e que importa o nome
 * daquele módulo (`@/…` ou caminho relativo). Cada uso vem com a linha.
 *
 * O que ela NÃO vê (o typecheck da CI continua sendo o juiz):
 *   · retorno sem anotação (inferido): sem checker não há tipo para comparar;
 *   · tipo que mudou por dentro de outro tipo importado (só o texto da
 *     declaração é comparado);
 *   · métodos de classe, `export default`, e quem importa por um arquivo que
 *     reexporta (`export * from`);
 *   · erros que não são de assinatura (import que sumiu, JSX duplicado).
 *
 *   node scripts/assinaturas-do-upstream.mjs <antes> <depois> [cabeca] [--json]
 *
 * Ex.: `node scripts/assinaturas-do-upstream.mjs v1.106.0 v1.107.0 HEAD`.
 * O `scripts/sincronizar-upstream.mjs` chama `medirAssinaturas` com a base da
 * fusão e o upstream, e põe o resultado na seção "Assinaturas que mudaram".
 * Nunca escreve nada: só lê objetos do git.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXTENSOES = [".ts", ".tsx", ".mts", ".cts"];
const ehCodigo = (f) => EXTENSOES.some((e) => f.endsWith(e));

/**
 * Carrega o `typescript` do repositório (já é dependência de desenvolvimento).
 * Sem `node_modules` (o robô da CI não instala nada) devolve null, e quem chama
 * diz que a seção foi pulada em vez de mentir "nenhuma mudança".
 */
export async function carregarTypescript(raiz = process.cwd()) {
  try {
    const exigir = createRequire(join(raiz, "package.json"));
    return exigir("typescript");
  } catch {
    return null;
  }
}

/* ── Leitura de um arquivo ──────────────────────────────────────────────────*/

function temModificador(ts, no, tipo) {
  return (ts.canHaveModifiers?.(no) ? ts.getModifiers(no) : no.modifiers)?.some((m) => m.kind === tipo) ?? false;
}

function textoLimpo(ts, sf, no) {
  if (!no) return null;
  const impressora = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  return impressora.printNode(ts.EmitHint.Unspecified, no, sf).replace(/\s+/g, " ").replace(/;\s*}/g, " }").trim();
}

function lerParametros(ts, sf, params) {
  return params.map((p) => ({
    nome: ts.isIdentifier(p.name) ? p.name.text : textoLimpo(ts, sf, p.name),
    tipo: textoLimpo(ts, sf, p.type) ?? "(sem tipo)",
    opcional: Boolean(p.questionToken || p.initializer),
    resto: Boolean(p.dotDotDotToken),
    // Parâmetro-objeto (`{ a: string; b?: number }`): os campos, para dizer qual mudou.
    membros: p.type && ts.isTypeLiteralNode(p.type) ? lerMembros(ts, sf, p.type.members) : null,
  }));
}

function lerFuncao(ts, sf, no) {
  return {
    genericos: (no.typeParameters ?? []).map((t) => textoLimpo(ts, sf, t)).join(", "),
    parametros: lerParametros(ts, sf, no.parameters),
    retorno: textoLimpo(ts, sf, no.type),
  };
}

function lerMembros(ts, sf, membros) {
  const mapa = {};
  for (const m of membros) {
    const nome = m.name ? (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) ? m.name.text : textoLimpo(ts, sf, m.name)) : null;
    if (!nome) continue; // assinatura de índice ou de chamada: entra no texto inteiro
    mapa[nome] = { opcional: Boolean(m.questionToken), texto: textoLimpo(ts, sf, m.type ?? m) ?? "" };
  }
  return mapa;
}

/**
 * As assinaturas exportadas de um arquivo, por nome.
 * Função: `{ tipo: "funcao", assinaturas: [{ genericos, parametros, retorno }], linha }`
 * (mais de uma quando há sobrecarga). Tipo: `{ tipo: "tipo", texto, membros, linha }`.
 */
export function assinaturasDoArquivo(ts, texto, arquivo = "arquivo.ts") {
  const sf = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, true, arquivo.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const locais = new Map();
  const exportados = new Map(); // nome exportado -> nome local
  const linha = (no) => sf.getLineAndCharacterOfPosition(no.getStart(sf)).line + 1;

  const guardar = (nome, item) => {
    const ja = locais.get(nome);
    if (ja && ja.tipo === "funcao" && item.tipo === "funcao") {
      ja.assinaturas.push(...item.assinaturas);
      return;
    }
    if (!ja) locais.set(nome, item);
  };

  for (const no of sf.statements) {
    const exportado = temModificador(ts, no, ts.SyntaxKind.ExportKeyword) && !temModificador(ts, no, ts.SyntaxKind.DefaultKeyword);
    if (ts.isFunctionDeclaration(no) && no.name) {
      guardar(no.name.text, { tipo: "funcao", assinaturas: [lerFuncao(ts, sf, no)], linha: linha(no), corpo: Boolean(no.body) });
      if (exportado) exportados.set(no.name.text, no.name.text);
    } else if (ts.isVariableStatement(no)) {
      for (const d of no.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        let ini = d.initializer;
        while (ini && (ts.isParenthesizedExpression(ini) || ts.isAsExpression(ini) || ts.isSatisfiesExpression?.(ini))) ini = ini.expression;
        const ehFuncao = Boolean(ini && (ts.isArrowFunction(ini) || ts.isFunctionExpression(ini)));
        if (d.type && ts.isFunctionTypeNode(d.type)) {
          guardar(d.name.text, { tipo: "funcao", assinaturas: [lerFuncao(ts, sf, d.type)], linha: linha(d) });
        } else if (d.type && ehFuncao) {
          // `export const f: Tipo = (…) => …`: quem chama vê o tipo declarado.
          guardar(d.name.text, { tipo: "funcao", assinaturas: [{ ...lerFuncao(ts, sf, ini), declarado: textoLimpo(ts, sf, d.type) }], linha: linha(d) });
        } else if (!d.type && ehFuncao) {
          guardar(d.name.text, { tipo: "funcao", assinaturas: [lerFuncao(ts, sf, ini)], linha: linha(d) });
        }
        if (exportado && locais.has(d.name.text)) exportados.set(d.name.text, d.name.text);
      }
    } else if (ts.isInterfaceDeclaration(no)) {
      const anterior = locais.get(no.name.text);
      const membros = lerMembros(ts, sf, no.members);
      const texto = [
        (no.typeParameters ?? []).map((t) => textoLimpo(ts, sf, t)).join(", "),
        (no.heritageClauses ?? []).map((h) => textoLimpo(ts, sf, h)).join(" "),
        no.members.filter((m) => !m.name).map((m) => textoLimpo(ts, sf, m)).join("; "),
      ].join(" | ");
      if (anterior?.tipo === "tipo") Object.assign(anterior.membros, membros); // declaração repetida se funde
      else guardar(no.name.text, { tipo: "tipo", texto, membros, linha: linha(no) });
      if (exportado) exportados.set(no.name.text, no.name.text);
    } else if (ts.isTypeAliasDeclaration(no)) {
      const literal = ts.isTypeLiteralNode(no.type);
      guardar(no.name.text, {
        tipo: "tipo",
        texto: [(no.typeParameters ?? []).map((t) => textoLimpo(ts, sf, t)).join(", "), literal ? "{…}" : textoLimpo(ts, sf, no.type)].join(" | "),
        membros: literal ? lerMembros(ts, sf, no.type.members) : null,
        linha: linha(no),
      });
      if (exportado) exportados.set(no.name.text, no.name.text);
    } else if (ts.isExportDeclaration(no) && !no.moduleSpecifier && no.exportClause && ts.isNamedExports(no.exportClause)) {
      // `export { a, b as c }` de declarações locais.
      for (const e of no.exportClause.elements) exportados.set(e.name.text, (e.propertyName ?? e.name).text);
    }
  }

  const resultado = {};
  for (const [publico, local] of exportados) {
    const item = locais.get(local);
    if (!item) continue;
    if (item.tipo === "funcao") {
      // Com sobrecarga, a implementação não faz parte da assinatura pública.
      const declaracoes = item.assinaturas.length > 1 ? item.assinaturas.slice(0, -1) : item.assinaturas;
      resultado[publico] = { tipo: "funcao", assinaturas: declaracoes, linha: item.linha };
    } else {
      resultado[publico] = item;
    }
  }
  return resultado;
}

/* ── Comparação ─────────────────────────────────────────────────────────────*/

const escreveParametro = (p) => `${p.resto ? "..." : ""}${p.nome}${p.opcional ? "?" : ""}: ${p.tipo}`;

/**
 * "A → B" em poucas palavras. Texto curto vai inteiro; texto longo (um union de
 * 14 ações, por exemplo) mostra só o trecho que difere, com um pouco de contexto.
 */
export function trocou(a, b, contexto = 30) {
  if (a.length + b.length <= 160) return `${a} → ${b}`;
  let ini = 0;
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++;
  let fim = 0;
  while (fim < a.length - ini && fim < b.length - ini && a[a.length - 1 - fim] === b[b.length - 1 - fim]) fim++;
  const trecho = (t) => {
    const de = Math.max(0, ini - contexto);
    const ate = Math.min(t.length, t.length - fim + contexto);
    return `${de > 0 ? "…" : ""}${t.slice(de, ate)}${ate < t.length ? "…" : ""}`;
  };
  return `${trecho(a)} → ${trecho(b)}`;
}

/** A assinatura em uma linha, para o relatório. */
export function escreverAssinatura(item) {
  if (!item) return "(não existe)";
  if (item.tipo === "tipo") {
    const membros = item.membros ? Object.entries(item.membros).map(([n, m]) => `${n}${m.opcional ? "?" : ""}: ${m.texto}`) : [];
    const cabeca = item.texto.replace(/^ \| | \| $/g, "").replace(/( \| )+/g, " | ");
    return membros.length ? `${cabeca ? `${cabeca} ` : ""}{ ${membros.join("; ")} }` : cabeca;
  }
  return item.assinaturas
    .map((a) => a.declarado ?? `${a.genericos ? `<${a.genericos}>` : ""}(${a.parametros.map(escreveParametro).join(", ")})${a.retorno ? `: ${a.retorno}` : ""}`)
    .join(" ; ");
}

/** Chave que ignora nome de parâmetro: serve para achar a função renomeada. */
function chaveDeForma(item) {
  if (item.tipo === "tipo") return `tipo:${escreverAssinatura({ ...item, membros: item.membros })}`;
  return `funcao:${item.assinaturas
    .map((a) => a.declarado ?? `${a.genericos}(${a.parametros.map((p) => `${p.resto ? "..." : ""}${p.opcional ? "?" : ""}${p.tipo}`).join(",")}):${a.retorno ?? ""}`)
    .join(";")}`;
}

/**
 * Alinha os parâmetros das duas versões pelo tipo (maior subsequência comum,
 * com o nome desempatando),
 * para que um parâmetro inserido na frente saia como "novo na posição 1", e não
 * como uma cascata de "trocou de tipo". Dentro de cada trecho sem par, o que
 * sobra dos dois lados vira troca de tipo, e o excedente vira novo ou removido.
 * Devolve `[{ pa, pd, posicao }]` na ordem; `posicao` é 1-based, na versão nova
 * (ou na antiga, para o removido).
 */
function alinharParametros(antes, depois) {
  const chave = (p) => `${p.resto ? "..." : ""}${p.tipo}`;
  // Par de mesmo tipo vale 1; de mesmo tipo e mesmo nome, 2. Assim, entre dois
  // `string`, o que ficou com o mesmo nome é o que continua (o outro é o novo).
  const valor = (a, d) => (chave(a) !== chave(d) ? 0 : a.nome === d.nome ? 2 : 1);
  const n = antes.length;
  const m = depois.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) {
      const v = valor(antes[i], depois[j]);
      lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1], v ? v + lcs[i + 1][j + 1] : 0);
    }
  const passos = [];
  let i = 0;
  let j = 0;
  let soAntes = [];
  let soDepois = [];
  const descarregar = () => {
    const pares = Math.min(soAntes.length, soDepois.length);
    for (let k = 0; k < pares; k++) passos.push({ pa: antes[soAntes[k]], pd: depois[soDepois[k]], posicao: soDepois[k] + 1 });
    for (const k of soDepois.slice(pares)) passos.push({ pa: null, pd: depois[k], posicao: k + 1 });
    for (const k of soAntes.slice(pares)) passos.push({ pa: antes[k], pd: null, posicao: k + 1 });
    soAntes = [];
    soDepois = [];
  };
  while (i < n || j < m) {
    const v = i < n && j < m ? valor(antes[i], depois[j]) : 0;
    if (v && lcs[i][j] === v + lcs[i + 1][j + 1]) {
      descarregar();
      passos.push({ pa: antes[i], pd: depois[j], posicao: j + 1 });
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      soDepois.push(j++);
    } else {
      soAntes.push(i++);
    }
  }
  descarregar();
  return passos;
}

function motivosDaFuncao(antes, depois) {
  const motivos = [];
  if (antes.assinaturas.length !== depois.assinaturas.length) {
    motivos.push(`sobrecargas: ${antes.assinaturas.length} → ${depois.assinaturas.length}`);
    return motivos;
  }
  antes.assinaturas.forEach((a, k) => {
    const d = depois.assinaturas[k];
    const onde = antes.assinaturas.length > 1 ? ` (sobrecarga ${k + 1})` : "";
    if ((a.declarado ?? null) !== (d.declarado ?? null)) {
      motivos.push(`tipo declarado trocou${onde}: ${trocou(a.declarado ?? "(função)", d.declarado ?? "(função)")}`);
      return;
    }
    if (a.genericos !== d.genericos) motivos.push(`genéricos trocaram${onde}: <${a.genericos}> → <${d.genericos}>`);
    for (const passo of alinharParametros(a.parametros, d.parametros)) {
      const { pa, pd, posicao } = passo;
      const naPosicao = d.parametros.length > 1 || a.parametros.length > 1 ? ` na posição ${posicao}` : "";
      if (!pa) {
        motivos.push(`parâmetro novo ${pd.opcional || pd.resto ? "opcional" : "obrigatório"}${naPosicao}${onde}: ${escreveParametro(pd)}`);
      } else if (!pd) {
        motivos.push(`parâmetro removido${naPosicao}${onde}: ${escreveParametro(pa)}`);
      } else {
        if (pa.tipo !== pd.tipo && pa.membros && pd.membros && pa.resto === pd.resto) {
          for (const m of motivosDosMembros(pa.membros, pd.membros)) motivos.push(`parâmetro ${posicao} (${pd.nome})${onde}, ${m}`);
        } else if (pa.tipo !== pd.tipo || pa.resto !== pd.resto) {
          motivos.push(`parâmetro ${posicao} (${pd.nome}) trocou de tipo${onde}: ${trocou(pa.tipo, pd.tipo)}`);
        }
        if (pa.opcional && !pd.opcional) motivos.push(`parâmetro ${posicao} (${pd.nome}) passou a obrigatório${onde}`);
      }
    }
    if (a.retorno && d.retorno && a.retorno !== d.retorno) motivos.push(`retorno trocou${onde}: ${trocou(a.retorno, d.retorno)}`);
    else if (a.retorno && !d.retorno) motivos.push(`retorno perdeu a anotação${onde} (era ${a.retorno}; agora é inferido)`);
  });
  return motivos;
}

function motivosDosMembros(antes, depois) {
  const motivos = [];
  for (const [nome, m] of Object.entries(depois)) {
    const a = antes[nome];
    if (!a) motivos.push(`campo novo ${m.opcional ? "opcional" : "obrigatório"}: ${nome}${m.opcional ? "?" : ""}: ${m.texto}`);
    else {
      if (a.texto !== m.texto) motivos.push(`campo ${nome} trocou de tipo: ${trocou(a.texto, m.texto)}`);
      if (a.opcional && !m.opcional) motivos.push(`campo ${nome} passou a obrigatório`);
    }
  }
  for (const nome of Object.keys(antes)) {
    if (!(nome in depois)) motivos.push(`campo removido: ${nome}`);
  }
  return motivos;
}

function motivosDoTipo(antes, depois) {
  if (antes.texto !== depois.texto || !antes.membros !== !depois.membros) {
    return [`o tipo trocou: ${trocou(escreverAssinatura(antes), escreverAssinatura(depois))}`];
  }
  return antes.membros ? motivosDosMembros(antes.membros, depois.membros) : [];
}

/**
 * Compara as assinaturas exportadas de um mesmo arquivo nas duas versões.
 * Devolve só o que mudou: `{ nome, tipo, motivos, antes, depois, renomeadaPara? }`.
 * `outrosArquivos` (opcional): nome -> arquivo onde ele passou a ser exportado
 * na versão nova, para dizer "mudou de arquivo" em vez de "removida".
 */
export function compararAssinaturas(antes, depois, outrosArquivos = new Map()) {
  const mudancas = [];
  const sumiram = Object.keys(antes).filter((n) => !(n in depois));
  const novas = new Set(Object.keys(depois).filter((n) => !(n in antes)));

  for (const nome of Object.keys(antes)) {
    const a = antes[nome];
    const d = depois[nome];
    if (!d) continue;
    if (a.tipo !== d.tipo) {
      mudancas.push({ nome, tipo: d.tipo, motivos: [`deixou de ser ${a.tipo === "funcao" ? "função" : "tipo"}`], antes: escreverAssinatura(a), depois: escreverAssinatura(d) });
      continue;
    }
    const motivos = a.tipo === "funcao" ? motivosDaFuncao(a, d) : motivosDoTipo(a, d);
    if (motivos.length) mudancas.push({ nome, tipo: a.tipo, motivos, antes: escreverAssinatura(a), depois: escreverAssinatura(d) });
  }

  for (const nome of sumiram) {
    const a = antes[nome];
    const forma = chaveDeForma(a);
    const gemea = [...novas].find((n) => depois[n].tipo === a.tipo && chaveDeForma(depois[n]) === forma);
    if (gemea) {
      novas.delete(gemea);
      mudancas.push({ nome, tipo: a.tipo, motivos: [`renomeada: ${nome} → ${gemea}`], antes: escreverAssinatura(a), depois: escreverAssinatura(depois[gemea]), renomeadaPara: gemea });
    } else if (outrosArquivos.has(nome)) {
      mudancas.push({ nome, tipo: a.tipo, motivos: [`mudou de arquivo: agora em ${outrosArquivos.get(nome)}`], antes: escreverAssinatura(a), depois: "(em outro arquivo)" });
    } else {
      mudancas.push({ nome, tipo: a.tipo, motivos: ["removida"], antes: escreverAssinatura(a), depois: "(não existe)" });
    }
  }
  return mudancas;
}

/* ── Quem usa ───────────────────────────────────────────────────────────────*/

/** Para onde aponta um import, como caminho do repositório sem extensão. */
export function resolverImportacao(especificador, deArquivo) {
  let alvo;
  if (especificador.startsWith("@/")) alvo = especificador.slice(2);
  else if (especificador.startsWith(".")) alvo = posix.normalize(posix.join(posix.dirname(deArquivo), especificador));
  else return null;
  return alvo.replace(/\.(m|c)?(t|j)sx?$/, "").replace(/\/index$/, "");
}

export function semExtensao(arquivo) {
  return arquivo.replace(/\.(m|c)?tsx?$/, "").replace(/\/index$/, "");
}

/**
 * Onde um arquivo usa nomes importados de módulos vigiados.
 * `vigiados`: Map(caminho sem extensão -> Set(nomes)). Devolve
 * `[{ modulo, nome, linhas: [n…] }]`. A linha do import não conta como uso, mas
 * se o nome só aparece no import (tipo reexportado, por exemplo) a linha dele vale.
 */
export function usosNoArquivo(ts, texto, arquivo, vigiados) {
  const sf = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, true, arquivo.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const locais = new Map(); // nome local -> { modulo, nome, linhaDoImport }
  const linha = (no) => sf.getLineAndCharacterOfPosition(no.getStart(sf)).line + 1;
  for (const no of sf.statements) {
    if (!ts.isImportDeclaration(no) || !ts.isStringLiteral(no.moduleSpecifier)) continue;
    const modulo = resolverImportacao(no.moduleSpecifier.text, arquivo);
    const nomes = modulo && vigiados.get(modulo);
    const ligacoes = no.importClause?.namedBindings;
    if (!nomes || !ligacoes || !ts.isNamedImports(ligacoes)) continue;
    for (const e of ligacoes.elements) {
      const original = (e.propertyName ?? e.name).text;
      if (nomes.has(original)) locais.set(e.name.text, { modulo, nome: original, linhaDoImport: linha(e) });
    }
  }
  if (locais.size === 0) return [];
  const linhas = new Map([...locais.keys()].map((k) => [k, new Set()]));
  const visitar = (no) => {
    if (ts.isImportDeclaration(no)) return;
    if (ts.isIdentifier(no) && linhas.has(no.text)) {
      const pai = no.parent;
      const ehPropriedade = pai && (ts.isPropertyAccessExpression(pai) && pai.name === no || ts.isPropertyAssignment(pai) && pai.name === no || ts.isQualifiedName(pai) && pai.right === no);
      if (!ehPropriedade) linhas.get(no.text).add(linha(no));
    }
    ts.forEachChild(no, visitar);
  };
  visitar(sf);
  return [...locais].map(([local, info]) => {
    const usadas = [...linhas.get(local)].sort((x, y) => x - y);
    return { modulo: info.modulo, nome: info.nome, linhas: usadas.length ? usadas : [info.linhaDoImport] };
  });
}

/* ── Medição sobre o git ────────────────────────────────────────────────────*/

/** Lê muitos objetos `rev:caminho` de uma vez (`git cat-file --batch`). */
export function lerObjetos(especificacoes, cwd = process.cwd()) {
  const r = spawnSync("git", ["cat-file", "--batch"], { input: especificacoes.join("\n") + "\n", maxBuffer: 2 * 1024 * 1024 * 1024, cwd });
  const saida = r.stdout;
  const mapa = new Map();
  let pos = 0;
  for (const espec of especificacoes) {
    const fim = saida.indexOf(10, pos);
    const cabeca = saida.subarray(pos, fim).toString("utf8");
    pos = fim + 1;
    if (cabeca.endsWith(" missing") || cabeca.endsWith(" ambiguous")) continue;
    const tamanho = Number(cabeca.split(" ")[2]);
    mapa.set(espec, saida.subarray(pos, pos + tamanho).toString("utf8"));
    pos += tamanho + 1;
  }
  return mapa;
}

function listar(args, cwd) {
  const r = spawnSync("git", args, { encoding: "utf8", cwd, maxBuffer: 512 * 1024 * 1024 });
  return (r.stdout ?? "").split("\n").filter(Boolean);
}

/**
 * Quem, entre `arquivos` (lidos em `rev`), usa os nomes vigiados. Anota em
 * `porChave`. Com `linhasQueContam` (arquivo -> Set de linhas), só vale o uso
 * nessas linhas.
 */
function anotarUsos(ts, rev, arquivos, vigiados, porChave, cwd, linhasQueContam = null) {
  if (arquivos.length === 0 || vigiados.size === 0) return;
  const textos = lerObjetos(arquivos.map((f) => `${rev}:${f}`), cwd);
  for (const f of arquivos) {
    const texto = textos.get(`${rev}:${f}`);
    if (texto === undefined) continue;
    for (const u of usosNoArquivo(ts, texto, f, vigiados)) {
      const m = porChave.get(`${u.modulo}#${u.nome}`);
      if (!m || semExtensao(m.arquivo) === semExtensao(f)) continue;
      const linhas = linhasQueContam ? u.linhas.filter((l) => linhasQueContam.get(f)?.has(l)) : u.linhas;
      if (linhas.length) m.chamadores.push(`${f}:${linhas.join(",")}`);
    }
  }
}

/** As linhas que a faixa acrescentou em cada arquivo (`git diff -U0`), na versão nova. */
function linhasAcrescentadas(antes, depois, arquivos, cwd) {
  const porArquivo = new Map();
  if (arquivos.length === 0) return porArquivo;
  const r = spawnSync("git", ["diff", "-U0", "--no-color", "--no-ext-diff", "-M", antes, depois, "--", ...arquivos], { encoding: "utf8", cwd, maxBuffer: 1024 * 1024 * 1024 });
  let atual = null;
  for (const l of (r.stdout ?? "").split("\n")) {
    if (l.startsWith("+++ ")) {
      atual = l === "+++ /dev/null" ? null : l.slice(6);
      if (atual && !porArquivo.has(atual)) porArquivo.set(atual, new Set());
    } else if (atual && l.startsWith("@@")) {
      const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l);
      if (!h) continue;
      const ini = Number(h[1]);
      const qtd = h[2] === undefined ? 1 : Number(h[2]);
      for (let k = 0; k < qtd; k++) porArquivo.get(atual).add(ini + k);
    }
  }
  return porArquivo;
}

/** Dos `arquivos`, os que citam algum dos nomes como palavra (filtro barato antes de ler). */
function queCitam(rev, nomes, arquivos, cwd) {
  if (nomes.length === 0) return [];
  const dentro = new Set(arquivos);
  return listar(["grep", "-l", "-w", "-F", ...nomes.flatMap((n) => ["-e", n]), rev, "--", ...EXTENSOES.map((e) => `*${e}`)], cwd)
    .map((l) => l.slice(rev.length + 1))
    .filter((f) => dentro.has(f));
}

function vigiar(lista) {
  const vigiados = new Map();
  const porChave = new Map();
  for (const m of lista) {
    for (const arq of [m.arquivo, m.arquivoAntes].filter(Boolean)) {
      const chave = semExtensao(arq);
      if (!vigiados.has(chave)) vigiados.set(chave, new Set());
      vigiados.get(chave).add(m.nome);
      porChave.set(`${chave}#${m.nome}`, m);
    }
  }
  return { vigiados, porChave };
}

/**
 * Mudança que quem chama do jeito antigo não sente: parâmetro opcional a mais no
 * fim, ou campo opcional a mais. O resto (parâmetro no meio, obrigatório, tipo
 * trocado, removido, renomeado) provavelmente quebra.
 */
export function acrescimoInofensivo(motivo, totalDeParametrosAntes) {
  if (/(^|, )campo novo opcional/.test(motivo)) return true;
  const fimDaLista = /^parâmetro novo opcional(?: na posição (\d+))?/.exec(motivo);
  return Boolean(fimDaLista && (!fimDaLista[1] || Number(fimDaLista[1]) > totalDeParametrosAntes));
}

/**
 * A medição inteira. `antes` e `depois` são as duas pontas do upstream (na
 * sincronização: a base da fusão e o upstream); `cabeca` é o fork. Só lê o git.
 *
 * Devolve:
 *   · `mudancas`: o que o upstream mudou na faixa, e quem usa no fork
 *     (`chamadores`, arquivos nossos);
 *   · `divergencias`: o que o fork mudou num arquivo do upstream (bloco
 *     `FORK MIA`) e que código do upstream novo na faixa chama do jeito dele.
 *     Foi o `hubSections` da 1.107: ele não mudou no upstream, mas um teste novo
 *     dele chamava com os parâmetros dele, e o fork tem dois a mais no meio.
 */
export function medirAssinaturas({ ts, antes, depois, cabeca = "HEAD", cwd = process.cwd() }) {
  // 1. Arquivos de código do upstream que mudaram na faixa (renomeação incluída).
  const pares = [];
  const tocadosNaFaixa = [];
  for (const l of listar(["diff", "--name-status", "-M", antes, depois], cwd)) {
    const [status, a, b] = l.split("\t");
    const s = status[0];
    const velho = a;
    const novo = s === "R" ? b : s === "D" ? null : a;
    if (novo && ehCodigo(novo)) tocadosNaFaixa.push(novo);
    if (s === "A") continue; // arquivo novo: ninguém nosso o chama ainda
    if (ehCodigo(velho) && !velho.endsWith(".d.ts")) pares.push({ velho, novo });
  }
  const textos = lerObjetos([...pares.map((p) => `${antes}:${p.velho}`), ...pares.filter((p) => p.novo).map((p) => `${depois}:${p.novo}`)], cwd);

  // 2. Exportações novas de todos os arquivos tocados: para dizer "mudou de arquivo".
  const leituraNova = new Map();
  const exportadoEm = new Map();
  for (const p of pares) {
    const texto = p.novo ? textos.get(`${depois}:${p.novo}`) : undefined;
    if (texto !== undefined) leituraNova.set(p.novo, assinaturasDoArquivo(ts, texto, p.novo));
  }
  for (const [arq, ass] of leituraNova) for (const n of Object.keys(ass)) if (!exportadoEm.has(n)) exportadoEm.set(n, arq);

  const mudancas = [];
  for (const p of pares) {
    const textoAntes = textos.get(`${antes}:${p.velho}`);
    if (textoAntes === undefined) continue;
    const a = assinaturasDoArquivo(ts, textoAntes, p.velho);
    if (Object.keys(a).length === 0) continue;
    const d = p.novo ? (leituraNova.get(p.novo) ?? {}) : {};
    const fora = new Map([...exportadoEm].filter(([, arq]) => arq !== p.novo));
    for (const m of compararAssinaturas(a, d, fora)) {
      const total = a[m.nome]?.tipo === "funcao" ? Math.max(...a[m.nome].assinaturas.map((x) => x.parametros.length)) : 0;
      const provavelQuebra = m.motivos.some((x) => !acrescimoInofensivo(x, total));
      mudancas.push({ arquivo: p.novo ?? p.velho, ...(p.novo && p.novo !== p.velho ? { arquivoAntes: p.velho } : {}), ...m, provavelQuebra, chamadores: [] });
    }
  }

  // 3. Quem é nosso na cabeça: o que a base da faixa não tem, ou o que tem `FORK MIA`.
  const base = listar(["merge-base", cabeca, depois], cwd)[0];
  const naBase = new Set(listar(["ls-tree", "-r", "--name-only", base], cwd));
  const naCabeca = listar(["ls-tree", "-r", "--name-only", cabeca], cwd).filter(ehCodigo);
  const comMarca = listar(["grep", "-l", "-F", "FORK MIA", cabeca, "--", ...EXTENSOES.map((e) => `*${e}`)], cwd).map((l) => l.slice(cabeca.length + 1));
  const nossos = new Set([...naCabeca.filter((f) => !naBase.has(f)), ...comMarca]);

  // 4. Dos nossos, quem cita algum dos nomes e de fato importa do módulo.
  {
    const { vigiados, porChave } = vigiar(mudancas);
    const nomes = [...new Set(mudancas.map((m) => m.nome))];
    anotarUsos(ts, cabeca, queCitam(cabeca, nomes, [...nossos], cwd), vigiados, porChave, cwd);
  }

  // 5. O fork diverge num arquivo do upstream que a faixa NÃO mudou ali (então a
  //    fusão mantém a assinatura do fork), e o upstream acrescentou na faixa uma
  //    chamada do jeito dele. Se o upstream também mudou o nome, quem cuida é o
  //    passo 2 (ou o conflito).
  const mudouNaFaixa = new Set(mudancas.map((m) => `${m.arquivo}#${m.nome}`));
  const naDepois = new Set(listar(["ls-tree", "-r", "--name-only", depois], cwd));
  const marcadosDoUpstream = comMarca.filter((f) => naDepois.has(f) && !f.endsWith(".d.ts"));
  const lidos = lerObjetos([...marcadosDoUpstream.map((f) => `${cabeca}:${f}`), ...marcadosDoUpstream.map((f) => `${depois}:${f}`)], cwd);
  const divergencias = [];
  for (const f of marcadosDoUpstream) {
    const doFork = lidos.get(`${cabeca}:${f}`);
    const doUpstream = lidos.get(`${depois}:${f}`);
    if (doFork === undefined || doUpstream === undefined || doFork === doUpstream) continue;
    const u = assinaturasDoArquivo(ts, doUpstream, f);
    const k = assinaturasDoArquivo(ts, doFork, f);
    const comparaveis = (o) => Object.fromEntries(Object.entries(o).filter(([n]) => n in u && n in k && !mudouNaFaixa.has(`${f}#${n}`)));
    for (const m of compararAssinaturas(comparaveis(u), comparaveis(k))) {
      const total = u[m.nome]?.tipo === "funcao" ? Math.max(...u[m.nome].assinaturas.map((a) => a.parametros.length)) : 0;
      const motivos = m.motivos.filter((x) => !acrescimoInofensivo(x, total));
      if (motivos.length) divergencias.push({ arquivo: f, nome: m.nome, tipo: m.tipo, motivos, upstream: m.antes, fork: m.depois, chamadores: [] });
    }
  }
  if (divergencias.length) {
    const { vigiados, porChave } = vigiar(divergencias);
    const nomes = [...new Set(divergencias.map((m) => m.nome))];
    const chamam = queCitam(depois, nomes, tocadosNaFaixa, cwd);
    anotarUsos(ts, depois, chamam, vigiados, porChave, cwd, linhasAcrescentadas(antes, depois, chamam, cwd));
  }

  const ordem = (x, y) =>
    Number(Boolean(y.provavelQuebra)) - Number(Boolean(x.provavelQuebra)) ||
    y.chamadores.length - x.chamadores.length ||
    x.arquivo.localeCompare(y.arquivo) ||
    x.nome.localeCompare(y.nome);
  for (const m of [...mudancas, ...divergencias]) m.chamadores.sort();
  mudancas.sort(ordem);
  return {
    arquivosLidos: pares.length,
    mudancas,
    divergencias: divergencias.filter((d) => d.chamadores.length > 0).sort(ordem),
  };
}

/**
 * As linhas da seção "Assinaturas que mudaram", para o relatório em texto.
 * O que não tem uso nosso só entra na contagem (a lista inteira fica no JSON),
 * a não ser que `maxSemChamador` peça algumas.
 */
export function linhasDaSecao(resultado, { maxSemChamador = 0 } = {}) {
  const linhas = [];
  const corta = (t) => (t.length > 240 ? `${t.slice(0, 240)}… (inteira no --json)` : t);
  const comChamador = resultado.mudancas.filter((m) => m.chamadores.length > 0);
  const quebram = comChamador.filter((m) => m.provavelQuebra);
  const soAcrescimo = comChamador.filter((m) => !m.provavelQuebra);
  const semChamador = resultado.mudancas.filter((m) => m.chamadores.length === 0);
  linhas.push(
    `Assinaturas que mudaram: ${resultado.mudancas.length} no upstream, ${comChamador.length} usadas por arquivo nosso, ${quebram.length} provavelmente quebram quem usa`,
  );
  for (const m of quebram) {
    linhas.push(`   ${m.arquivo} · ${m.tipo === "funcao" ? "função" : "tipo"} ${m.nome}`);
    for (const motivo of m.motivos) linhas.push(`      ${motivo}`);
    linhas.push(`      antes:  ${corta(m.antes)}`);
    linhas.push(`      depois: ${corta(m.depois)}`);
    linhas.push(`      quem usa: ${m.chamadores.join("  ")}`);
  }
  if (soAcrescimo.length) {
    linhas.push(`   só acréscimo opcional, não deve quebrar: ${soAcrescimo.length}`);
    for (const m of soAcrescimo) linhas.push(`      ${m.arquivo} · ${m.nome}: ${corta(m.motivos.join("; "))} (usada em ${m.chamadores.length} arquivo(s) nosso(s))`);
  }
  if (semChamador.length) {
    linhas.push(`   sem uso nosso: ${semChamador.length}${maxSemChamador ? "" : " (lista no --json)"}`);
    for (const m of semChamador.slice(0, maxSemChamador)) linhas.push(`      ${m.arquivo} · ${m.nome}: ${corta(m.motivos.join("; "))}`);
  }
  const divergencias = resultado.divergencias ?? [];
  linhas.push(`O fork mudou a assinatura e o upstream novo chama do jeito dele: ${divergencias.length}`);
  for (const m of divergencias) {
    linhas.push(`   ${m.arquivo} · ${m.tipo === "funcao" ? "função" : "tipo"} ${m.nome} (bloco FORK MIA)`);
    for (const motivo of m.motivos) linhas.push(`      do upstream para o fork: ${motivo}`);
    linhas.push(`      upstream: ${corta(m.upstream)}`);
    linhas.push(`      fork:     ${corta(m.fork)}`);
    linhas.push(`      quem chama no upstream: ${m.chamadores.join("  ")}`);
  }
  return linhas;
}

/* ── Linha de comando ───────────────────────────────────────────────────────*/

const ehPrincipal = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (ehPrincipal) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const comoJson = process.argv.includes("--json");
  const [antes, depois, cabeca = "HEAD"] = args;
  if (!antes || !depois) {
    process.stderr.write("uso: node scripts/assinaturas-do-upstream.mjs <antes> <depois> [cabeca] [--json]\n");
    process.exit(2);
  }
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
  const ts = await carregarTypescript(raiz);
  if (!ts) {
    process.stderr.write("typescript não encontrado: rode `npm ci` (ou use uma worktree com node_modules).\n");
    process.exit(2);
  }
  const resultado = medirAssinaturas({ ts, antes, depois, cabeca });
  if (comoJson) process.stdout.write(JSON.stringify(resultado, null, 2) + "\n");
  else process.stdout.write(`${antes} → ${depois}, quem usa em ${cabeca}\n` + linhasDaSecao(resultado, { maxSemChamador: 30 }).join("\n") + "\n");
}
