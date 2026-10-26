/**
 * FORK MIA (.91) · A ÁREA "PRIMEIROS PASSOS" DO CHECKLIST DA IMPLANTAÇÃO.
 *
 * O passo a passo de entrada do upstream (`/onboarding`, seis passos) visto de
 * fora: em que passo a empresa está, o que ela fez e o que pulou, o segmento
 * que ela confirmou (o modelo do agente, do funil e do follow-up) e o número
 * oficial que espera a Time ligar.
 *
 * ── Por que a Time precisa disto ──────────────────────────────────────────
 *
 * Quem entra sozinho (cadastro próprio) monta a empresa pelo passo a passo, e
 * a implantação pelo MCP precisa saber onde a pessoa parou antes de mexer. E o
 * número oficial pelo Facebook não se liga sozinho: o aviso da Meta não diz de
 * qual empresa é o número, e ligar errado faz a conversa de um cliente sair pelo
 * número de outro (`app/api/v1/admin/cadastro-incorporado`). Quando o cliente
 * entrou com o Facebook e o número ainda não está na empresa, isto aparece em
 * `so_pela_tela`, com quem faz: a plataforma.
 *
 * Os passos saem de `resumoDoOnboarding` (`lib/onboarding/passos.ts`), a MESMA
 * definição que desenha o indicador e o resumo final do upstream: nenhum passo
 * fantasma, nenhuma ordem diferente.
 */
import { env } from "@/lib/env";
import { STATUS_SAUDAVEL } from "@/lib/channels/health";
import { modeloDoSegmento, segmentoDoEstado } from "@/lib/onboarding/modelos-de-agente-da-mia";
import { resumoDoOnboarding } from "@/lib/onboarding/passos";
import type { OnboardingState } from "@/lib/schemas/onboarding";

import type { AreaDoChecklist, ResultadoDaArea } from "./tipos";

/** O estado "esperando a Time" do número oficial (gravado ao entrar com o Facebook). */
export const NUMERO_OFICIAL_ESPERANDO_A_TIME = "esperando_a_time";

/** O que o passo do telefone gravou quando a pessoa entrou com o Facebook. */
export function numeroOficialEsperando(estado: OnboardingState | null | undefined): { desde: string | null } | null {
  const whatsapp = estado?.whatsapp as { status?: string; entrou_com_facebook_em?: string } | undefined;
  if (whatsapp?.status !== NUMERO_OFICIAL_ESPERANDO_A_TIME) return null;
  return { desde: typeof whatsapp.entrou_com_facebook_em === "string" ? whatsapp.entrou_com_facebook_em : null };
}

export const primeirosPassos: AreaDoChecklist = {
  chave: "primeiros_passos",
  titulo: "Primeiros passos (o passo a passo de entrada)",
  avaliar: async ({ admin }, org) => {
    const r: ResultadoDaArea = { pronto: [], falta: [], so_pela_tela: [] };
    const { data, error } = await admin
      .from("organizations")
      .select("onboarding_state, onboarded_at")
      .eq("id", org.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const linha = (data ?? {}) as { onboarding_state?: OnboardingState | null; onboarded_at?: string | null };
    const estado: OnboardingState = linha.onboarding_state ?? {};
    const passos = resumoDoOnboarding(estado, { lojaLigada: env.NUVEMSHOP_ENABLED });
    const segmento = segmentoDoEstado(estado);
    const esperando = numeroOficialEsperando(estado);

    // O número que a Time ligou já conta como conectado: aí não há mais o que esperar.
    let conectados = 0;
    if (esperando) {
      const { data: sessoes, error: erroDasSessoes } = await admin
        .from("channel_sessions")
        .select("id, status")
        .eq("organization_id", org.id)
        .is("archived_at", null);
      if (erroDasSessoes) throw new Error(erroDasSessoes.message);
      conectados = ((sessoes ?? []) as Array<{ status: string | null }>).filter((s) => s.status === STATUS_SAUDAVEL).length;
    }
    const aindaEsperando = esperando !== null && conectados === 0;

    r.dados = {
      concluido_em: linha.onboarded_at ?? null,
      no_passo_a_passo: !linha.onboarded_at,
      passos: passos.map((p) => ({
        passo: p.segmento,
        rotulo: p.rotulo,
        situacao: p.feito ? "feito" : p.pulado ? "pulado" : "pendente",
      })),
      segmento,
      segmento_rotulo: segmento ? modeloDoSegmento(segmento).rotulo : null,
      ensaio_feito: Boolean(estado.teste) && !estado.teste?.skipped,
      numero_oficial: esperando ? { esperando_a_time: aindaEsperando, entrou_com_facebook_em: esperando.desde } : null,
    };

    const feitos = passos.filter((p) => p.feito).length;
    if (linha.onboarded_at) {
      r.pronto.push(`Passo a passo concluído em ${linha.onboarded_at.slice(0, 10)}: ${feitos} de ${passos.length} passos feitos.`);
    } else {
      const proximo = passos.find((p) => !p.feito && !p.pulado);
      r.pronto.push(
        `Ainda no passo a passo: ${feitos} de ${passos.length} passos feitos${proximo ? `; o próximo é «${proximo.rotulo}»` : ""}.`,
      );
    }
    if (segmento) r.pronto.push(`Segmento confirmado: ${modeloDoSegmento(segmento).rotulo}.`);

    if (aindaEsperando) {
      r.so_pela_tela.push({
        o_que:
          "Ligar o número oficial à empresa: o cliente entrou com o Facebook" +
          (esperando?.desde ? ` em ${esperando.desde.slice(0, 10)}` : "") +
          " e o número ainda não está aqui. Confira o nome da conta da Meta antes de ligar.",
        situacao: "pendente",
        tela: "Admin › Cadastro incorporado",
        caminho: "/admin",
        quem: "plataforma",
        por_que:
          "O aviso da Meta não diz de qual empresa é o número, e ligar errado faria a conversa de um cliente sair pelo número de outro: por isso a ligação é à mão, como no upstream.",
      });
    }
    return r;
  },
};
