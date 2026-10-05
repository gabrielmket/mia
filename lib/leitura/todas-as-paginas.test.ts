/**
 * FORK MIA — A LEITURA QUE NÃO PARA NA LINHA 1000.
 *
 * O PostgREST corta toda resposta em `max_rows` (1000) sem erro. Estes casos
 * rodam contra um dublê que corta do mesmo jeito
 * (`tests/helpers/postgrest-com-teto.ts`), e cada um defende uma das três
 * decisões do laço: o fim se prova por contagem ou por página vazia, o próximo
 * pedido parte do que chegou, e o que não coube sai dito.
 *
 *     npx vitest run --project produto lib/leitura/todas-as-paginas.test.ts
 */
import { describe, expect, it } from "vitest";

import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";
import { postgrestComTeto, type Linha } from "@/tests/helpers/postgrest-com-teto";

const ORG = "11111111-1111-4111-8111-111111111111";

/** `n` vendas de R$ 10,00, uma por minuto, da mais antiga para a mais nova. */
function vendas(n: number): Linha[] {
  const base = Date.parse("2026-09-01T00:00:00.000Z");
  return Array.from({ length: n }, (_, i) => ({
    id: `venda-${String(i).padStart(6, "0")}`,
    organization_id: ORG,
    value_cents: 1_000,
    closed_at: new Date(base + i * 60_000).toISOString(),
  }));
}

/** A leitura NOVA: paginada, com contagem na primeira página. */
function lerPaginado(
  banco: ReturnType<typeof postgrestComTeto>,
  paginasMaximas: number,
) {
  return lerTodasAsPaginas<{ id: string; value_cents: number }>(
    (de, ate, pedirContagem) =>
      banco.cliente
        .from("crm_leads")
        .select("id, value_cents", pedirContagem ? { count: "exact" } : undefined)
        .eq("organization_id", ORG)
        .order("closed_at", { ascending: false })
        .order("id", { ascending: false })
        .range(de, ate),
    { paginasMaximas },
  );
}

const somar = (linhas: Array<{ value_cents: number }>) =>
  linhas.reduce((s, l) => s + l.value_cents, 0);

describe("ler todas as páginas", () => {
  it("2.500 linhas no período: lê as 2.500 e a soma fecha", async () => {
    const banco = postgrestComTeto({ crm_leads: vendas(2_500) });
    const lido = await lerPaginado(banco, 10);

    expect(lido.erro).toBeNull();
    expect(lido.linhas).toHaveLength(2_500);
    expect(lido.total).toBe(2_500);
    expect(lido.truncado).toBe(false);
    expect(somar(lido.linhas)).toBe(2_500_000);
    // Três páginas: 1000 + 1000 + 500. A contagem dispensa a quarta ida.
    expect(banco.pedidosEm("crm_leads")).toBe(3);
  });

  it("controle negativo: a forma antiga (.limit(50_000)) devolve 1000 e subconta calada", async () => {
    const banco = postgrestComTeto({ crm_leads: vendas(2_500) });
    const antiga = await banco.cliente
      .from("crm_leads")
      .select("id, value_cents")
      .eq("organization_id", ORG)
      .limit(50_000);
    const linhasAntigas = (antiga.data ?? []) as Array<{ value_cents: number }>;

    // Sem erro nenhum, e 1500 vendas a menos: R$ 10.000,00 no lugar de R$ 25.000,00.
    expect(antiga.error).toBeNull();
    expect(linhasAntigas).toHaveLength(1_000);
    expect(somar(linhasAntigas)).toBe(1_000_000);
    expect(somar(linhasAntigas)).not.toBe(2_500_000);
  });

  it("passou do teto de páginas: truncado, e sobra o começo da ordem pedida", async () => {
    const banco = postgrestComTeto({ crm_leads: vendas(2_500) });
    const lido = await lerPaginado(banco, 2);

    expect(lido.truncado).toBe(true);
    expect(lido.linhas).toHaveLength(2_000);
    // O total verdadeiro continua dito, para a tela poder dizer quanto ficou de fora.
    expect(lido.total).toBe(2_500);
    expect(banco.pedidosEm("crm_leads")).toBe(2);
  });

  it("no limite exato do teto não é truncado: a contagem prova o fim", async () => {
    const banco = postgrestComTeto({ crm_leads: vendas(2_000) });
    const lido = await lerPaginado(banco, 2);

    expect(lido.linhas).toHaveLength(2_000);
    expect(lido.truncado).toBe(false);
  });

  it("instalação com max_rows menor que a página: página curta não é fim", async () => {
    const banco = postgrestComTeto({ crm_leads: vendas(1_300) }, { maxRows: 500 });
    const lido = await lerPaginado(banco, 10);

    expect(lido.linhas).toHaveLength(1_300);
    expect(lido.truncado).toBe(false);
    // Cada pedido parte do que CHEGOU: 0, 500, 1000.
    expect(banco.pedidos.map((p) => p.range?.[0])).toEqual([0, 500, 1_000]);
    expect(new Set(lido.linhas.map((l) => l.id)).size).toBe(1_300);
  });

  it("servidor que não diz a contagem: só a página vazia prova o fim", async () => {
    const banco = postgrestComTeto({ crm_leads: vendas(2_500) }, { semContagem: true });
    const lido = await lerPaginado(banco, 10);

    expect(lido.total).toBeNull();
    expect(lido.linhas).toHaveLength(2_500);
    expect(lido.truncado).toBe(false);
    // 1000 + 1000 + 500 + a página vazia que prova o fim.
    expect(banco.pedidosEm("crm_leads")).toBe(4);
  });

  it("sem contagem e sem página vazia dentro do teto: não finge que acabou", async () => {
    const banco = postgrestComTeto({ crm_leads: vendas(2_000) }, { semContagem: true });
    const lido = await lerPaginado(banco, 2);

    // Vieram as 2.000, mas nada provou que não havia a 2.001ª.
    expect(lido.linhas).toHaveLength(2_000);
    expect(lido.truncado).toBe(true);
  });

  it("período vazio: uma ida, zero linhas, nada truncado", async () => {
    const banco = postgrestComTeto({ crm_leads: [] });
    const lido = await lerPaginado(banco, 10);

    expect(lido).toEqual({ linhas: [], truncado: false, total: 0, erro: null });
    expect(banco.pedidosEm("crm_leads")).toBe(1);
  });

  it("página que falha: devolve o erro e nenhuma linha, em vez de um total pela metade", async () => {
    const banco = postgrestComTeto(
      { crm_leads: vendas(2_500) },
      { falhaEm: (pedido) => (pedido === 2 ? "canceling statement due to statement timeout" : null) },
    );
    const lido = await lerPaginado(banco, 10);

    expect(lido.erro).toBe("canceling statement due to statement timeout");
    expect(lido.linhas).toEqual([]);
  });

  it("a contagem só é pedida na primeira página", async () => {
    const banco = postgrestComTeto({ crm_leads: vendas(2_500) });
    await lerPaginado(banco, 10);

    expect(banco.pedidos.map((p) => p.pediuContagem)).toEqual([true, false, false]);
  });
});
