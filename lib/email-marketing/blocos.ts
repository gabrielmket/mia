/**
 * FORK MIA (.89) — O E-MAIL EM BLOCOS: o esquema, a montagem em HTML e texto, e
 * a conferência antes de enviar.
 *
 * Cinco blocos (título, texto, imagem, botão, divisor) cobrem o e-mail de
 * marketing de quem não tem designer (decisão "Editor de HTML livre" do
 * protótipo: fica para depois, de propósito). O HTML sai em tabela com estilo
 * na linha, que é o que o Outlook e o Gmail entendem, e o texto puro sai junto:
 * quem lê com imagem bloqueada, ou num relógio, recebe o mesmo conteúdo.
 *
 * O RODAPÉ não é bloco e não sai: razão social, CNPJ, endereço, por que a pessoa
 * recebe, e os links de descadastro e de preferências entram em todo e-mail.
 */
import { z } from "zod";

import { ASSUNTO_RECOMENDADO, CORTE_DO_GMAIL_KB, PRE_CABECALHO_RECOMENDADO } from "./regras";
import {
  trocarVariaveis,
  variaveisUsadas,
  VARIAVEIS_DO_EMAIL,
  type ValoresDoContato,
} from "./variaveis";

const URL_HTTPS = z
  .string()
  .trim()
  .max(2000)
  .regex(/^https:\/\/[^\s]+\.[^\s]+/, "use um endereço que comece com https://");

export const blocoSchema = z.discriminatedUnion("tipo", [
  z.object({
    id: z.string().min(1).max(40),
    tipo: z.literal("titulo"),
    texto: z.string().max(200),
  }),
  z.object({
    id: z.string().min(1).max(40),
    tipo: z.literal("texto"),
    texto: z.string().max(5000),
  }),
  z.object({
    id: z.string().min(1).max(40),
    tipo: z.literal("imagem"),
    url: z.string().trim().max(2000).default(""),
    alt: z.string().max(200).default(""),
  }),
  z.object({
    id: z.string().min(1).max(40),
    tipo: z.literal("botao"),
    texto: z.string().max(60),
    url: z.string().trim().max(2000),
  }),
  z.object({ id: z.string().min(1).max(40), tipo: z.literal("divisor") }),
]);

export type BlocoDoEmail = z.infer<typeof blocoSchema>;

export const blocosSchema = z.array(blocoSchema).max(40);

export const reservasSchema = z.record(z.string().max(40), z.string().max(80)).default({});

export const ROTULO_DO_BLOCO: Record<BlocoDoEmail["tipo"], string> = {
  titulo: "Título",
  texto: "Texto",
  imagem: "Imagem",
  botao: "Botão",
  divisor: "Divisor",
};

export function botaoValido(url: string | null | undefined): boolean {
  return URL_HTTPS.safeParse(url ?? "").success;
}

export function imagemValida(url: string | null | undefined): boolean {
  return URL_HTTPS.safeParse(url ?? "").success;
}

/** Os links que a campanha mede, na ordem em que aparecem (botões). */
export function linksDosBlocos(
  blocos: readonly BlocoDoEmail[],
): Array<{ ordem: number; url: string; rotulo: string }> {
  return blocos
    .filter((b): b is Extract<BlocoDoEmail, { tipo: "botao" }> => b.tipo === "botao")
    .map((b, i) => ({ ordem: i, url: b.url.trim(), rotulo: b.texto.trim() || `Botão ${i + 1}` }));
}

export function escaparHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export interface RodapeDoEmail {
  razaoSocial: string;
  cnpj: string;
  endereco: string;
  motivo: string;
  /** O link da política de privacidade (o da empresa, ou o padrão na página de preferências). */
  privacidadeUrl: string | null;
}

export function rodapeCompleto(r: Partial<RodapeDoEmail> | null | undefined): boolean {
  return !!(
    r?.razaoSocial?.trim() &&
    r.cnpj?.trim() &&
    r.endereco?.trim() &&
    r.motivo?.trim() &&
    r.privacidadeUrl?.trim()
  );
}

export interface LinksDoEnvio {
  descadastro: string;
  preferencias: string;
  /** A URL do pixel. `null` = sem medição de abertura (interesse legítimo, ou sem o aviso). */
  pixel: string | null;
  /** O link de passagem medido de cada botão, pela ordem. Ausente = o destino direto. */
  clique?: (ordem: number, destino: string) => string;
}

export interface CampanhaParaMontar {
  assunto: string;
  preCabecalho: string;
  blocos: readonly BlocoDoEmail[];
  reservas: Readonly<Record<string, string>>;
}

export interface EmailMontado {
  assunto: string;
  html: string;
  texto: string;
  faltando: string[];
}

