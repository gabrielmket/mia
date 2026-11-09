/**
 * FORK MIA (.107) · OS E-MAILS DO RAIO-X POR CADASTRO, todos pelo roteador de
 * e-mail da instalação (`lib/email/roteador.ts`: SMTP ou Resend, o que estiver
 * configurado; o remetente é o da instalação, hoje naoresponda@iamia.com.br).
 *
 *   começou        o cadastro entrou: o link de conexão e como entrar na área
 *   código         o código de 6 números para entrar na área
 *   pronto         o relatório saiu (direto, sem a revisão da Time)
 *   sem histórico  a leitura fechou com 0 conversas: a grátis não foi gasta
 *   pagamento      a nova análise foi paga: conecte de novo (ou já está lendo)
 *   aviso à Time   o resumo para o comercial (`RAIO_X_AVISO_EMAIL`, quando há)
 *
 * Melhor esforço: nenhum envio lança, e o que falhou vira `false` e um aviso
 * no log, sem o endereço. O texto é o que a pessoa de fora lê: português do
 * Brasil, sem travessão e sem dizer "IA" (é "análise automática").
 */
import { marcaDaSaida, NEUTROS_DE_SAIDA, type MarcaDeSaida } from "@/lib/branding/saida";
import { sendEmail } from "@/lib/email/roteador";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

import { whatsappParaLer } from "./regras";

export const REMETENTE_DO_RAIO_X = "MIA · Raio-X";

export interface EmailMontado {
  subject: string;
  html: string;
  text: string;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** O molde dos e-mails do raio-X (o mesmo do e-mail da cobrança, sem travessão). */
export function montarEmail(o: {
  titulo: string;
  paragrafos: string[];
  botao: { rotulo: string; href: string } | null;
  rodape: string;
  marca: Pick<MarcaDeSaida, "nome" | "logoUrl" | "accent" | "accentFg">;
}): EmailMontado {
  const logo = o.marca.logoUrl
    ? `<p style="margin:0 0 24px"><img src="${escapar(o.marca.logoUrl)}" alt="${escapar(o.marca.nome)}" height="40" style="height:40px;width:auto;max-width:200px;border:0;display:block"></p>`
    : "";
  const botao = o.botao
    ? `<p style="margin:24px 0"><a href="${escapar(o.botao.href)}" style="display:inline-block;padding:12px 24px;background:${o.marca.accent};color:${o.marca.accentFg};border-radius:6px;text-decoration:none;font-weight:600">${escapar(o.botao.rotulo)}</a></p>`
    : "";
  const corpo = o.paragrafos.map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escapar(p)}</p>`).join("\n    ");
  const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:${NEUTROS_DE_SAIDA.fundo};font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:${NEUTROS_DE_SAIDA.texto}">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    ${logo}
    <h1 style="font-size:20px;line-height:1.3;margin:0 0 16px;color:${NEUTROS_DE_SAIDA.texto}">${escapar(o.titulo)}</h1>
    ${corpo}
    ${botao}
    <p style="margin:24px 0 0;font-size:12px;color:${NEUTROS_DE_SAIDA.suave}">${escapar(o.rodape)} · ${escapar(o.marca.nome)}</p>
  </div>
</body>
</html>`;
  const text = [o.titulo, "", ...o.paragrafos.flatMap((p) => [p, ""]), ...(o.botao ? [`${o.botao.rotulo}: ${o.botao.href}`, ""] : []), o.rodape].join("\n");
  return { subject: `${o.titulo} · ${o.marca.nome}`, html, text };
}

