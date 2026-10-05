/**
 * FORK MIA — A LISTA DAS OBRIGAÇÕES NÃO PARA NA LINHA 1000.
 *
 * A lista geral lia `mia_obrigacoes` com `.limit(3001)` e o PostgREST cortava
 * em 1000 sem avisar: numa casa com 2.500 documentos e atividades, a tela
 * mostrava os 1000 mais antigos, os contadores saíam deles, e o aviso "a lista
 * passou do teto" (que comparava com 3000) nunca aparecia.
 *
 *     npx vitest run --project produto tests/unit/obrigacoes-a-lista-nao-para-na-linha-1000.test.ts
 */
import { describe, expect, it } from "vitest";

import { lerObrigacoes, TETO_DA_LISTA } from "@/lib/obrigacoes/leitura";
import { postgrestComTeto, type Linha } from "@/tests/helpers/postgrest-com-teto";

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";

function obrigacao(i: number, organization_id = ORG): Linha {
  return {
    id: `${organization_id.slice(0, 4)}-obrigacao-${String(i).padStart(6, "0")}`,
    organization_id,
    tipo_id: null,
    nome: `Alvará ${i}`,
    nome_curto: null,
    categoria: "documento",
    lead_id: null,
    empresa_id: null,
    contact_id: null,
    quem_entrega: "cliente",
    recorrencia: "nenhuma",
    recorrencia_meses: null,
    validade_meses: null,
    avisos_dias: [],
    dias_sem_resposta: null,
    pedido_em: null,
    prazo_em: null,
    cobrado_em: null,
    recebido_em: null,
    valido_ate: null,
    renovado_em: null,
    proxima_em: null,
    feita_em: null,
    ciclo: 1,
    arquivo_path: null,
    arquivo_nome: null,
    arquivo_mime: null,
    arquivo_bytes: null,
    responsavel_user_id: null,
    observacao: null,
    origem: "manual",
    chave_natural: null,
    sem_aviso_antes_de: null,
    arquivado_em: null,
    created_at: new Date(Date.parse("2026-09-01T12:00:00.000Z") + i * 1_000).toISOString(),
    updated_at: "2026-09-01T12:00:00.000Z",
  };
}

const banco = (quantas: number) =>
  postgrestComTeto({
    mia_obrigacoes: [
      ...Array.from({ length: quantas }, (_, i) => obrigacao(i)),
      ...Array.from({ length: 200 }, (_, i) => obrigacao(i, OUTRA_ORG)),
    ],
    mia_obrigacoes_propostas: [],
    crm_leads: [],
    crm_empresas: [],
    contacts: [],
  });

describe("a lista geral das obrigações", () => {
  it("2.500 itens: a lista traz os 2.500, e não os 1000 mais antigos", async () => {
    const db = banco(2_500);

    const leitura = await lerObrigacoes(db.cliente as never, ORG, { tipo: "lista" });

    expect(leitura?.itens).toHaveLength(2_500);
    expect(leitura?.cortada).toBe(false);
    expect(new Set(leitura?.itens.map((i) => i.id)).size).toBe(2_500);
  });

  it("controle negativo: a leitura antiga (.limit(3001)) trazia 1000 e nunca dizia que cortou", async () => {
    const db = banco(2_500);

    const antiga = await db.cliente
      .from("mia_obrigacoes")
      .select("id")
      .eq("organization_id", ORG)
      .is("arquivado_em", null)
      .order("created_at", { ascending: true })
      .limit(TETO_DA_LISTA + 1);

    expect(antiga.data).toHaveLength(1_000);
    // O aviso antigo: `todas.length > TETO_DA_LISTA`. Com 1000 linhas, sempre falso.
    expect((antiga.data ?? []).length > TETO_DA_LISTA).toBe(false);
  });

  it("acima do teto da lista: traz os 3.000 primeiros e avisa que cortou", async () => {
    const db = banco(3_001);

    const leitura = await lerObrigacoes(db.cliente as never, ORG, { tipo: "lista" });

    expect(leitura?.itens).toHaveLength(TETO_DA_LISTA);
    expect(leitura?.cortada).toBe(true);
  });
});
