/**
 * FORK MIA (.98) · O QUE A PÁGINA DE PREÇOS, O CADASTRO E O PASSO DO PAGAMENTO
 * PODEM SABER DE UM CUPOM (protótipo "Cupons e parceiros", tela 1).
 *
 * Leitura PÚBLICA (quem chega pelo link ainda não tem conta), então mora aqui a
 * régua do que sai: o que o cupom dá, em quais planos vale, até quando, e o nome
 * do parceiro que indicou (o selo diz "Indicação de ..."). Nunca a comissão,
 * nunca o documento, o e-mail ou o Pix do parceiro, nunca quantas vezes foi
 * usado (só "esgotado").
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { moduloLigado } from "@/lib/instalacao/modulos";

import { lerCupomPorCodigo } from "./banco";
import { codigoValido, motivoDoCupom, normalizarCodigo, type Beneficio, type MotivoDoCupom, type TipoDoDescontoNoSetup } from "./regras";

export interface CupomPublico {
  codigo: string;
  /** Vale em algum plano agora (sem olhar o plano escolhido). */
  valido: boolean;
  /** Por que não vale (sem olhar o plano). `null` = vale. */
  motivo: MotivoDoCupom | null;
  beneficio: Beneficio | null;
  valor: number | null;
  meses: number | null;
  setup_tipo: TipoDoDescontoNoSetup;
  setup_valor: number;
  /** Os planos em que vale (ids). */
  planos: string[];
  vale_ate: string | null;
  /** O nome de quem indicou (o selo). */
  parceiro: string | null;
}

/** O cupom para o público. `null` = código vazio ou com caractere que não cabe. Nunca lança. */
export async function lerCupomPublico(admin: SupabaseClient, bruto: unknown, agora: Date = new Date()): Promise<CupomPublico | null> {
  const codigo = normalizarCodigo(bruto);
  if (!codigoValido(codigo)) return null;
  const naoAchado: CupomPublico = {
    codigo,
    valido: false,
    motivo: "inexistente",
    beneficio: null,
    valor: null,
    meses: null,
    setup_tipo: "nenhum",
    setup_valor: 0,
    planos: [],
    vale_ate: null,
    parceiro: null,
  };
  try {
    if (!(await moduloLigado(admin, "cobranca"))) return { ...naoAchado, motivo: "cobranca_desligada" };
    const cupom = await lerCupomPorCodigo(admin, codigo);
    if (!cupom) return naoAchado;
    const motivo = motivoDoCupom(cupom, { planoId: null, usos: cupom.usos, agora });
    let parceiro: string | null = null;
    if (cupom.parceiro_id) {
      const { data } = await admin.from("mia_parceiros").select("nome, anonimizado_em").eq("id", cupom.parceiro_id).maybeSingle();
      const p = data as { nome: string; anonimizado_em: string | null } | null;
      parceiro = p && !p.anonimizado_em ? p.nome : null;
    }
    return {
      codigo: cupom.codigo,
      valido: motivo === null,
      motivo,
      beneficio: cupom.beneficio,
      valor: cupom.valor,
      meses: cupom.meses,
      setup_tipo: cupom.setup_tipo,
      setup_valor: cupom.setup_valor,
      planos: [...cupom.planos],
      vale_ate: cupom.vale_ate,
      parceiro,
    };
  } catch {
    // Leitura que falha não vira "cupom inexistente" para quem digitou certo: some o selo.
    return null;
  }
}
