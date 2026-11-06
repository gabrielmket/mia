/**
 * FORK MIA (.106) · O CADASTRO DO RAIO-X GRÁTIS: as regras, PURAS.
 *
 * Quem quer o raio-X do próprio atendimento preenche o formulário do SITE
 * (iamia.com.br, outro repositório) ou a página do sistema (`/raio-x/gratis`).
 * Os dois mandam o MESMO corpo para `POST /api/v1/publico/raio-x/cadastro`
 * (o contrato inteiro está em docs/fork/raio-x-do-atendimento.md, seção 16).
 *
 * Este módulo não importa nada de servidor: a página do sistema usa as mesmas
 * listas e a mesma validação que a rota.
 *
 *   nome          nome completo (a régua do aceite, `aceite.ts`)
 *   email         o e-mail da pessoa: o relatório e o código de acesso chegam nele
 *   telefone      o WhatsApp DA PESSOA (para a equipe falar com ela)
 *   whatsapp      o WhatsApp que vai ser ANALISADO (o comercial; pode ser o mesmo)
 *   empresa       o nome da empresa, como vai no relatório
 *   segmento      um de `SEGMENTOS` (`regras.ts`)
 *   quem_atende   um de `QUEM_ATENDE` (padrão humano)
 *   abre, fecha   o horário de segunda a sexta, HH:MM (padrão 08:00 e 18:00)
 *   sabado_ate    opcional: até que horas abre no sábado (vazio = não abre)
 *   aceite        'sim' (ou true): li e autorizo o termo v1
 *   site          a ARMADILHA: precisa vir vazio (robô preenche tudo)
 *   utm_*, gclid, fbclid, origem   de onde a pessoa veio (vão ao lead da Time)
 *   retorno_erro  a página para onde o erro volta (só iamia.com.br, ou a do sistema)
 */
import { ehEmailValido, ehNomeCompleto, limparEmail, limparNome } from "./aceite";
import { minutosDoHorario, normalizarWhatsapp, QUEM_ATENDE, SEGMENTOS, type QuemAtende, type Segmento } from "./regras";

/** O raio-X grátis: os últimos 30 dias, diagnóstico único, teto de R$ 10. */
export const PERIODO_DO_GRATIS = 30;
export const TETO_DO_GRATIS_CENTAVOS = 1000;

/** Os domínios do site que podem mandar o cadastro por JSON (CORS) e receber o erro de volta. */
export const ORIGENS_DO_SITE = ["https://iamia.com.br", "https://www.iamia.com.br"] as const;

/** A página do próprio sistema (o mesmo formulário), aceita como `retorno_erro`. */
export const PAGINA_DO_CADASTRO = "/raio-x/gratis";

export const CAMPOS_DE_ORIGEM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid", "origem"] as const;
export type CampoDeOrigem = (typeof CAMPOS_DE_ORIGEM)[number];

/** Os campos que a recusa pode citar, na ordem do formulário. */
export const CAMPOS_DO_CADASTRO = [
  "nome",
  "email",
  "telefone",
  "whatsapp",
  "empresa",
  "segmento",
  "quem_atende",
  "abre",
  "fecha",
  "sabado_ate",
  "aceite",
  "site",
] as const;
export type CampoDoCadastro = (typeof CAMPOS_DO_CADASTRO)[number];

export interface CadastroValido {
  nome: string;
  email: string;
  /** O WhatsApp da pessoa, em dígitos E.164. */
  telefone: string;
  /** O WhatsApp analisado, em dígitos E.164. */
  whatsapp: string;
  empresa: string;
  segmento: Segmento;
  quem_atende: QuemAtende;
  abre: string;
  fecha: string;
  sabado_ate: string | null;
  /** De onde a pessoa veio: só o que chegou preenchido. */
  origem: Partial<Record<CampoDeOrigem, string>>;
  /** Para onde o erro volta (já conferido), ou `null`. */
  retornoErro: string | null;
}

export type ResultadoDoCadastro =
  | { ok: true; valor: CadastroValido }
  | { ok: false; campos: CampoDoCadastro[]; armadilha: boolean; retornoErro: string | null };

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

