/**
 * FORK MIA (.89) — A BUSCA DO "COMO FAÇO?": quem casa com a pergunta, e em que ordem.
 *
 * O assistente procura em quatro lugares (os manuais do fork, o guia de
 * operação do upstream, o mapa das telas e a base da empresa) e todos passam
 * pela MESMA régua, para a ordem entre eles ser justa:
 *
 *   - sem acento, sem diferença de maiúscula, "e-mail" = "email",
 *     "follow-up" = "followup";
 *   - um radical leve do português ("conecto" = "conectar", "conversões" =
 *     "conversão"), que NÃO junta "conversa" com "conversão": são coisas
 *     diferentes no sistema (o chat e o evento que volta para o anúncio);
 *   - sinônimos do jeito que a equipe fala (MCP, token e chave, número e
 *     WhatsApp, follow-up e retomada), que valem menos que a palavra dita;
 *   - palavra rara pesa mais que palavra que está em todo lugar ("agente",
 *     "cliente");
 *   - a TELA em que a pessoa está pesa: "como uso isso aqui", perguntado na
 *     tela X, traz a ajuda da tela X primeiro.
 *
 * Determinística e sem IA: a mesma pergunta, na mesma tela, dá a mesma ordem
 * (`tests/unit/assistente-perguntas-reais.test.ts`). Módulo PURO.
 */

/** Telas que são só a porta de um grupo: estar nelas não diz nada do assunto. */
export const HUBS: ReadonlySet<string> = new Set(["/app", "/app/crm", "/app/ai", "/app/analise", "/app/settings"]);

const VAZIAS = new Set([
  "como", "onde", "fica", "faco", "faz", "fazer", "para", "pra", "pro", "uma", "um", "uns", "umas", "os", "as", "de",
  "do", "da", "dos", "das", "no", "na", "nos", "nas", "eu", "meu", "minha", "meus", "minhas", "que", "em", "com",
  "por", "se", "qual", "quais", "tem", "ter", "ver", "vejo", "posso", "consigo", "configurar", "configuro",
  "configura", "sistema", "aqui", "isso", "isto", "essa", "esse", "esta", "este", "nessa", "nesse", "nesta",
  "neste", "dessa", "desse", "desta", "deste", "tela", "pagina", "usar", "uso", "usa", "funciona", "funcionar",
  "ajuda", "preciso", "quero", "queria", "gostaria", "sobre", "pelo", "pela", "mais", "nao", "sim", "ele", "ela",
  "eles", "elas", "voce", "voces", "vou", "vai", "sao", "ser", "estar", "tenho", "ficam", "algum", "alguma",
  "alguem", "dar", "dou", "da", "dela", "dele", "seu", "sua", "seus", "suas", "mim", "me", "nosso", "nossa",
  "the", "and", "una", "los", "las", "del", "cual", "donde", "hago", "quiero", "sobre", "ja", "agora", "hoje",
  "depois", "antes", "tudo", "todo", "toda", "todos", "todas", "cada", "outro", "outra", "certo", "jeito",
  "forma", "maneira", "passo", "passos", "explica", "explicar", "mostra", "mostrar", "saber", "sei", "entendo",
  "entender", "acontece", "acontecer", "deixa", "deixar", "coloco", "colocar", "boto", "botar", "mexo",
  "mexer", "acho", "achar", "encontro", "encontrar", "consegue", "conseguir", "pode", "podem",
]);

/** Palavras curtas que dizem muito. */
const CURTAS = new Set(["ia", "qr", "ti", "pj", "cv"]);

/** A pergunta aponta para a tela em que a pessoa está. */
const DEITICOS = /\b(aqui|isso|isto|essa tela|esta tela|nessa tela|nesta tela|dessa tela|desta tela|essa pagina|esta pagina|nessa pagina|nesta pagina|desse jeito|aca|esta pantalla|esa pantalla)\b/;