/** Monta o e-mail de UMA pessoa. Puro: o relógio e os links entram de fora. */
export function montarEmail(entrada: {
  campanha: CampanhaParaMontar;
  valores: ValoresDoContato;
  nomeDaEmpresa: string;
  cor: { fundo: string; frente: string };
  rodape: RodapeDoEmail;
  links: LinksDoEnvio;
  quando: { agora: Date; fuso: string };
  teste?: boolean;
}): EmailMontado {
  const { campanha, valores, quando } = entrada;
  const faltando = new Set<string>();
  const trocar = (modelo: string, html: boolean) => {
    const r = trocarVariaveis(
      modelo,
      valores,
      campanha.reservas,
      quando,
      html ? escaparHtml : (s) => s,
    );
    r.faltando.forEach((f) => faltando.add(f));
    return r.texto;
  };

  const assuntoBase = trocar(campanha.assunto, false)
    .replace(/[\r\n]+/g, " ")
    .trim();
  const assunto = entrada.teste ? `[TESTE] ${assuntoBase}` : assuntoBase;
  const pre = trocar(campanha.preCabecalho, false).trim();

  const corpoHtml: string[] = [];
  const corpoTexto: string[] = [];
  let ordemDoBotao = 0;
  for (const b of campanha.blocos) {
    if (b.tipo === "titulo") {
      corpoHtml.push(
        `<tr><td style="padding:8px 32px 4px;font:700 24px/1.3 Arial,Helvetica,sans-serif;color:#111827">${trocar(b.texto, true)}</td></tr>`,
      );
      corpoTexto.push(trocar(b.texto, false).toUpperCase());
    } else if (b.tipo === "texto") {
      const paragrafos = trocar(b.texto, true)
        .split(/\n{2,}/)
        .map((p) => p.replace(/\n/g, "<br>"));
      for (const p of paragrafos) {
        corpoHtml.push(
          `<tr><td style="padding:8px 32px;font:16px/1.6 Arial,Helvetica,sans-serif;color:#374151">${p}</td></tr>`,
        );
      }
      corpoTexto.push(trocar(b.texto, false));
    } else if (b.tipo === "imagem") {
      if (imagemValida(b.url)) {
        corpoHtml.push(
          `<tr><td style="padding:8px 32px"><img src="${escaparHtml(b.url)}" alt="${escaparHtml(trocar(b.alt, false))}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:8px"></td></tr>`,
        );
      }
      if (b.alt.trim()) corpoTexto.push(`[${trocar(b.alt, false)}]`);
    } else if (b.tipo === "botao") {
      const destino = b.url.trim();
      const href = entrada.links.clique ? entrada.links.clique(ordemDoBotao, destino) : destino;
      ordemDoBotao += 1;
      const rotulo = trocar(b.texto || "Saiba mais", true);
      corpoHtml.push(
        `<tr><td style="padding:12px 32px"><a href="${escaparHtml(href)}" style="display:inline-block;padding:14px 24px;border-radius:8px;background:${entrada.cor.fundo};color:${entrada.cor.frente};font:700 16px/1 Arial,Helvetica,sans-serif;text-decoration:none">${rotulo}</a></td></tr>`,
      );
      corpoTexto.push(`${trocar(b.texto || "Saiba mais", false)}: ${href}`);
    } else {
      corpoHtml.push(
        `<tr><td style="padding:12px 32px"><hr style="border:0;border-top:1px solid #e5e7eb;margin:0"></td></tr>`,
      );
      corpoTexto.push("――――――――――");
    }
  }

  const r = entrada.rodape;
  const privacidade = r.privacidadeUrl
    ? ` · <a href="${escaparHtml(r.privacidadeUrl)}" style="color:#6b7280">Política de privacidade</a>`
    : "";
  const rodapeHtml =
    `<tr><td style="padding:24px 32px 32px;font:12px/1.6 Arial,Helvetica,sans-serif;color:#6b7280;border-top:1px solid #e5e7eb">` +
    `<strong>${escaparHtml(r.razaoSocial)}</strong> · CNPJ ${escaparHtml(r.cnpj)}<br>${escaparHtml(r.endereco)}<br><br>` +
    `${escaparHtml(r.motivo)}<br><br>` +
    `<a href="${escaparHtml(entrada.links.descadastro)}" style="color:#6b7280">Descadastrar</a> · ` +
    `<a href="${escaparHtml(entrada.links.preferencias)}" style="color:#6b7280">Preferências de e-mail</a>${privacidade}` +
    `</td></tr>`;
  const pixel = entrada.links.pixel
    ? `<img src="${escaparHtml(entrada.links.pixel)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">`
    : "";

  const html =
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escaparHtml(assunto)}</title></head><body style="margin:0;padding:0;background:#f3f4f6">` +
    // O pré-cabeçalho: o texto que a caixa de entrada mostra depois do assunto.
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escaparHtml(pre)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 8px">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px">` +
    `<tr><td style="padding:24px 32px 8px;font:700 16px/1.2 Arial,Helvetica,sans-serif;color:#111827">${escaparHtml(entrada.nomeDaEmpresa)}</td></tr>` +
    corpoHtml.join("") +
    rodapeHtml +
    `</table></td></tr></table>${pixel}</body></html>`;

  const texto = [
    entrada.nomeDaEmpresa,
    "",
    ...corpoTexto.flatMap((t) => [t, ""]),
    "--",
    `${r.razaoSocial} · CNPJ ${r.cnpj}`,
    r.endereco,
    "",
    r.motivo,
    "",
    `Descadastrar: ${entrada.links.descadastro}`,
    `Preferências de e-mail: ${entrada.links.preferencias}`,
    ...(r.privacidadeUrl ? [`Política de privacidade: ${r.privacidadeUrl}`] : []),
  ].join("\n");

  return { assunto, html, texto, faltando: [...faltando] };
}