function texto(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** O `aceite` do formulário: 'sim', 'true', 'on' (caixa sem `value`) ou o booleano. */
export function aceitou(v: unknown): boolean {
  if (v === true) return true;
  return ["sim", "true", "on", "1"].includes(texto(v).toLowerCase());
}

/**
 * Para onde o erro volta. Só o site (https://iamia.com.br ou www, qualquer
 * caminho) ou a página do sistema (`/raio-x/gratis`, relativa). Qualquer outra
 * coisa vira `null`: o erro cai na página simples do sistema, e ninguém usa o
 * cadastro para mandar a pessoa a um endereço de fora.
 */
export function retornoDeErroPermitido(bruto: unknown): string | null {
  const v = texto(bruto);
  if (!v || v.length > 500) return null;
  if (v === PAGINA_DO_CADASTRO || v.startsWith(`${PAGINA_DO_CADASTRO}?`)) return v;
  if (!URL.canParse(v)) return null;
  const u = new URL(v);
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  return (ORIGENS_DO_SITE as readonly string[]).includes(u.origin) ? u.toString() : null;
}

/** O endereço do erro, com `?erro=<campos>` (a lista separada por vírgula). */
export function enderecoDoErro(retorno: string, campos: readonly string[]): string {
  const relativo = retorno.startsWith("/");
  const u = new URL(retorno, "https://sistema.invalid");
  u.searchParams.set("erro", campos.join(","));
  return relativo ? `${u.pathname}${u.search}${u.hash}` : u.toString();
}

/** O campo da origem (utm, clique) como fica: até 200 caracteres (500 nos cliques), sem quebra de linha. */
function campoDeOrigem(nome: CampoDeOrigem, v: unknown): string | null {
  const s = texto(v).replace(/[\r\n\t]+/g, " ");
  if (!s) return null;
  return s.slice(0, nome === "gclid" || nome === "fbclid" ? 500 : 200);
}

/**
 * Valida e normaliza o corpo do cadastro (form ou JSON). A recusa diz os
 * CAMPOS, nunca o valor. Campo que o formulário mandar a mais é ignorado.
 */
export function validarCadastro(bruto: unknown): ResultadoDoCadastro {
  const c = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const retornoErro = retornoDeErroPermitido(c.retorno_erro);
  // A armadilha: gente não vê o campo, robô preenche.
  if (texto(c.site) !== "") return { ok: false, campos: ["site"], armadilha: true, retornoErro };

  const campos: CampoDoCadastro[] = [];
  if (!ehNomeCompleto(c.nome)) campos.push("nome");
  if (!ehEmailValido(c.email)) campos.push("email");
  const telefone = normalizarWhatsapp(texto(c.telefone));
  if (!telefone) campos.push("telefone");
  const whatsapp = normalizarWhatsapp(texto(c.whatsapp));
  if (!whatsapp) campos.push("whatsapp");
  const empresa = texto(c.empresa).replace(/\s+/g, " ");
  if (empresa.length < 1 || empresa.length > 120) campos.push("empresa");
  const segmento = texto(c.segmento);
  if (!(SEGMENTOS as readonly string[]).includes(segmento)) campos.push("segmento");
  const quem = texto(c.quem_atende) || "humano";
  if (!(QUEM_ATENDE as readonly string[]).includes(quem)) campos.push("quem_atende");
  const abre = texto(c.abre) || "08:00";
  const fecha = texto(c.fecha) || "18:00";
  const sabado = texto(c.sabado_ate);
  if (!HORA.test(abre)) campos.push("abre");
  if (!HORA.test(fecha)) campos.push("fecha");
  else if (HORA.test(abre) && minutosDoHorario(fecha)! <= minutosDoHorario(abre)!) campos.push("fecha");
  if (sabado) {
    if (!HORA.test(sabado)) campos.push("sabado_ate");
    else if (HORA.test(abre) && minutosDoHorario(sabado)! <= minutosDoHorario(abre)!) campos.push("sabado_ate");
  }
  if (!aceitou(c.aceite)) campos.push("aceite");
  if (campos.length > 0) return { ok: false, campos, armadilha: false, retornoErro };

  const origem: Partial<Record<CampoDeOrigem, string>> = {};
  for (const nome of CAMPOS_DE_ORIGEM) {
    const v = campoDeOrigem(nome, c[nome]);
    if (v) origem[nome] = v;
  }
  return {
    ok: true,
    valor: {
      nome: limparNome(c.nome),
      email: limparEmail(c.email),
      telefone: telefone!,
      whatsapp: whatsapp!,
      empresa,
      segmento: segmento as Segmento,
      quem_atende: quem as QuemAtende,
      abre,
      fecha,
      sabado_ate: sabado || null,
      origem,
      retornoErro,
    },
  };
}

/** A frase de cada campo recusado, na língua da pessoa (a tela passa por `t()`). */
export const FRASE_DO_CAMPO: Record<CampoDoCadastro, string> = {
  nome: "Escreva o nome e o sobrenome.",
  email: "Confira o e-mail.",
  telefone: "Confira o seu WhatsApp, com o DDD.",
  whatsapp: "Confira o WhatsApp que vai ser analisado, com o DDD.",
  empresa: "Escreva o nome da empresa.",
  segmento: "Escolha o segmento.",
  quem_atende: "Escolha quem atende hoje.",
  abre: "Confira o horário de abertura (HH:MM).",
  fecha: "O horário de fechar precisa ser depois do de abrir.",
  sabado_ate: "O horário do sábado precisa ser depois do de abrir.",
  aceite: "Marque a autorização para continuar.",
  site: "Não deu para receber o cadastro. Tente de novo.",
};

/** Os campos de um `?erro=` (os que a página conhece, sem repetir). */
export function camposDoErro(bruto: unknown): CampoDoCadastro[] {
  const lista = texto(bruto).split(",").map((s) => s.trim());
  return [...new Set(lista.filter((s): s is CampoDoCadastro => (CAMPOS_DO_CADASTRO as readonly string[]).includes(s)))];
}