export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/e-mails?/g, (m) => m.replace("-", ""))
    .replace(/follow[\s-]?ups?/g, "followup")
    .replace(/whats\s?app/g, "whatsapp")
    .replace(/check[\s-]?in/g, "checkin")
    .replace(/opt[\s-]?out/g, "optout");
}

const SUFIXOS_VERBAIS = [
  "ando", "endo", "indo", "ados", "adas", "idos", "idas", "ado", "ada", "ido", "ida", "ar", "er", "ir", "ou",
  "ei", "am", "em", "es", "o", "a", "e",
];

/** Um radical leve: plural, gênero e as formas de verbo mais comuns. */
export function radical(palavra: string): string {
  let p = palavra;
  if (p.length <= 3) return p;
  if (p.endsWith("coes") || p.endsWith("soes") || p.endsWith("oes") || p.endsWith("aes")) p = `${p.slice(0, -3)}ao`;
  else if (p === "funis") p = "funil";
  else if (p.endsWith("ais") && p.length > 4) p = `${p.slice(0, -3)}al`;
  else if (p.endsWith("eis") && p.length > 4) p = `${p.slice(0, -3)}el`;
  else if (p.endsWith("ns") && p.length > 4) p = `${p.slice(0, -2)}m`;
  else if (p.endsWith("s") && !p.endsWith("ss") && p.length > 4) p = p.slice(0, -1);
  if (p.endsWith("ao")) return p;
  for (const s of SUFIXOS_VERBAIS) {
    if (p.endsWith(s) && p.length - s.length >= 3) return p.slice(0, -s.length);
  }
  return p;
}

/** Radicais de nominalização: "importar" casa "importação", "agendar" casa "agendamento". */
const DERIVADOS = ["acao", "icao", "cao", "amento", "imento", "mento", "ador", "adora", "avel", "ivel"];

function casam(a: string, b: string): boolean {
  if (a === b) return true;
  const [curto, longo] = a.length <= b.length ? [a, b] : [b, a];
  if (curto.length < 4) return false;
  if (!longo.startsWith(curto)) return false;
  return DERIVADOS.includes(longo.slice(curto.length));
}

/** As palavras de busca de um texto, já no radical. */
export function termos(texto: string): string[] {
  return normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter((p) => (p.length >= 3 || CURTAS.has(p)) && !VAZIAS.has(p))
    .map(radical);
}

/**
 * Os sinônimos de como a equipe pergunta. Cada grupo vale para todos os seus
 * membros; a palavra dita pesa mais que o sinônimo.
 */
const GRUPOS_DE_SINONIMOS: readonly (readonly string[])[] = [
  ["mcp", "servidor", "ferramenta", "claude", "chatgpt", "integracao", "integrar"],
  ["token", "chave", "api"],
  ["numero", "whatsapp", "zap", "canal", "conexao", "conectar", "telefone"],
  ["followup", "retomada", "retomar", "regua", "cadencia", "acompanhamento", "reengajar"],
  ["email", "mail", "newsletter"],
  ["convidar", "convite", "convida"],
  ["campanha", "disparo", "disparar", "broadcast", "massa", "transmissao"],
  ["funil", "pipeline", "kanban", "quadro"],
  ["negocio", "oportunidade", "card", "cartao", "deal"],
  ["contato", "cliente", "lead", "paciente", "aluno"],
  ["agente", "robo", "bot", "ia", "sdr", "inteligencia"],
  ["horario", "expediente", "madrugada", "noite"],
  ["relatorio", "grafico", "dashboard", "painel", "indicador", "numeros"],
  ["conversao", "pixel", "capi", "otimizar"],
  ["formulario", "cadastro"],
  ["equipe", "usuario", "membro", "vendedor", "atendente", "funcionario"],
  ["senha", "mfa", "autenticador", "verificacao", "seguranca"],
  ["etiqueta", "tag", "marcador"],
  ["agenda", "agendamento", "agendar", "compromisso", "reuniao", "consulta", "marcar"],
  ["outlook", "microsoft", "teams", "office"],
  ["fatura", "boleto", "cobranca", "plano", "assinatura", "mensalidade"],
  ["saldo", "credito", "carteira", "recarga", "recarregar"],
  ["app", "aplicativo", "instalar", "pwa"],
  ["obrigacao", "documento", "vencimento", "validade", "alvara", "renovacao", "vencer"],
  ["empresa", "cnpj", "pj", "b2b"],
  ["chamado", "suporte", "erro", "bug", "problema", "ticket"],
  ["vender", "venda", "vendendo", "fechar", "fechamento", "ganho", "resultado"],
  ["anuncio", "ads", "facebook", "instagram", "trafego"],
  ["google", "adwords"],
  ["banco", "erp", "mysql", "postgres", "estoque", "dados"],
  ["perdido", "perder", "perda"],
  ["demonstracao", "demo", "teste", "ficticio"],
  ["notificacao", "aviso", "alerta", "sino"],
  ["proposta", "orcamento"],
];

