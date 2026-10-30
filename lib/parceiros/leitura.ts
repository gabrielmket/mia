/**
 * FORK MIA (.98) · O QUE AS TELAS DA TIME E O MCP LEEM DOS PARCEIROS E DOS
 * REPASSES (Admin › Parceiros, Repasses do mês; `plataforma_ver_parceiros`,
 * `plataforma_ver_repasses`). Só lê. LANÇA na falha: tela de dinheiro não mostra
 * "zero" de um banco que não respondeu.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { hojeEmSaoPaulo } from "@/lib/cupons/regras";

import { clientesDoParceiro, lerParceiros, type ClienteDoParceiro, type Parceiro } from "./banco";
import { lerConfiguracaoDaComissao } from "./configuracao";
import {
  lancamentosAbertos,
  lerRepassesDoMes,
  prazosDoRepasse,
  situacaoDoRepasse,
  totaisDosLancamentos,
  type LancamentoDoRepasse,
  type Repasse,
  type SituacaoDoRepasse,
} from "./repasses";
import { competenciaDe, mesAnterior, type ConfiguracaoDaComissao } from "./regras";

export interface ParceiroNaLista extends Parceiro {
  cupons: string[];
  clientes: ClienteDoParceiro[];
  /** O que ainda não virou repasse: o saldo que entra no próximo fechamento. */
  a_receber_cents: number;
  /** O que os clientes pagaram no mês corrente (só cobranças comissionadas). */
  pago_no_mes_cents: number;
}

export async function lerParceirosParaATela(admin: SupabaseClient, agora: Date = new Date()): Promise<ParceiroNaLista[]> {
  const [parceiros, cupons, abertas] = await Promise.all([
    lerParceiros(admin),
    admin.from("mia_cupons").select("codigo, parceiro_id").not("parceiro_id", "is", null).limit(2000),
    lancamentosAbertos(admin),
  ]);
  if (cupons.error) throw new Error(`parceiros: cupons ilegíveis (${cupons.error.code ?? "sem_codigo"})`);
  const mes = competenciaDe(hojeEmSaoPaulo(agora));
  const codigos = new Map<string, string[]>();
  for (const c of (cupons.data ?? []) as Array<{ codigo: string; parceiro_id: string }>) {
    codigos.set(c.parceiro_id, [...(codigos.get(c.parceiro_id) ?? []), c.codigo]);
  }
  const porParceiro = new Map<string, LancamentoDoRepasse[]>();
  for (const l of abertas as Array<LancamentoDoRepasse & { parceiro_id: string }>) {
    porParceiro.set(l.parceiro_id, [...(porParceiro.get(l.parceiro_id) ?? []), l]);
  }
  return Promise.all(
    parceiros.map(async (p) => {
      const ls = porParceiro.get(p.id) ?? [];
      return {
        ...p,
        cupons: codigos.get(p.id) ?? [],
        clientes: await clientesDoParceiro(admin, p.id),
        a_receber_cents: ls.reduce((s, l) => s + l.comissao_cents, 0),
        pago_no_mes_cents: ls.filter((l) => l.competencia === mes && l.tipo !== "estorno").reduce((s, l) => s + l.valor_pago_cents, 0),
      };
    }),
  );
}

export interface RepasseNaTela extends Repasse {
  situacao: SituacaoDoRepasse;
  parceiro: string;
  tipo_documento: "cpf" | "cnpj" | null;
  chave_pix: string | null;
  email: string | null;
  lancamentos: LancamentoDoRepasse[];
  totais: ReturnType<typeof totaisDosLancamentos>;
}

export interface RepassesDoMes {
  competencia: string;
  config: ConfiguracaoDaComissao;
  prazos: { nota_ate: string; pix_ate: string };
  repasses: RepasseNaTela[];
  total_cents: number;
}

/** O mês que a tela abre: o último fechado pelo calendário. Puro. */
export function competenciaPadrao(agora: Date): string {
  return mesAnterior(competenciaDe(hojeEmSaoPaulo(agora)));
}

export async function lerRepassesParaATela(admin: SupabaseClient, competencia: string): Promise<RepassesDoMes> {
  const [config, repasses, parceiros] = await Promise.all([lerConfiguracaoDaComissao(admin), lerRepassesDoMes(admin, competencia), lerParceiros(admin)]);
  const porId = new Map(parceiros.map((p) => [p.id, p]));
  const linhas: RepasseNaTela[] = repasses
    .map((r) => {
      const p = porId.get(r.parceiro_id);
      return {
        ...r,
        situacao: situacaoDoRepasse(r),
        parceiro: p?.nome ?? "Parceiro",
        tipo_documento: p?.tipo_documento ?? null,
        chave_pix: p?.chave_pix ?? null,
        email: p?.email ?? null,
        totais: totaisDosLancamentos(r.lancamentos),
      };
    })
    .sort((a, b) => a.parceiro.localeCompare(b.parceiro, "pt-BR"));
  return {
    competencia,
    config,
    prazos: prazosDoRepasse(competencia, config),
    repasses: linhas,
    total_cents: linhas.reduce((s, r) => s + r.total_cents, 0),
  };
}
