/**
 * FORK MIA (.91) · A ÁREA "PLANO E COBRANÇA" DO CHECKLIST DA IMPLANTAÇÃO.
 *
 * A pergunta é uma só: a empresa assinou? Ela lê DIRETO a assinatura do
 * upstream (`cobranca_assinaturas`, 0583, e `cobranca_planos`) e decide pela
 * MESMA situação que a tela da Time (Admin › Empresas do cadastro), o MCP e os
 * recados no zap usam desde a .90: `situacaoDaEmpresa` (`lib/planos-mia/
 * situacao.ts`). Teste, em dia, em atraso, no prazo extra, suspensa, cancelada
 * ou isenta: uma régua só, e a do cliente não diverge da que a Time vê.
 *
 * ── Quando não se aplica ──────────────────────────────────────────────────
 *
 *   cobrança desligada   a chave da instalação (`MODULO_COBRANCA`) está
 *                        desligada: ninguém paga pelo sistema
 *   empresa isenta       sem linha em `cobranca_assinaturas` (a regra do
 *                        upstream: sem linha = isenta de cobrança, limite e
 *                        régua). É o caso da empresa implantada pela Time
 *                        (`mia_origem_da_empresa` = implantacao, 9071)
 *   demonstração         a empresa fictícia não assina (9021)
 *
 * Nos três casos a área diz "não se aplica" e nunca vira pendência.
 *
 * ── O que a .90 acrescenta, só para quem lê pelo servidor ─────────────────
 *
 * Os módulos que o plano liga (`mia_plano_modulos`, 9070, perguntados pela
 * `fn_mia_modulos_do_plano`) e a origem da empresa (9071). A origem é só do
 * servidor: pela sessão a leitura é recusada e o campo fica `null`, sem
 * derrubar a área. Nenhum item do "o que falta" depende de módulo do plano
 * (disparo, e-mail marketing e Vendas B2B não são primeiros passos).
 */
import { modulosLigados } from "@/lib/instalacao/modulos";
import { modulosPeloPlano } from "@/lib/planos-mia/modulos";
import { situacaoDaEmpresa, type AssinaturaLida, type SituacaoDaEmpresa } from "@/lib/planos-mia/situacao";

import type { AreaDoChecklist, ResultadoDaArea } from "./tipos";

export type MotivoDoNaoSeAplica = "cobranca_desligada" | "isenta" | "demonstracao";

/** As colunas da assinatura que a situação da .90 lê. */
const COLUNAS_DA_ASSINATURA =
  "plano_id, plano_agendado_id, estado, trial_ate, vencida_desde, proximo_vencimento, prazo_extra_ate, cancela_no_fim, " +
  "assinaturas_vivas, ultimo_aviso, ultimo_aviso_em, provedor, provedor_assinatura_id, pagamento_inicial_pendente, link_de_pagamento";

/**
 * Assinou: em dia, ou ainda no teste com a assinatura já feita no provedor (o
 * pagamento cadastrado; a primeira cobrança vem no fim do teste). Pedir
 * "assine" a quem já assinou seria o "o que falta" mentindo.
 */
export function assinouPelaSituacao(
  situacao: SituacaoDaEmpresa,
  a: { provedor_assinatura_id: string | null; pagamento_inicial_pendente: boolean },
): boolean {
  if (situacao === "emdia") return true;
  return situacao === "teste" && a.provedor_assinatura_id !== null && !a.pagamento_inicial_pendente;
}

const POR_QUE = "Pagamento é coisa que só quem administra a empresa faz, pela tela.";
const TELA = { tela: "Configurações › Plano e cobrança", caminho: "/app/settings/billing" } as const;

