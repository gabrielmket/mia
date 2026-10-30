/**
 * FORK MIA (.98) · O CUPOM NO CADASTRO PÚBLICO (protótipo "Cupons e parceiros",
 * tela 1). A action confere de novo o que a tela mostrou (a tela é adulterável):
 * inexistente, pausado, vencido, esgotado e fora do plano recusam com a frase
 * certa. O cupom bom espera a empresa nascer (`mia_cupom_do_cadastro`, 9130).
 *
 * Cupom de DIAS GRÁTIS num plano de entrada paga: a empresa nasce no teste, então
 * o cadastro é o do plano com teste (os dados fiscais ficam para o passo).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerPlanosDoCadastro } from "@/lib/cobranca/cadastro";
import { moduloLigado } from "@/lib/instalacao/modulos";

import { lerCupomPorCodigo } from "./banco";
import { codigoValido, fraseDoMotivo, motivoDoCupom, normalizarCodigo } from "./regras";

export type ConferenciaDoCupomDoCadastro =
  | { ok: true; codigo: string | null; diasGratis: boolean }
  | { ok: false; mensagem: string };

export async function conferirCupomDoCadastro(
  admin: SupabaseClient,
  planoEscolhido: string | undefined,
  bruto: unknown,
  agora: Date = new Date(),
): Promise<ConferenciaDoCupomDoCadastro> {
  const codigo = normalizarCodigo(bruto);
  if (codigo === "") return { ok: true, codigo: null, diasGratis: false };
  if (!(await moduloLigado(admin, "cobranca"))) return { ok: true, codigo: null, diasGratis: false };
  if (!codigoValido(codigo)) return { ok: false, mensagem: fraseDoMotivo("inexistente", { codigo }) };
  const [cupom, planos] = await Promise.all([lerCupomPorCodigo(admin, codigo), lerPlanosDoCadastro(admin)]);
  const planoId = planoEscolhido ?? planos?.padraoId ?? null;
  const plano = planos?.oferecidos.find((p) => p.id === planoId);
  const motivo = motivoDoCupom(cupom, { planoId, planoOferecido: plano !== undefined, usos: cupom?.usos ?? 0, agora });
  if (motivo) {
    const nomes = (planos?.oferecidos ?? []).filter((p) => cupom?.planos.includes(p.id)).map((p) => p.nome);
    return { ok: false, mensagem: fraseDoMotivo(motivo, { codigo, data: cupom?.vale_ate ?? null, plano: plano?.nome ?? "", planos: nomes }) };
  }
  return { ok: true, codigo, diasGratis: cupom?.beneficio === "dias" };
}
