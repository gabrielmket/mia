/**
 * FORK MIA · coexistência (S3): LIGAR ou DESLIGAR a chave de uma empresa, com
 * as recusas que ensinam. Uma regra só para a tela de /admin/meta e para o
 * MCP de plataforma (`plataforma_ligar_coexistencia`).
 *
 * - Empresa que não opera (`ehOperante`): não liga. Desligar sempre pode.
 * - Empresa de demonstração: não liga. A 9010 não deixa nascer canal vivo
 *   nela (`trg_mia_demonstracao_sem_numero`), então o botão levaria a uma
 *   conexão que o banco recusa no fim, depois do QR lido no celular.
 * - Desligar com número conectado pelo app: desliga e AVISA que o número
 *   continua conectado (tirar o número é pelo app ou por Conexões).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ehOperante } from "@/lib/organizacao/operante";

import { mudarChaveDaCoexistencia, type ChaveDaCoexistencia } from "./chave";
import { numerosPeloApp } from "./leitura";

type Admin = SupabaseClient;

export type DesfechoDeLigar =
  | {
      ok: true;
      jaEstava: boolean;
      chave: ChaveDaCoexistencia;
      /** Ao desligar: os números pelo app que continuam conectados. */
      numerosQueContinuam: string[];
    }
  | { ok: false; motivo: "nao_existe" | "nao_operante" | "demonstracao" | "falha"; mensagem: string };

export async function ligarCoexistencia(
  admin: Admin,
  input: { organizationId: string; ligada: boolean; userId: string | null },
): Promise<DesfechoDeLigar> {
  const { data: org, error } = await admin
    .from("organizations")
    .select("id, display_name, status, demonstracao")
    .eq("id", input.organizationId)
    .maybeSingle();
  if (error) return { ok: false, motivo: "falha", mensagem: `Não consegui ler a empresa: ${error.message}` };
  if (!org) {
    return {
      ok: false,
      motivo: "nao_existe",
      mensagem: `Não existe empresa com o id ${input.organizationId}. Use plataforma_listar_clientes para achar o id certo.`,
    };
  }
  const linha = org as { display_name: string | null; status: string | null; demonstracao?: boolean | null };

  if (input.ligada && !ehOperante(linha.status)) {
    return {
      ok: false,
      motivo: "nao_operante",
      mensagem: `A empresa ${linha.display_name ?? input.organizationId} não está operando (status ${linha.status ?? "desconhecido"}): reative a empresa antes de ligar a coexistência.`,
    };
  }
  if (input.ligada && linha.demonstracao === true) {
    return {
      ok: false,
      motivo: "demonstracao",
      mensagem:
        "Empresa de demonstração não conecta número de verdade (a migration 9010 recusa canal vivo nela). Para mostrar a tela, use o protótipo; para testar a conexão, use uma empresa de teste com a Meta simulada.",
    };
  }

  const mudanca = await mudarChaveDaCoexistencia(admin, input);
  if (!mudanca.ok) return { ok: false, motivo: "falha", mensagem: `Não consegui gravar a chave: ${mudanca.detalhe}` };

  let numerosQueContinuam: string[] = [];
  if (!input.ligada) {
    const numeros = (await numerosPeloApp(admin, [input.organizationId])).get(input.organizationId) ?? [];
    numerosQueContinuam = numeros
      .filter((n) => n.estado !== "encerrada")
      .map((n) => n.phoneNumber ?? n.phoneNumberId);
  }
  return { ok: true, jaEstava: mudanca.jaEstava, chave: mudanca.chave, numerosQueContinuam };
}
