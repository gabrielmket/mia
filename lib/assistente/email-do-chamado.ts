/**
 * FORK MIA (.88) — o e-mail da resposta de um chamado, para quem abriu.
 *
 * Mesmo molde de `lib/email/templates/aviso-de-troca-de-email.ts`: a marca entra
 * resolvida (`marcaDaSaida`), estilo inline, zero asset externo, e o idioma é o
 * de quem recebe. O texto do chamado NÃO volta no e-mail: só o número, a
 * situação e a resposta da Time, que é o que a pessoa precisa ler.
 */
import { NEUTROS_DE_SAIDA, type MarcaDeSaida } from "@/lib/branding/saida";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

export function emailDaRespostaDoChamado(opts: {
  marca: MarcaDeSaida;
  numero: number;
  situacao: string;
  resposta: string | null;
  linkDoAssistente: string;
  idioma: Idioma;
}): { subject: string; html: string; text: string } {
  const t = (texto: string) => traduzir(texto, opts.idioma);
  const subject = t("Chamado #{n}: a resposta da Time Company").replace("{n}", String(opts.numero));
  const situacao = t("Situação: {s}").replace("{s}", t(opts.situacao));
  const onde = t("A resposta também está no assistente da MIA, em Chamados.");
  const abrir = t("Abrir o assistente");

  const logo = opts.marca.logoUrl
    ? `<p style="margin:0 0 24px"><img src="${escapeHtml(opts.marca.logoUrl)}" alt="${escapeHtml(opts.marca.nome)}" height="40" style="height:40px;width:auto;max-width:200px;border:0;display:block"></p>`
    : "";
  const resposta = opts.resposta
    ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;white-space:pre-wrap">${escapeHtml(opts.resposta)}</p>`
    : "";

  const html = `<!doctype html>
<html lang="${opts.idioma}">
<body style="margin:0;padding:0;background:${NEUTROS_DE_SAIDA.fundo};font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:${NEUTROS_DE_SAIDA.texto}">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    ${logo}
    <h1 style="font-size:20px;line-height:1.3;margin:0 0 16px;color:${NEUTROS_DE_SAIDA.texto}">${escapeHtml(subject)}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5"><strong>${escapeHtml(situacao)}</strong></p>
    ${resposta}
    <p style="margin:24px 0 0;font-size:15px"><a href="${escapeHtml(opts.linkDoAssistente)}">${escapeHtml(abrir)}</a></p>
    <p style="margin:24px 0 0;font-size:13px;color:${NEUTROS_DE_SAIDA.suave}">${escapeHtml(onde)}</p>
  </div>
</body>
</html>`;

  const text = [subject, "", situacao, "", opts.resposta ?? "", "", `${abrir}: ${opts.linkDoAssistente}`, "", onde].join("\n");
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
