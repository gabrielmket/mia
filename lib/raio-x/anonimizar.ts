/**
 * FORK MIA (.101) · OS TRECHOS DE CONVERSA DO RELATÓRIO, ANONIMIZADOS. PURO.
 *
 * O relatório circula (dono, sócio, vendedor), então o trecho de conversa que
 * ele mostra (decisão 7):
 *
 *  - é CURTO (até 180 caracteres por balão, até 4 balões por conversa);
 *  - não leva telefone, e-mail, documento (CPF, CNPJ), CEP, placa nem link;
 *  - troca nome próprio por [nome]: o nome de perfil do cliente (que o
 *    servidor conhece), nomes depois de "me chamo", "aqui é o", "oi", "bom
 *    dia"..., e os prenomes mais comuns do Brasil escritos com inicial
 *    maiúscula.
 *
 * O que ESCAPA, dito para a ausência não virar garantia: um sobrenome raro
 * escrito sozinho no meio da frase, sem gatilho e fora da lista. Por isso a Time
 * REVISA o relatório antes do link do dono (decisão 10), e a revisão é a última
 * barreira.
 *
 * A limpeza mínima (`tirarIdentificadores`) passa também no texto que vai ao
 * modelo de IA: telefone, e-mail e documento nunca saem do servidor.
 */

export const TAMANHO_DO_BALAO = 180;

const TROCAS_FIXAS: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[e-mail]"],
  [/\b(?:https?:\/\/|www\.)\S+/gi, "[link]"],
  // CPF e CNPJ PONTUADOS. Os 11 ou 14 dígitos corridos são ambíguos (um
  // celular com DDD também tem 11): caem no telefone ou na sequência longa
  // abaixo, e somem do mesmo jeito.
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[documento]"],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}\b/g, "[documento]"],
  // Telefone: +55, DDD entre parênteses ou não, 8 ou 9 dígitos com hífen ou espaço.
  [/(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?9?\d{4}[\s.-]?\d{4}\b/g, "[telefone]"],
  // CEP.
  [/\b\d{5}-\d{3}\b/g, "[cep]"],
  // Placa de veículo (antiga e Mercosul).
  [/\b[A-Za-z]{3}-?\d[A-Za-z0-9]\d{2}\b/g, "[placa]"],
  // Qualquer outra sequência longa de dígitos (cartão, protocolo, RG).
  [/\d(?:[\s.-]?\d){7,}/g, "[número]"],
];

/** Prenomes muito comuns no Brasil; com inicial maiúscula, viram [nome]. */
const PRENOMES = new Set(
  (
    "ana maria joao jose antonio francisco carlos paulo pedro lucas luiz luis marcos marcio luana " +
    "gabriel rafael daniel marcelo bruno eduardo felipe rodrigo fernando ricardo andre fabio " +
    "leonardo gustavo guilherme thiago tiago diego vinicius matheus mateus juliano julio cesar " +
    "sergio roberto renato alexandre leandro alex adriano anderson wellington washington " +
    "jefferson everton edson elton igor caio henrique hugo otavio arthur artur miguel davi " +
    "heitor bernardo samuel enzo murilo nicolas joaquim benicio raul vitor victor wesley " +
    "francisca antonia adriana juliana marcia fernanda patricia aline sandra camila amanda " +
    "bruna jessica leticia julia beatriz larissa mariana vanessa gabriela rafaela daniela " +
    "luciana simone cristiane renata viviane carla debora isabela isabella sophia sofia " +
    "alice laura valentina helena manuela livia lorena yasmin raquel tatiane priscila " +
    "michele monica claudia rosana rosangela silvia vera regina lucia sonia teresa tereza " +
    "eliane elaine denise solange cintia natalia carolina karina kelly bianca paula " +
    "priscilla thais tais jaqueline cristina luciene marlene ivone joana rita rosa clara " +
    "eduarda giovana giovanna heloisa luiza luisa melissa nathalia sabrina tamires " +
    "vitoria stephanie stefany samara rebeca milena lara emanuelly emily"
  ).split(/\s+/),
);

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SEM_ACENTO = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const PALAVRA_COM_MAIUSCULA = /\p{Lu}[\p{Ll}\p{M}]+/gu;

/**
 * Gatilhos que costumam vir antes de um nome: o nome que vem logo depois (uma
 * ou duas palavras com inicial maiúscula) vira [nome].
 *
 * SEM a flag `i` de propósito: com ela, `\p{Lu}` casa letra minúscula também, e
 * "oi tudo bem" viraria "oi [nome] bem". A caixa do gatilho é tolerada letra a
 * letra (`[oO][iI]`), a do nome não.
 */
const PALAVRAS_GATILHO = [
  "me chamo", "meu nome é", "meu nome e", "aqui é o", "aqui é a", "aqui e o", "aqui e a",
  "sou o", "sou a", "fala com o", "fala com a", "falar com o", "falar com a",
  "oi", "olá", "ola", "bom dia", "boa tarde", "boa noite", "obrigado", "obrigada", "valeu",
  "tchau", "prezado", "prezada", "senhor", "senhora", "sr.", "sra.", "dr.", "dra.", "dona",
];

