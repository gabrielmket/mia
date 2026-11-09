/**
 * FORK MIA (.107) · A ENTREGA DO RAIO-X DO CADASTRO (decisão 2 de 06/11/2026:
 * o relatório vai DIRETO para quem pediu, sem a revisão da Time; a Time é
 * avisada). O ciclo chama isto quando o relatório nasce (`ciclo.ts`):
 *
 *   1. o LINK DO DONO, 30 dias (`created_via` 'cadastro'): é o que vai ao lead
 *      da Time, para o comercial abrir o mesmo relatório que a pessoa vê;
 *   2. o E-MAIL "seu Raio-X está pronto" para a conta, com o resumo e o botão
 *      para a área (o relatório abre lá, com o código no e-mail);
 *   3. o LEAD ganha a nota, sem resposta, conversas e o link (campos e nota);
 *   4. o AVISO À TIME: na Central de avisos da organização da Time (a do lead,
 *      com o botão "Abrir negócio") e, com `RAIO_X_AVISO_EMAIL`, por e-mail.
 *
 * E a leitura que fechou SEM HISTÓRICO num raio-X grátis (0 conversas de
 * cliente): sem relatório, a conexão cai, o raio-X é encerrado e marcado
 * (`sem_historico_em`), e a grátis NÃO conta. O caminho mais simples e correto:
 * a pessoa recebe o e-mail com o link do cadastro e cadastra o mesmo número de
 * novo, como da primeira vez (a regra da grátis ignora o raio-X marcado).
 *
 * Tudo melhor esforço: nada aqui lança para o ciclo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { LeitorDoRaioX } from "@/lib/channels/raio-x/leitor";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

import { criarLinkDoDono, desconectarAgora, lerRelatorio, type LinhaDoRaioX } from "./banco";
import { lerConta } from "./contas";
import { emailDeAvisoATime, emailDePronto, emailSemHistorico, enviarEmailDoRaioX, type EnviarEmail } from "./emails";
import { anotarNoLead, avisarNaCentralDaTime, type DependenciasDoLead, type ResultadoDoLead } from "./lead-da-time";

export const VARIAVEL_DO_AVISO = "RAIO_X_AVISO_EMAIL";

export interface DependenciasDaEntrega {
  lead?: DependenciasDoLead;
  enviarEmail?: EnviarEmail;
  /** Para o teste: o e-mail da Time (sem ele, `RAIO_X_AVISO_EMAIL`). */
  emailDaTime?: string | null;
}

const nota = (n: number | null) => (n === null ? "sem nota" : n.toFixed(1).replace(".", ","));

function emailDaTime(deps: DependenciasDaEntrega): string | null {
  const bruto = deps.emailDaTime !== undefined ? deps.emailDaTime : process.env[VARIAVEL_DO_AVISO];
  const e = typeof bruto === "string" ? bruto.trim() : "";
  return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e) ? e : null;
}

function enderecoNoAdmin(raioXId: string): string {
  return `${(env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "")}/admin/raio-x/${raioXId}`;
}

/** O aviso à Time: na Central da organização dela (quando há lead) e no e-mail de configuração. */
export async function avisarATime(
  admin: SupabaseClient,
  aviso: { titulo: string; linhas: string[]; raioXId: string; lead: ResultadoDoLead | null },
  deps: DependenciasDaEntrega = {},
): Promise<{ central: boolean; email: boolean }> {
  const central = aviso.lead?.ok ? await avisarNaCentralDaTime(admin, aviso.lead, { titulo: aviso.titulo, corpo: aviso.linhas.join(" ") }) : false;
  const para = emailDaTime(deps);
  const email = para
    ? await enviarEmailDoRaioX(para, (marca) => emailDeAvisoATime({ titulo: aviso.titulo, linhas: aviso.linhas, link: enderecoNoAdmin(aviso.raioXId) }, marca), "aviso_a_time", deps.enviarEmail)
    : false;
  return { central, email };
}

export interface ResultadoDaEntrega {
  entregue: boolean;
  emailSaiu: boolean;
  lead: ResultadoDoLead | null;
  linkDoDono: string | null;
  avisou: { central: boolean; email: boolean };
}