function base(): string {
  return (env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
}

/** Os endereços da área que os e-mails citam. */
export function enderecoDaArea(): string {
  return `${base()}/raio-x/minha-area`;
}
export function enderecoDeEntrar(email?: string): string {
  return `${base()}/raio-x/entrar${email ? `?email=${encodeURIComponent(email)}` : ""}`;
}
export function enderecoDoCadastro(email?: string): string {
  return `${base()}/raio-x/gratis${email ? `?email=${encodeURIComponent(email)}` : ""}`;
}

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;
const RODAPE = "Você recebe este e-mail porque pediu o Raio-X do atendimento.";

type Marca = Pick<MarcaDeSaida, "nome" | "logoUrl" | "accent" | "accentFg">;

export function emailDeComecou(p: { nome: string; empresa: string; whatsapp: string; linkDeConexao: string; email: string }, marca: Marca): EmailMontado {
  return montarEmail({
    marca,
    titulo: "Seu Raio-X do atendimento começou",
    paragrafos: [
      `Oi, ${primeiroNome(p.nome)}. Recebemos o pedido do Raio-X do atendimento da ${p.empresa}.`,
      `Falta conectar o WhatsApp ${whatsappParaLer(p.whatsapp)}: abra o link e siga os passos (leva 1 minuto). É só leitura: nenhuma mensagem sai do seu número. O link vale por 48 horas.`,
      `Quando o relatório ficar pronto, ele chega neste e-mail. Para entrar na sua área, use o endereço ${enderecoDeEntrar()} com este e-mail: mandamos um código de 6 números, sem senha.`,
    ],
    botao: { rotulo: "Conectar o WhatsApp", href: p.linkDeConexao },
    rodape: RODAPE,
  });
}

export function emailDoCodigo(p: { codigo: string }, marca: Marca): EmailMontado {
  return montarEmail({
    marca,
    titulo: `Seu código de acesso: ${p.codigo}`,
    paragrafos: [
      `Use o código ${p.codigo} para entrar na área do Raio-X. Ele vale por 15 minutos.`,
      "Se não foi você que pediu, ignore este e-mail: sem o código, ninguém entra.",
    ],
    botao: { rotulo: "Entrar na área", href: enderecoDeEntrar() },
    rodape: RODAPE,
  });
}

export function emailDePronto(
  p: { nome: string; empresa: string; conversas: number; nota: number | null; semResposta: number; parcial: boolean; email: string },
  marca: Marca,
): EmailMontado {
  const nota = p.nota === null ? null : p.nota.toFixed(1).replace(".", ",");
  const lidas = `Lemos ${p.conversas} ${p.conversas === 1 ? "conversa" : "conversas"} do WhatsApp da ${p.empresa}.`;
  const semResposta = `${p.semResposta} ${p.semResposta === 1 ? "cliente ficou" : "clientes ficaram"} sem nenhuma resposta`;
  return montarEmail({
    marca,
    titulo: `Seu Raio-X do atendimento está pronto, ${primeiroNome(p.nome)}`,
    paragrafos: [
      nota ? `${lidas} A nota do atendimento ficou em ${nota} de 10, e ${semResposta}.` : `${lidas} ${semResposta.charAt(0).toUpperCase()}${semResposta.slice(1)}.`,
      ...(p.parcial ? ["A conta tinha muitas conversas: a análise automática leu as mais recentes, e o relatório diz quantas ficaram de fora."] : []),
      "Para ver o relatório, entre na sua área com este e-mail e o código que mandamos na hora. Sem senha.",
    ],
    botao: { rotulo: "Ver meu Raio-X", href: enderecoDeEntrar(p.email) },
    rodape: RODAPE,
  });
}

export function emailSemHistorico(p: { nome: string; empresa: string; whatsapp: string; email: string }, marca: Marca): EmailMontado {
  return montarEmail({
    marca,
    titulo: "O WhatsApp não mandou o histórico",
    paragrafos: [
      `Oi, ${primeiroNome(p.nome)}. Conectamos o WhatsApp ${whatsappParaLer(p.whatsapp)} da ${p.empresa}, mas nenhuma conversa chegou em 40 minutos, e sem conversa não há o que analisar.`,
      "Isso não conta como a sua análise grátis. A conexão foi desfeita. Para tentar de novo, faça o cadastro outra vez e conecte o número pelo celular dele, com a internet ligada até o histórico chegar.",
    ],
    botao: { rotulo: "Tentar de novo", href: enderecoDoCadastro(p.email) },
    rodape: RODAPE,
  });
}

export function emailDePagamento(
  p: { nome: string; empresa: string; tipo: "avulsa" | "mensal"; linkDeConexao: string | null; email: string },
  marca: Marca,
): EmailMontado {
  return montarEmail({
    marca,
    titulo: "Pagamento confirmado: a nova análise vai começar",
    paragrafos: [
      `Oi, ${primeiroNome(p.nome)}. Recebemos o pagamento da ${p.tipo === "mensal" ? "análise mensal" : "nova análise"} da ${p.empresa}.`,
      p.linkDeConexao
        ? "Conecte o WhatsApp de novo pelo link (mesma página, mesmo jeito de antes). A leitura começa assim que conectar."
        : "O WhatsApp ainda está conectado: a leitura já começou, e o relatório chega neste e-mail.",
    ],
    botao: p.linkDeConexao ? { rotulo: "Conectar o WhatsApp", href: p.linkDeConexao } : { rotulo: "Ver minha área", href: enderecoDeEntrar(p.email) },
    rodape: RODAPE,
  });
}

/** O aviso à Time, em texto curto (vai também na Central e no lead). */
export function emailDeAvisoATime(p: { titulo: string; linhas: string[]; link: string | null }, marca: Marca): EmailMontado {
  return montarEmail({
    marca,
    titulo: p.titulo,
    paragrafos: p.linhas,
    botao: p.link ? { rotulo: "Abrir no Admin", href: p.link } : null,
    rodape: "Aviso do Raio-X por cadastro.",
  });
}

export type EnviarEmail = (args: { to: string; subject: string; html: string; text: string; fromName: string; tags: { name: string; value: string }[] }) => Promise<{ ok: boolean }>;

const enviarPeloRoteador: EnviarEmail = (args) => sendEmail(args);

/** Manda um e-mail do raio-X. Nunca lança; devolve se saiu. */
export async function enviarEmailDoRaioX(
  para: string,
  montar: (marca: Marca) => EmailMontado,
  tipo: string,
  enviar: EnviarEmail = enviarPeloRoteador,
): Promise<boolean> {
  try {
    const marca = await marcaDaSaida(null).catch(() => ({ nome: "MIA", logoUrl: null, accent: "#0a7a57", accentFg: "#ffffff" }));
    const msg = montar(marca);
    const r = await enviar({ to: para, subject: msg.subject, html: msg.html, text: msg.text, fromName: REMETENTE_DO_RAIO_X, tags: [{ name: "tipo", value: `raio_x_${tipo}` }] });
    if (!r.ok) logger.warn("[raio-x] o e-mail não saiu", { tipo });
    return r.ok;
  } catch (erro) {
    logger.warn("[raio-x] o e-mail falhou", { tipo, detail: erro instanceof Error ? erro.message : "erro" });
    return false;
  }
}