export const planoECobranca: AreaDoChecklist = {
  chave: "plano_e_cobranca",
  titulo: "Plano e cobrança",
  avaliar: async (ctx, org) => {
    const r: ResultadoDaArea = { pronto: [], falta: [], so_pela_tela: [] };
    const naoSeAplica = (motivo: MotivoDoNaoSeAplica, frase: string, origem: string | null = null): ResultadoDaArea => {
      r.pronto.push(frase);
      r.dados = { aplica: false, motivo, cobranca_ligada: motivo !== "cobranca_desligada", origem };
      return r;
    };

    if (org.demonstracao) return naoSeAplica("demonstracao", "Empresa de demonstração: não assina plano.");

    const ligada =
      typeof ctx.instalacao?.cobrancaLigada === "boolean"
        ? ctx.instalacao.cobrancaLigada
        : (await modulosLigados(ctx.admin)).includes("cobranca");
    if (!ligada) return naoSeAplica("cobranca_desligada", "A cobrança está desligada nesta instalação: ninguém paga pelo sistema.");

    const [assinatura, linhaDaOrigem] = await Promise.all([
      ctx.admin.from("cobranca_assinaturas").select(COLUNAS_DA_ASSINATURA).eq("organization_id", org.id).maybeSingle(),
      // Só do servidor (9071): pela sessão vem a recusa, e a origem fica null.
      ctx.admin.from("mia_origem_da_empresa").select("origem").eq("organization_id", org.id).maybeSingle(),
    ]);
    if (assinatura.error) throw new Error(assinatura.error.message);
    const origem = linhaDaOrigem.error ? null : ((linhaDaOrigem.data as { origem?: string } | null)?.origem ?? null);
    const a = assinatura.data as (AssinaturaLida & { provedor_assinatura_id: string | null }) | null;
    if (!a) return naoSeAplica("isenta", "Empresa isenta: sem assinatura, sem limite e sem régua de cobrança.", origem);

    // O nome do plano é da INSTALAÇÃO (só o servidor lê `cobranca_planos`):
    // pela sessão ele não vem, e a área segue sem ele.
    const [{ data: linhaDoPlano }, modulos] = await Promise.all([
      ctx.admin.from("cobranca_planos").select("nome").eq("id", a.plano_id).maybeSingle(),
      modulosPeloPlano(ctx.admin, org.id),
    ]);
    const plano = (linhaDoPlano as { nome?: string } | null)?.nome ?? null;

    const situacao = situacaoDaEmpresa(a, { status: org.status, suspended_kind: null }, new Date());
    const assinou = assinouPelaSituacao(situacao, a);
    // Já pagou alguma vez (tem assinatura no provedor): o que falta é regularizar, não assinar.
    const jaPagou = a.provedor_assinatura_id !== null || a.estado === "ativa";
    r.dados = {
      aplica: true,
      cobranca_ligada: true,
      situacao,
      estado: a.estado,
      assinou,
      ja_pagou: jaPagou && situacao !== "cancelada",
      plano,
      teste_ate: a.trial_ate,
      vencida_desde: a.vencida_desde,
      prazo_extra_ate: a.prazo_extra_ate,
      proximo_vencimento: a.proximo_vencimento,
      cancela_no_fim: a.cancela_no_fim,
      modulos_do_plano: modulos,
      origem,
    };

    const doPlano = plano ? ` no plano ${plano}` : "";
    if (assinou) {
      r.pronto.push(`Plano assinado${doPlano}.`);
      r.so_pela_tela.push({ o_que: "Assinar o plano.", situacao: "feito", ...TELA, quem: "cliente", por_que: POR_QUE });
      return r;
    }
    const oQue =
      situacao === "teste"
        ? `Assinar${doPlano}${a.trial_ate ? `: em teste até ${a.trial_ate.slice(0, 10)}` : ""}.`
        : situacao === "prazo"
          ? `Regularizar o pagamento${doPlano}: no prazo extra até ${(a.prazo_extra_ate ?? "").slice(0, 10)}.`
          : situacao === "suspensa"
            ? `Regularizar o pagamento${doPlano}: a empresa está suspensa.`
            : situacao === "cancelada"
              ? `Assinar de novo${doPlano}: a assinatura foi cancelada.`
              : jaPagou
                ? `Regularizar o pagamento${doPlano}: em atraso desde ${(a.vencida_desde ?? "").slice(0, 10)}.`
                : `Assinar${doPlano}: o teste grátis acabou em ${(a.trial_ate ?? "").slice(0, 10)}.`;
    r.so_pela_tela.push({ o_que: oQue, situacao: "pendente", ...TELA, quem: "cliente", por_que: POR_QUE });
    return r;
  },
};