/** As variáveis da campanha que dependem de cadastro e não têm texto reserva. */
export function variaveisSemReserva(campanha: CampanhaParaMontar): string[] {
  const textos = [
    campanha.assunto,
    campanha.preCabecalho,
    ...campanha.blocos.flatMap((b) =>
      b.tipo === "titulo" || b.tipo === "texto"
        ? [b.texto]
        : b.tipo === "botao"
          ? [b.texto]
          : b.tipo === "imagem"
            ? [b.alt]
            : [],
    ),
  ].join("\n");
  const precisam = new Set<string>(
    VARIAVEIS_DO_EMAIL.filter((v) => v.precisaDeDado).map((v) => v.chave),
  );
  return variaveisUsadas(textos).filter(
    (k) => (precisam.has(k) || k.startsWith("contato.")) && !(campanha.reservas[k] ?? "").trim(),
  );
}

export type NivelDaConferencia = "ok" | "aviso" | "trava";

/**
 * As frases da conferência, numa tabela plana: a tela traduz pela chave
 * (`t(FRASES_DA_CONFERENCIA[item.titulo])`) e troca `{n}` e `{lista}` depois.
 */
export const FRASES_DA_CONFERENCIA = {
  assuntoFalta: "Falta o assunto",
  assuntoFaltaDetalhe: "Sem assunto, o envio fica travado.",
  assuntoLongo: "Assunto com {n} caracteres",
  assuntoLongoDetalhe: "No celular aparecem uns 40. Vale encurtar.",
  assuntoBom: "Assunto com {n} caracteres",
  preLongo: "Pré-cabeçalho longo",
  preLongoDetalhe: "Passa de {n} caracteres e a caixa corta.",
  preBom: "Pré-cabeçalho preenchido",
  preFalta: "Sem pré-cabeçalho",
  preFaltaDetalhe: "A caixa de entrada mostra o começo do texto no lugar.",
  descadastro: "Descadastro de um clique",
  descadastroDetalhe:
    "No cabeçalho do e-mail (botão do Gmail e da Apple) e no rodapé. Colocado pelo sistema, não sai.",
  rodapeBom: "Rodapé com a identificação da empresa",
  rodapeFalta: "Rodapé incompleto",
  rodapeFaltaDetalhe: "Falta razão social, CNPJ, endereço, motivo ou privacidade na configuração.",
  botoesRuins: "Botões sem endereço válido: {n}",
  botoesRuinsDetalhe: "Use um endereço que comece com https://.",
  botoesBons: "Botões com endereço válido: {n}",
  botoesBonsDetalhe: "Os cliques são medidos por um link de passagem.",
  imagemFalta: "Blocos de imagem sem imagem: {n}",
  imagemFaltaDetalhe: "Escolha a imagem ou tire o bloco.",
  altFalta: "Imagens sem texto alternativo: {n}",
  altFaltaDetalhe: "Muita gente lê com imagem bloqueada.",
  altBom: "Imagens com texto alternativo",
  semDado: "Contatos que ficam de fora por falta de dado: {n}",
  semDadoDetalhe: "Sem texto reserva para {lista}. Preencha a reserva ou aceite a perda.",
  reservasBoas: "Variáveis com texto reserva",
  tamanhoAlto: "Cerca de {n} KB",
  tamanhoAltoDetalhe: "O Gmail corta e-mails acima de {lista} KB.",
  tamanhoBom: "Cerca de {n} KB",
  tamanhoBomDetalhe: "Abaixo do corte de {lista} KB do Gmail.",
  testeBom: "Teste enviado depois da última mudança",
  testeVelho: "O conteúdo mudou depois do último teste",
  testeFalta: "Nenhum teste enviado",
  testeFaltaDetalhe: "O envio só libera com um teste da versão atual.",
} as const;

