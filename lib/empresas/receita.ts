/**
 * FORK MIA · EMPRESA ÚNICA — a consulta do CNPJ na Receita (pela BrasilAPI do upstream).
 *
 * Decisão do protótipo aprovado em 15/10/2026: a consulta é SÓ PELA TELA, por
 * uma pessoa. O agente não consulta sozinho, o MCP não consulta, e as empresas
 * de DEMONSTRAÇÃO não consultam: de lá nada sai para fora (migration 9010,
 * `lib/demonstracao/trava.ts`). A trava vem ANTES de qualquer chamada de rede, e
 * falha fechada: não deu para confirmar que a empresa é de verdade, não consulta.
 *
 * O cliente e o mapeamento dos campos são os do upstream
 * (`lib/brasil-api/client.ts`): a régua do que a Receita devolve continua dele.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createBrasilApiClient,
  mapBrasilApiToCompanyFields,
  type BrasilApiClient,
} from "@/lib/brasil-api/client";
import { normalizeCnpj } from "@/lib/crm-b2b/normalize";
import { travaDaDemonstracao } from "@/lib/demonstracao/trava";

import { formatarCnpj, type CamposDaReceita } from "./fonte-unica";

export type ResultadoDaConsulta =
  | {
      ok: true;
      cnpj: string;
      normalizado: string;
      campos: CamposDaReceita;
      /** A resposta inteira MENOS o quadro de sócios (dado pessoal sem finalidade). */
      bruta: Record<string, unknown> | null;
    }
  | {
      ok: false;
      motivo: "cnpj_invalido" | "demonstracao" | "nao_encontrado" | "falhou";
      mensagem: string;
    };

/** A resposta da Receita sem o `qsa` (nome e parte do CPF dos sócios). */
export function semSocios(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { qsa: _qsa, ...resto } = raw as Record<string, unknown>;
  return resto;
}

/**
 * A empresa NÃO pode consultar a Receita (é de demonstração, ou não deu para
 * confirmar que não é). As rotas do upstream (`/api/v1/companies/*`, a planilha
 * de `/api/v1/imports`) perguntam isto antes de enriquecer; as nossas passam por
 * `consultarReceita`, que pergunta sozinha.
 */
export async function receitaTravada(db: Pick<SupabaseClient, "rpc">, organizationId: string): Promise<boolean> {
  return (await travaDaDemonstracao(db, organizationId)).travado;
}

export async function consultarReceita(
  db: Pick<SupabaseClient, "rpc">,
  organizationId: string,
  cnpj: string,
  cliente: BrasilApiClient = createBrasilApiClient(),
): Promise<ResultadoDaConsulta> {
  const normalizado = normalizeCnpj(cnpj);
  if (!normalizado) return { ok: false, motivo: "cnpj_invalido", mensagem: "Informe os 14 números do CNPJ." };

  const trava = await travaDaDemonstracao(db, organizationId);
  if (trava.travado) {
    return {
      ok: false,
      motivo: "demonstracao",
      mensagem: "Esta é a empresa de demonstração: a consulta à Receita fica desligada, porque daqui nada sai.",
    };
  }

  const r = await cliente.lookupCnpj(normalizado);
  if (!r.ok) {
    if (r.code === "not_found") {
      return { ok: false, motivo: "nao_encontrado", mensagem: "A Receita não encontrou este CNPJ." };
    }
    return {
      ok: false,
      motivo: "falhou",
      mensagem:
        r.status === 403 || r.status === 429
          ? "A Receita recusou a consulta agora. Tente de novo em alguns minutos."
          : "Não consegui consultar a Receita agora. Tente de novo em instantes.",
    };
  }
  return {
    ok: true,
    cnpj: formatarCnpj(normalizado) ?? normalizado,
    normalizado,
    campos: mapBrasilApiToCompanyFields(r.data),
    bruta: semSocios(r.raw),
  };
}
