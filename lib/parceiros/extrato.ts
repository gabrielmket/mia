/**
 * FORK MIA (.97) · O EXTRATO DO MÊS AO PARCEIRO (decisões 2 e 9; protótipo, tela 4).
 *
 * Um e-mail por parceiro, no fechamento do mês: os clientes dele pelo nome da
 * empresa, o que pagaram, o imposto, as taxas do Asaas, o líquido, a comissão
 * (mensalidade e setup separados), os estornos e o total, com os prazos do
 * calendário (a nota ou o recibo até o dia 5, o Pix até o dia 10). O parceiro
 * não entra no sistema. A resposta do e-mail vai para o suporte da instalação.
 * Melhor esforço: e-mail que não sai fica anotado no repasse (`extrato_erro`) e
 * a tela tem "Mandar os extratos por e-mail". O log não leva endereço.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { emailDeSuporte, marcaDaSaida, NEUTROS_DE_SAIDA } from "@/lib/branding/saida";
import { reais, diaCivilFormatado } from "@/lib/cupons/regras";
import { sendEmail } from "@/lib/email/roteador";
import { logger } from "@/lib/logger";

import { lerConfiguracaoDaComissao } from "./configuracao";
import { lerParceiro } from "./banco";
import { lerRepassesDoMes, prazosDoRepasse, totaisDosLancamentos, type LancamentoDoRepasse } from "./repasses";
import { nomeDoMes, type ConfiguracaoDaComissao } from "./regras";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
const pct = (n: number) => `${String(Number(n)).replace(".", ",")}%`;

/** O texto do extrato (puro): o corpo em texto e o HTML com a tabela de cada cliente. */
export function montarExtrato(p: {
  parceiro: { nome: string; tipo_documento: "cpf" | "cnpj" | null };
  competencia: string;
  codigos: readonly string[];
  lancamentos: readonly LancamentoDoRepasse[];
  total_cents: number;
  config: Pick<ConfiguracaoDaComissao, "dia_nota" | "dia_pagamento">;
  marca: { nome: string; accent: string };
}): { subject: string; html: string; text: string } {
  const t = totaisDosLancamentos(p.lancamentos);
  const prazos = prazosDoRepasse(p.competencia, p.config);
  const primeiroNome = p.parceiro.nome.split(/\s+/)[0] ?? p.parceiro.nome;
  const mes = nomeDoMes(p.competencia).toLowerCase();
  const cupons = p.codigos.length ? p.codigos.join(", ") : "";
  const clientes = new Set(p.lancamentos.filter((l) => l.tipo === "mensalidade").map((l) => l.organization_id)).size;
  const pctMens = p.lancamentos.find((l) => l.tipo === "mensalidade")?.comissao_pct;
  const pctSetup = p.lancamentos.find((l) => l.tipo === "setup")?.comissao_pct;
  const documento = p.parceiro.tipo_documento === "cnpj" ? "a nota fiscal desse valor" : "o recibo desse valor";
  const paragrafos: string[] = [`Olá, ${primeiroNome}.`];
  if (t.mensalidades > 0) {
    paragrafos.push(
      `Em ${mes}, ${clientes} ${clientes === 1 ? "cliente que veio" : "clientes que vieram"} pelo seu cupom ${cupons} ` +
        `${clientes === 1 ? "pagou" : "pagaram"} ${reais(t.mensalidades_pago_cents)} de mensalidades. Tirando o imposto (${reais(t.mensalidades_imposto_cents)}) ` +
        `e as taxas de pagamento (${reais(t.mensalidades_taxa_cents)}), o líquido foi ${reais(t.mensalidades_liquido_cents)}, ` +
        `e a sua comissão${pctMens !== undefined ? ` de ${pct(pctMens)}` : ""} é ${reais(t.mensalidades_comissao_cents)}.`,
    );
  }
  if (t.setups > 0) {
    paragrafos.push(
      `${t.setups === 1 ? "Entrou 1 setup de implantação, pago" : `Entraram ${t.setups} setups de implantação, pagos`} por ${reais(t.setups_pago_cents)}; ` +
        `tirando o imposto (${reais(t.setups_imposto_cents)}) e as taxas (${reais(t.setups_taxa_cents)}), o líquido foi ${reais(t.setups_liquido_cents)} ` +
        `e a comissão${pctSetup !== undefined ? ` de ${pct(pctSetup)}` : ""} é ${reais(t.setups_comissao_cents)}.`,
    );
  }
  if (t.estornos_cents < 0) {
    paragrafos.push(
      `Houve estorno ou contestação de pagamento que já tinha gerado comissão: ${reais(t.estornos_cents)} saem deste repasse, como combinado.`,
    );
  }
  paragrafos.push(
    `O total de ${reais(p.total_cents)} vai para a sua chave Pix até ${diaCivilFormatado(prazos.pix_ate)}. ` +
      `Para isso, responda este e-mail até ${diaCivilFormatado(prazos.nota_ate)} com ${documento}.`,
  );
  paragrafos.push(
    "A conta é sobre o valor líquido: o que o cliente pagou, já com o desconto do cupom, menos o imposto e menos a taxa do meio de pagamento de cada cobrança.",
  );

  const rotulo: Record<LancamentoDoRepasse["tipo"], string> = { mensalidade: "Mensalidade", setup: "Setup", estorno: "Estorno" };
  const td = 'style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap"';
  const tdEsq = 'style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:left"';
  const linhas = p.lancamentos
    .map(
      (l) =>
        `<tr><td ${tdEsq}>${escapar(l.empresa)}</td><td ${tdEsq}>${rotulo[l.tipo]}</td><td ${td}>${diaCivilFormatado(l.pago_em)}</td>` +
        `<td ${td}>${reais(l.valor_pago_cents)}</td><td ${td}>${reais(l.imposto_cents)}</td><td ${td}>${reais(l.taxa_cents)}</td>` +
        `<td ${td}>${reais(l.liquido_cents)}</td><td ${td}>${pct(l.comissao_pct)}</td><td ${td}><b>${reais(l.comissao_cents)}</b></td></tr>`,
    )
    .join("");
  const th = 'style="padding:6px 8px;border-bottom:2px solid #d1d5db;text-align:left;font-size:12px"';
  const tabela =
    `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:16px 0"><thead><tr>` +
    ["Cliente", "Tipo", "Pago em", "Valor pago", "Imposto", "Taxa", "Líquido", "Comissão (%)", "Comissão"].map((c) => `<th ${th}>${c}</th>`).join("") +
    `</tr></thead><tbody>${linhas}</tbody><tfoot><tr><td ${tdEsq} colspan="8"><b>Total</b></td><td ${td}><b>${reais(p.total_cents)}</b></td></tr></tfoot></table>`;
  const subject = `Extrato de ${mes}: ${reais(p.total_cents)} de comissão`;
  const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:${NEUTROS_DE_SAIDA.fundo};font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:${NEUTROS_DE_SAIDA.texto}">
  <div style="max-width:720px;margin:0 auto;padding:32px 24px">
    <h1 style="font-size:20px;line-height:1.3;margin:0 0 16px">${escapar(subject)}</h1>
    ${paragrafos.map((x) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${escapar(x)}</p>`).join("\n    ")}
    <p style="margin:16px 0 0;font-size:14px;font-weight:600">O detalhe de cada cliente</p>
    ${tabela}
    <p style="margin:24px 0 0;font-size:12px;color:${NEUTROS_DE_SAIDA.suave}">${escapar(`Você recebe este extrato porque é parceiro de ${p.marca.nome}.`)}</p>
  </div>
</body>
</html>`;
  const detalhe = p.lancamentos
    .map((l) => `${l.empresa} · ${rotulo[l.tipo]} · ${diaCivilFormatado(l.pago_em)} · pago ${reais(l.valor_pago_cents)} · líquido ${reais(l.liquido_cents)} · comissão ${reais(l.comissao_cents)}`)
    .join("\n");
  const text = `${paragrafos.join("\n\n")}\n\nO detalhe de cada cliente:\n${detalhe}\n\nTotal: ${reais(p.total_cents)}\n`;
  return { subject, html, text };
}

/**
 * Manda o extrato de cada repasse da competência que ainda não foi (ou de todos,
 * com `reenviar`). Grava `extrato_enviado_em` ou o erro. Devolve quantos saíram.
 */
export async function mandarExtratos(
  admin: SupabaseClient,
  competencia: string,
  o: { reenviar?: boolean; parceiroId?: string; enviar?: typeof sendEmail } = {},
): Promise<{ enviados: number; falhas: number }> {
  const repasses = (await lerRepassesDoMes(admin, competencia)).filter(
    (r) => (o.reenviar || !r.extrato_enviado_em) && (!o.parceiroId || r.parceiro_id === o.parceiroId),
  );
  if (repasses.length === 0) return { enviados: 0, falhas: 0 };
  const [config, marca, suporte] = await Promise.all([lerConfiguracaoDaComissao(admin), marcaDaSaida(null), emailDeSuporte()]);
  let enviados = 0;
  let falhas = 0;
  for (const r of repasses) {
    const parceiro = await lerParceiro(admin, r.parceiro_id);
    if (!parceiro?.email || parceiro.anonimizado_em) {
      await admin.from("mia_repasses").update({ extrato_erro: "sem_email" }).eq("id", r.id);
      falhas += 1;
      continue;
    }
    const { data: cupons } = await admin.from("mia_cupons").select("codigo").eq("parceiro_id", parceiro.id);
    const email = montarExtrato({
      parceiro,
      competencia,
      codigos: ((cupons ?? []) as Array<{ codigo: string }>).map((c) => c.codigo),
      lancamentos: r.lancamentos,
      total_cents: r.total_cents,
      config,
      marca: { nome: marca.nome, accent: marca.accent },
    });
    const enviado = await (o.enviar ?? sendEmail)({
      to: parceiro.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      fromName: marca.nome,
      ...(suporte ? { replyTo: suporte } : {}),
      tags: [{ name: "tipo", value: "extrato_do_parceiro" }],
    });
    if (enviado.ok) {
      await admin.from("mia_repasses").update({ extrato_enviado_em: new Date().toISOString(), extrato_erro: null }).eq("id", r.id);
      enviados += 1;
    } else {
      await admin.from("mia_repasses").update({ extrato_erro: String(enviado.error ?? "nao_saiu").slice(0, 80) }).eq("id", r.id);
      logger.warn("parceiros.extrato_nao_saiu", { repasse_id: r.id, erro: enviado.error ?? "desconhecido" });
      falhas += 1;
    }
  }
  return { enviados, falhas };
}