const SINONIMOS: ReadonlyMap<string, readonly string[]> = (() => {
  const mapa = new Map<string, string[]>();
  for (const grupo of GRUPOS_DE_SINONIMOS) {
    const radicais = [...new Set(grupo.map((p) => radical(normalizar(p))))];
    for (const r of radicais) mapa.set(r, [...new Set([...(mapa.get(r) ?? []), ...radicais.filter((x) => x !== r)])]);
  }
  return mapa;
})();

/** Os sinônimos de um radical (sem ele mesmo). */
export function sinonimosDe(r: string): readonly string[] {
  for (const [chave, lista] of SINONIMOS) if (casam(chave, r)) return lista;
  return [];
}

/** Um documento da busca: o título pesa mais, as palavras-chave em seguida, o corpo menos. */
export interface DocumentoDeBusca<T> {
  item: T;
  titulo: string;
  chaves?: string;
  corpo: string;
  /** As telas a que o documento está ligado (`/app/...`), para o peso da tela atual. */
  telas: readonly string[];
  /** Quanto a fonte vale por si (o manual do fork vale mais que a linha do mapa). */
  peso: number;
}

interface Indexado<T> {
  doc: DocumentoDeBusca<T>;
  titulo: ReadonlySet<string>;
  chaves: ReadonlySet<string>;
  corpo: ReadonlySet<string>;
}

export interface Indice<T> {
  docs: readonly Indexado<T>[];
  /** Em quantos documentos cada radical aparece (para palavra rara pesar mais). */
  frequencia: ReadonlyMap<string, number>;
  /** Todas as telas a que algum documento está ligado. */
  telas: ReadonlySet<string>;
}

export function indexar<T>(docs: readonly DocumentoDeBusca<T>[]): Indice<T> {
  const frequencia = new Map<string, number>();
  const indexados = docs.map((doc) => {
    const titulo = new Set(termos(doc.titulo));
    const chaves = new Set(termos(doc.chaves ?? ""));
    const corpo = new Set(termos(doc.corpo));
    for (const r of new Set([...titulo, ...chaves, ...corpo])) frequencia.set(r, (frequencia.get(r) ?? 0) + 1);
    return { doc, titulo, chaves, corpo };
  });
  return { docs: indexados, frequencia, telas: new Set(docs.flatMap((d) => d.telas)) };
}

function contem(conjunto: ReadonlySet<string>, r: string): boolean {
  if (conjunto.has(r)) return true;
  for (const x of conjunto) if (casam(x, r)) return true;
  return false;
}

/** A tela da pergunta casa com a tela do documento (a mesma, ou uma subpágina dela)? */
export function mesmaTela(caminho: string | null | undefined, tela: string): boolean {
  if (!caminho) return false;
  if (caminho === tela) return true;
  if (HUBS.has(tela)) return false;
  return caminho.startsWith(`${tela}/`);
}

