/**
 * FORK MIA (.91) · A ÁREA "PLANO E COBRANÇA" DO CHECKLIST DA IMPLANTAÇÃO.
 *
 * A pergunta é uma só: a empresa assinou? Ela lê DIRETO as tabelas de
 * assinatura do upstream (`cobranca_assinaturas`, 0583, e `cobranca_planos`),
 * sem passar por peça nenhuma do fork, para não depender da cobrança da MIA e
 * dizer o mesmo que a tela Plano e cobrança do upstream.
 *
 * ── Quando não se aplica ──────────────────────────────────────────────────
 *
 *   cobrança desligada   a chave da instalação (`MODULO_COBRANCA`) está
 *                        desligada: ninguém paga pelo sistema
 *   empresa isenta       sem linha em `cobranca_assinaturas` (a regra do
 *                        upstream: sem linha = isenta de cobrança, limite e
 *                        régua). É o caso de toda empresa implantada pela Time
 *   demonstração         a empresa fictícia não assina (9021)
 *
 * Nos três casos a área diz "não se aplica" e nunca vira pendência.
 */
import { modulosLigados } from "@/lib/instalacao/modulos";

import type { AreaDoChecklist, ResultadoDaArea } from "./tipos";

export type MotivoDoNaoSeAplica = "cobranca_desligada" | "isenta" | "demonstracao";

export const planoECobranca: AreaDoChecklist = {
  chave: "plano_e_cobranca",
  titulo: "Plano e cobrança",
  avaliar: async (ctx, org) => {
    const r: ResultadoDaArea = { pronto: [], falta: [], so_pela_tela: [] };
    const naoSeAplica = (motivo: MotivoDoNaoSeAplica, frase: string): ResultadoDaArea => {
      r.pronto.push(frase);
      r.dados = { aplica: false, motivo, cobranca_ligada: motivo !== "cobranca_desligada" };
      return r;
    };

    if (org.demonstracao) return naoSeAplica("demonstracao", "Empresa de demonstração: não assina plano.");

    const ligada =
      typeof ctx.instalacao?.cobrancaLigada === "boolean"
        ? ctx.instalacao.cobrancaLigada
        : (await modulosLigados(ctx.admin)).includes("cobranca");
    if (!ligada) return naoSeAplica("cobranca_desligada", "A cobrança está desligada nesta instalação: ninguém paga pelo sistema.");

    const { data, error } = await ctx.admin
      .from("cobranca_assinaturas")
      .select("plano_id, estado, trial_ate, provedor, provedor_assinatura_id, vencida_desde, proximo_vencimento, cancela_no_fim")
      .eq("organization_id", org.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const a = data as {
      plano_id: string;
      estado: "trial" | "ativa" | "em_atraso" | "cancelada";
      trial_ate: string | null;
      provedor: string | null;
      provedor_assinatura_id: string | null;
      vencida_desde: string | null;
      proximo_vencimento: string | null;
      cancela_no_fim: boolean;
    } | null;
    if (!a) return naoSeAplica("isenta", "Empresa isenta: sem assinatura, sem limite e sem régua de cobrança.");

    // O nome do plano é da INSTALAÇÃO (só o servidor lê `cobranca_planos`):
    // pela sessão ele não vem, e a área segue sem ele.
    let plano: string | null = null;
    const { data: linhaDoPlano } = await ctx.admin.from("cobranca_planos").select("nome").eq("id", a.plano_id).maybeSingle();
    plano = (linhaDoPlano as { nome?: string } | null)?.nome ?? null;

    const assinou = a.provedor_assinatura_id !== null || a.estado === "ativa";
    r.dados = {
      aplica: true,
      cobranca_ligada: true,
      estado: a.estado,
      assinou,
      plano,
      teste_ate: a.trial_ate,
      vencida_desde: a.vencida_desde,
      proximo_vencimento: a.proximo_vencimento,
      cancela_no_fim: a.cancela_no_fim,
    };

    const doPlano = plano ? ` no plano ${plano}` : "";
    if (a.estado === "em_atraso") {
      r.so_pela_tela.push({
        o_que: assinou
          ? `Regularizar o pagamento${doPlano}: em atraso desde ${(a.vencida_desde ?? "").slice(0, 10)}.`
          : `Assinar${doPlano}: o teste grátis acabou em ${(a.trial_ate ?? "").slice(0, 10)}.`,
        situacao: "pendente",
        tela: "Configurações › Plano e cobrança",
        caminho: "/app/settings/billing",
        quem: "cliente",
        por_que: "Pagamento é coisa que só quem administra a empresa faz, pela tela.",
      });
      return r;
    }
    if (assinou) {
      r.pronto.push(`Plano assinado${doPlano}.`);
      r.so_pela_tela.push({
        o_que: "Assinar o plano.",
        situacao: "feito",
        tela: "Configurações › Plano e cobrança",
        caminho: "/app/settings/billing",
        quem: "cliente",
        por_que: "Pagamento é coisa que só quem administra a empresa faz, pela tela.",
      });
      return r;
    }
    r.so_pela_tela.push({
      o_que: `Assinar${doPlano}${a.trial_ate ? `: em teste até ${a.trial_ate.slice(0, 10)}` : ""}.`,
      situacao: "pendente",
      tela: "Configurações › Plano e cobrança",
      caminho: "/app/settings/billing",
      quem: "cliente",
      por_que: "Pagamento é coisa que só quem administra a empresa faz, pela tela.",
    });
    return r;
  },
};