function semCaixa(palavra: string): string {
  return [...palavra]
    .map((c) => (c.toLowerCase() !== c.toUpperCase() ? `[${c.toLowerCase()}${c.toUpperCase()}]` : escaparRegex(c)))
    .join("");
}

/**
 * Palavras que abrem frase com maiúscula e NÃO são nome ("Boa tarde! Me chamo
 * Genoveva": o "Me" não pode virar [nome], e o "me chamo" tem de ser achado
 * depois). Ficam num lookahead negativo, para o motor seguir procurando a partir
 * da palavra seguinte em vez de consumir o trecho.
 */
const NAO_SAO_NOME = (
  "Me Eu Você Voce Vc Vocês Voces Tudo Gostaria Quero Queria Tem Teria Qual Quais Quanto Quanta " +
  "Preciso Estou Sou Aqui Por Pode Podem Poderia Obrigado Obrigada Bom Boa Olá Ola Oi Sim Não Nao " +
  "Ok Blz Beleza Gente Pessoal Amigo Amiga Senhor Senhora Vi Estava Ainda Como Onde Quando Que " +
  "Esse Essa Este Esta Isso Bem Tá Ta Já Ja Agora Hoje Amanhã Amanha Ontem Desculpa Desculpe " +
  "Prezado Prezada Dúvida Duvida Favor Mais Meu Minha Nós Nos Vou Vamos Pra Para Se Seria Será " +
  "Sera Consegue Consigo Pois Então Entao Certo Claro Perfeito Show Top Valeu Opa Fala Grato Grata " +
  "Atenciosamente Tchau Tenho Temos Vcs Td Tb Também Tambem Mas Porque Pq Uma Um"
).split(/\s+/);

const GATILHOS = new RegExp(
  `(?<![\\p{L}\\p{M}])(${PALAVRAS_GATILHO.map(semCaixa).join("|")})([,!.:]?\\s+)` +
    `(?!(?:${NAO_SAO_NOME.map(escaparRegex).join("|")})(?![\\p{L}\\p{M}]))` +
    `(\\p{Lu}[\\p{Ll}\\p{M}]+)(\\s+\\p{Lu}[\\p{Ll}\\p{M}]+)?`,
  "gu",
);

/** Os pedaços de um nome de perfil que valem trocar (3 letras ou mais). */
export function pedacosDoNome(nomes: readonly (string | null | undefined)[]): string[] {
  const pedacos = new Set<string>();
  for (const nome of nomes) {
    if (!nome) continue;
    for (const p of nome.split(/[\s.,;:!?()[\]"'/\\_-]+/)) {
      if (p.length >= 3 && /\p{L}/u.test(p)) pedacos.add(p);
    }
  }
  return [...pedacos];
}

/**
 * Tira telefone, e-mail, documento, CEP, placa, link e números longos. É a
 * limpeza mínima, que vale também para o texto que vai ao modelo de IA.
 */
export function tirarIdentificadores(texto: string): string {
  let saida = texto;
  for (const [padrao, troca] of TROCAS_FIXAS) saida = saida.replace(padrao, troca);
  return saida;
}

/** A limpeza inteira do trecho que aparece no relatório. */
export function anonimizarTexto(texto: string, nomesConhecidos: readonly (string | null | undefined)[] = []): string {
  let saida = tirarIdentificadores(texto);
  for (const pedaco of pedacosDoNome(nomesConhecidos)) {
    const alvo = new RegExp(`(?<![\\p{L}\\p{M}])${escaparRegex(pedaco)}(?![\\p{L}\\p{M}])`, "giu");
    saida = saida.replace(alvo, "[nome]");
  }
  // O nome e o sobrenome logo depois do gatilho viram um [nome] só.
  saida = saida.replace(GATILHOS, (_m, gatilho: string, sep: string) => `${gatilho}${sep}[nome]`);
  saida = saida.replace(PALAVRA_COM_MAIUSCULA, (palavra) => (PRENOMES.has(SEM_ACENTO(palavra)) ? "[nome]" : palavra));
  // "[nome] [nome]" vira um só.
  return saida.replace(/\[nome\](\s+\[nome\])+/g, "[nome]");
}

/** Corta no fim de uma palavra, com reticência, sem quebrar um marcador "[...]". */
export function trechoCurto(texto: string, max: number = TAMANHO_DO_BALAO): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (limpo.length <= max) return limpo;
  let corte = limpo.slice(0, max - 1);
  const abre = corte.lastIndexOf("[");
  if (abre > corte.lastIndexOf("]")) corte = corte.slice(0, abre);
  const espaco = corte.lastIndexOf(" ");
  if (espaco > max * 0.6) corte = corte.slice(0, espaco);
  return `${corte.trimEnd()}…`;
}

/** O balão do relatório: limpo e curto, nessa ordem (cortar antes deixaria meio telefone). */
export function balaoAnonimizado(texto: string, nomesConhecidos: readonly (string | null | undefined)[] = []): string {
  return trechoCurto(anonimizarTexto(texto, nomesConhecidos));
}