/**
 * A tela da ajuda que vale para o caminho em que a pessoa está: a mais
 * específica que alguma ajuda conhece. Em `/app/settings/tenant/agenda` vale
 * Tipos de agendamento, e não Organização (`/app/settings/tenant`); em
 * `/app/ai/agents/abc` vale Agentes.
 */
export function telaDaAjuda(telas: ReadonlySet<string>, caminho: string | null | undefined): string | null {
  if (!caminho) return null;
  let melhor: string | null = null;
  for (const t of telas) {
    if (mesmaTela(caminho, t) && (!melhor || t.length > melhor.length)) melhor = t;
  }
  return melhor;
}

export function perguntaApontaATela(pergunta: string): boolean {
  return DEITICOS.test(normalizar(pergunta));
}

export interface Achado<T> {
  item: T;
  pontos: number;
  /** O documento é da tela em que a pessoa está. */
  daTela: boolean;
}

/**
 * Os documentos que casam com a pergunta, do mais para o menos parecido.
 * Sem palavra útil na pergunta ("como uso isso aqui?"), vale só a tela.
 */
export function buscar<T>(
  indice: Indice<T>,
  pergunta: string,
  opcoes: { caminho?: string | null; limite?: number } = {},
): Achado<T>[] {
  const busca = [...new Set(termos(pergunta))];
  const apontaATela = perguntaApontaATela(pergunta) || busca.length <= 1;
  const total = Math.max(indice.docs.length, 1);
  const raridade = (r: string) => {
    let df = indice.frequencia.get(r) ?? 0;
    if (df === 0) for (const [x, n] of indice.frequencia) if (casam(x, r)) df = Math.max(df, n);
    return Math.log(1 + total / (1 + df));
  };

  const consulta = busca.map((r) => ({ r, peso: raridade(r), sinonimos: sinonimosDe(r) }));
  const telaAtual = telaDaAjuda(indice.telas, opcoes.caminho);

  const achados: Achado<T>[] = [];
  for (const d of indice.docs) {
    let pontos = 0;
    let casadas = 0;
    for (const { r, peso, sinonimos } of consulta) {
      let melhor = 0;
      const noTitulo = contem(d.titulo, r);
      const nasChaves = contem(d.chaves, r);
      const noCorpo = contem(d.corpo, r);
      if (noTitulo) melhor = 3;
      else if (nasChaves) melhor = 2.5;
      else if (noCorpo) melhor = 1;
      // O documento que fala do assunto em mais de um lugar é mais "sobre" ele.
      if (melhor > 0) melhor += 0.25 * (Number(noTitulo) + Number(nasChaves) + Number(noCorpo) - 1);
      if (melhor === 0) {
        for (const s of sinonimos) {
          if (contem(d.titulo, s)) melhor = Math.max(melhor, 1.8);
          else if (contem(d.chaves, s)) melhor = Math.max(melhor, 1.5);
          else if (contem(d.corpo, s)) melhor = Math.max(melhor, 0.5);
        }
      }
      if (melhor > 0) casadas += 1;
      pontos += melhor * peso;
    }
    if (busca.length > 0) pontos *= 0.4 + 0.6 * (casadas / busca.length);
    pontos *= d.doc.peso;

    const daTela = telaAtual !== null && d.doc.telas.includes(telaAtual);
    if (daTela) {
      // Em "como uso isso aqui", a ajuda cuja tela PRINCIPAL é esta vem antes da
      // que só passa por ela (o roteiro que cruza várias telas).
      const principal = d.doc.telas[0] === telaAtual;
      pontos = apontaATela ? pontos + (principal ? 9 : 7) : pontos * 1.25 + 0.5;
    }
    if (pontos <= 0) continue;
    achados.push({ item: d.doc.item, pontos, daTela });
  }
  achados.sort((a, b) => b.pontos - a.pontos);
  return achados.slice(0, opcoes.limite ?? 8);
}