export type FraseDaConferencia = keyof typeof FRASES_DA_CONFERENCIA;

export interface ItemDaConferencia {
  nivel: NivelDaConferencia;
  titulo: FraseDaConferencia;
  detalhe: FraseDaConferencia | null;
  /** O que entra no lugar de `{n}` e `{lista}`. */
  valores: { n?: number; lista?: string };
}

/** A frase pronta em português (para o MCP e o log; a tela traduz pela chave). */
export function fraseDaConferencia(
  chave: FraseDaConferencia | null,
  valores: ItemDaConferencia["valores"],
): string {
  if (!chave) return "";
  return FRASES_DA_CONFERENCIA[chave]
    .replace("{n}", String(valores.n ?? ""))
    .replace("{lista}", valores.lista ?? "");
}

/** O tamanho aproximado do HTML, em KB, para o aviso do corte do Gmail. */
export function tamanhoEmKb(html: string): number {
  // TextEncoder, e não Buffer: a prévia da tela usa este arquivo no navegador.
  return Math.round(new TextEncoder().encode(html).length / 1024);
}

/**
 * A conferência ANTES de enviar (tela "Mensagem", bloco "Antes de enviar"). As
 * travas param o envio; os avisos deixam escolher.
 */
export function conferirConteudo(entrada: {
  campanha: CampanhaParaMontar;
  rodapeCompleto: boolean;
  testeDaVersaoAtual: boolean;
  algumTeste: boolean;
  semDado: number;
  tamanhoKb: number;
}): ItemDaConferencia[] {
  const c = entrada.campanha;
  const itens: ItemDaConferencia[] = [];
  const item = (
    nivel: NivelDaConferencia,
    titulo: FraseDaConferencia,
    detalhe: FraseDaConferencia | null = null,
    valores: ItemDaConferencia["valores"] = {},
  ) => itens.push({ nivel, titulo, detalhe, valores });
  const n = c.assunto.trim().length;
  if (n === 0) item("trava", "assuntoFalta", "assuntoFaltaDetalhe");
  else if (n > ASSUNTO_RECOMENDADO) item("aviso", "assuntoLongo", "assuntoLongoDetalhe", { n });
  else item("ok", "assuntoBom", null, { n });
  const pre = c.preCabecalho.trim().length;
  if (pre === 0) item("aviso", "preFalta", "preFaltaDetalhe");
  else if (pre > PRE_CABECALHO_RECOMENDADO)
    item("aviso", "preLongo", "preLongoDetalhe", { n: PRE_CABECALHO_RECOMENDADO });
  else item("ok", "preBom");
  item("ok", "descadastro", "descadastroDetalhe");
  if (entrada.rodapeCompleto) item("ok", "rodapeBom");
  else item("trava", "rodapeFalta", "rodapeFaltaDetalhe");
  const botoes = c.blocos.filter((b) => b.tipo === "botao");
  const ruins = botoes.filter((b) => !botaoValido(b.tipo === "botao" ? b.url : ""));
  if (ruins.length) item("trava", "botoesRuins", "botoesRuinsDetalhe", { n: ruins.length });
  else item("ok", "botoesBons", "botoesBonsDetalhe", { n: botoes.length });
  const imagens = c.blocos.filter((b) => b.tipo === "imagem");
  if (imagens.length) {
    const semImagem = imagens.filter((b) => b.tipo === "imagem" && !imagemValida(b.url));
    const semAlt = imagens.filter((b) => b.tipo === "imagem" && !b.alt.trim());
    if (semImagem.length)
      item("trava", "imagemFalta", "imagemFaltaDetalhe", { n: semImagem.length });
    if (semAlt.length) item("aviso", "altFalta", "altFaltaDetalhe", { n: semAlt.length });
    else item("ok", "altBom");
  }
  const semReserva = variaveisSemReserva(c);
  if (entrada.semDado > 0) {
    item("aviso", "semDado", "semDadoDetalhe", {
      n: entrada.semDado,
      lista: semReserva.map((k) => `{{${k}}}`).join(", "),
    });
  } else item("ok", "reservasBoas");
  if (entrada.tamanhoKb > CORTE_DO_GMAIL_KB - 2)
    item("aviso", "tamanhoAlto", "tamanhoAltoDetalhe", {
      n: entrada.tamanhoKb,
      lista: String(CORTE_DO_GMAIL_KB),
    });
  else
    item("ok", "tamanhoBom", "tamanhoBomDetalhe", {
      n: entrada.tamanhoKb,
      lista: String(CORTE_DO_GMAIL_KB),
    });
  if (entrada.testeDaVersaoAtual) item("ok", "testeBom");
  else item("trava", entrada.algumTeste ? "testeVelho" : "testeFalta", "testeFaltaDetalhe");
  return itens;
}