/** Manda o relatório do cadastro para quem pediu, ao lead e à Time. Nunca lança. */
export async function entregarRelatorioDoCadastro(
  admin: SupabaseClient,
  r: LinhaDoRaioX,
  relatorioId: string,
  agora: Date = new Date(),
  deps: DependenciasDaEntrega = {},
): Promise<ResultadoDaEntrega> {
  const vazio: ResultadoDaEntrega = { entregue: false, emailSaiu: false, lead: null, linkDoDono: null, avisou: { central: false, email: false } };
  try {
    const [conta, rel] = await Promise.all([r.conta_id ? lerConta(admin, r.conta_id) : Promise.resolve(null), lerRelatorio(admin, relatorioId)]);
    if (!rel) return vazio;
    const link = await criarLinkDoDono(admin, rel, 30, null, "cadastro").catch(() => null);
    const linkDoDono = link && link.ok ? link.link.url : null;
    const d = rel.dados;
    const semResposta = Number(d?.tempo?.semResposta ?? 0);
    const notaMedia = d?.notas?.media ?? null;
    const conversas = Number(rel.conversas ?? d?.numeros?.conversas ?? 0);
    const resumo = `nota ${nota(notaMedia)}, ${semResposta} sem resposta, ${conversas} conversas`;

    const emailSaiu = conta
      ? await enviarEmailDoRaioX(
          conta.email,
          (marca) => emailDePronto({ nome: conta.nome, empresa: r.empresa, conversas, nota: notaMedia, semResposta, parcial: rel.parcial, email: conta.email }, marca),
          "pronto",
          deps.enviarEmail,
        )
      : false;
    const lead = conta
      ? await anotarNoLead(
          admin,
          {
            conta,
            raioX: r,
            raioXId: r.id,
            campos: {
              raio_x_situacao: "relatório pronto",
              raio_x_nota: notaMedia,
              raio_x_sem_resposta: semResposta,
              raio_x_conversas: conversas,
              raio_x_relatorio: linkDoDono,
            },
            nota: `O Raio-X da ${r.empresa} ficou pronto e foi para ${conta.nome}: ${resumo}.${linkDoDono ? ` Relatório: ${linkDoDono}` : ""}`,
          },
          deps.lead,
        )
      : null;
    const avisou = await avisarATime(
      admin,
      {
        titulo: `${r.empresa} recebeu o Raio-X: ${resumo}`,
        linhas: [`O relatório foi direto para quem pediu${conta ? ` (${conta.nome})` : ""}. Bom momento para o comercial ligar.`, ...(linkDoDono ? [`O relatório: ${linkDoDono}`] : [])],
        raioXId: r.id,
        lead,
      },
      deps,
    );
    await admin.from("mia_raio_x").update({ entregue_em: agora.toISOString() }).eq("id", r.id);
    return { entregue: true, emailSaiu, lead, linkDoDono, avisou };
  } catch (erro) {
    logger.warn("[raio-x] a entrega do relatório do cadastro falhou", { raioXId: r.id, detail: erro instanceof Error ? erro.message : "erro" });
    return vazio;
  }
}

/**
 * A grátis que fechou sem histórico: a conexão cai, o raio-X encerra marcado, e
 * a pessoa recebe o e-mail para cadastrar de novo. Nunca lança.
 */
export async function fecharSemHistorico(
  admin: SupabaseClient,
  r: LinhaDoRaioX,
  agora: Date,
  leitor: LeitorDoRaioX | null,
  deps: DependenciasDaEntrega = {},
): Promise<{ emailSaiu: boolean }> {
  try {
    await desconectarAgora(admin, r, agora, leitor);
    await admin
      .from("mia_raio_x")
      .update({ situacao: "encerrado", encerrado_em: agora.toISOString(), sem_historico_em: agora.toISOString(), analise: {}, trava_ate: null })
      .eq("id", r.id);
    const conta = r.conta_id ? await lerConta(admin, r.conta_id) : null;
    if (!conta) return { emailSaiu: false };
    const emailSaiu = await enviarEmailDoRaioX(
      conta.email,
      (marca) => emailSemHistorico({ nome: conta.nome, empresa: r.empresa, whatsapp: r.whatsapp, email: conta.email }, marca),
      "sem_historico",
      deps.enviarEmail,
    );
    await anotarNoLead(
      admin,
      {
        conta,
        raioX: r,
        raioXId: r.id,
        campos: { raio_x_situacao: "sem histórico (a grátis não foi gasta)" },
        nota: `O WhatsApp da ${r.empresa} conectou, mas não mandou o histórico (0 conversas em 40 minutos). A grátis não foi gasta: a pessoa pode cadastrar de novo.`,
      },
      deps.lead,
    );
    return { emailSaiu };
  } catch (erro) {
    logger.warn("[raio-x] fechar o raio-X sem histórico falhou", { raioXId: r.id, detail: erro instanceof Error ? erro.message : "erro" });
    return { emailSaiu: false };
  }
}
