import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { chavesDaCoexistencia } from "@/lib/channels/meta/coexistencia/chave";
import { emFatias, IDS_POR_CONSULTA } from "@/lib/channels/meta/coexistencia/fatias";
import { numerosPeloApp } from "@/lib/channels/meta/coexistencia/leitura";

/**
 * FORK MIA · coexistência (S3): a tabela "Coexistência por empresa" de
 * /admin/meta lê até mil empresas, e o PostgREST leva o `.in(...)` na URL. Mil
 * uuids num `.in` só passam de 37 KB e estouram a linha da requisição. Aqui um
 * cliente falso com 350 empresas prova que NENHUMA consulta leva mais de
 * `IDS_POR_CONSULTA` ids e que nada se perde entre as fatias (pedido do
 * Revisor na MIA-65).
 *
 * Dado fictício: ids gerados, números +55 31 9000000xx.
 */
const EMPRESAS = 350;

function id(prefixo: string, n: number): string {
  return `c0e59164-${prefixo}-4000-8000-${String(n).padStart(12, "0")}`;
}

const ORGS = Array.from({ length: EMPRESAS }, (_, i) => id("0000", i));

/** O banco falso: as linhas de cada tabela, e cada `.in` que chegou. */
function bancoFalso() {
  const tabelas: Record<string, Array<Record<string, unknown>>> = {
    mia_coexistencia_da_empresa: ORGS.map((o, i) => ({
      organization_id: o,
      ligada: i % 2 === 0,
      mudada_por: null,
      mudada_em: "2026-11-18T12:00:00.000Z",
    })),
    mia_coexistencia_conexoes: ORGS.map((o, i) => ({
      id: id("2222", i),
      organization_id: o,
      channel_session_id: id("4444", i),
      waba_id: `waba-${i}`,
      phone_number_id: `pn-${i}`,
      estado: "no_ar",
      aberta_por: "conexao_pelo_app",
      conectada_em: new Date(Date.UTC(2026, 10, 18, 0, 0, i)).toISOString(),
      fora_do_ar_motivo: null,
      fora_do_ar_em: null,
      voltou_em: null,
    })),
    mia_coexistencia_sincronizacoes: ORGS.flatMap((o, i) =>
      ["historico", "contatos"].map((tipo) => ({
        id: `${tipo}-${i}`,
        organization_id: o,
        conexao_id: id("2222", i),
        tipo,
        estado: "pedida",
      })),
    ),
    channel_sessions: ORGS.map((o, i) => ({
      id: id("4444", i),
      organization_id: o,
      phone_number: `+553190000${String(i).padStart(4, "0")}`,
    })),
  };
  const ins: Array<{ tabela: string; coluna: string; n: number }> = [];

  const cliente = {
    from(tabela: string) {
      const filtros: Array<(l: Record<string, unknown>) => boolean> = [];
      let limite = Number.POSITIVE_INFINITY;
      const consulta = {
        select: () => consulta,
        order: () => consulta,
        limit: (n: number) => {
          limite = n;
          return consulta;
        },
        in: (coluna: string, valores: readonly unknown[]) => {
          ins.push({ tabela, coluna, n: valores.length });
          const conjunto = new Set(valores);
          filtros.push((l) => conjunto.has(l[coluna]));
          return consulta;
        },
        then: (resolver: (r: { data: unknown[]; error: null }) => unknown) =>
          resolver({
            data: (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l))).slice(0, limite),
            error: null,
          }),
      };
      return consulta;
    },
  };
  return { admin: cliente as unknown as SupabaseClient, ins };
}

describe("os ids vão ao banco em fatias", () => {
  it("as fatias não repetem nem perdem id", () => {
    const fatias = emFatias([...ORGS, ORGS[0] as string]);
    expect(fatias.map((f) => f.length)).toEqual([100, 100, 100, 50]);
    expect(new Set(fatias.flat()).size).toBe(EMPRESAS);
  });

  it("350 empresas: as chaves vêm todas, nenhuma consulta com mais de 100 ids", async () => {
    const { admin, ins } = bancoFalso();
    const chaves = await chavesDaCoexistencia(admin, ORGS);
    expect(chaves.size).toBe(EMPRESAS);
    expect(chaves.get(ORGS[0] as string)?.ligada).toBe(true);
    expect(chaves.get(ORGS[1] as string)?.ligada).toBe(false);
    expect(ins.length).toBeGreaterThan(1);
    expect(Math.max(...ins.map((c) => c.n))).toBeLessThanOrEqual(IDS_POR_CONSULTA);
  });

  it("350 empresas: os números vêm todos, com a sessão e os pedidos, nenhuma consulta com mais de 100 ids", async () => {
    const { admin, ins } = bancoFalso();
    const numeros = await numerosPeloApp(admin, ORGS);
    expect(numeros.size).toBe(EMPRESAS);
    const ultimo = numeros.get(ORGS[EMPRESAS - 1] as string)?.[0];
    expect(ultimo).toMatchObject({
      phoneNumberId: `pn-${EMPRESAS - 1}`,
      phoneNumber: `+553190000${String(EMPRESAS - 1).padStart(4, "0")}`,
    });
    expect(ultimo?.pedidos.map((p) => p.tipo)).toEqual(["contatos", "historico"]);
    for (const tabela of ["mia_coexistencia_conexoes", "mia_coexistencia_sincronizacoes", "channel_sessions"]) {
      expect(ins.some((c) => c.tabela === tabela)).toBe(true);
    }
    expect(Math.max(...ins.map((c) => c.n))).toBeLessThanOrEqual(IDS_POR_CONSULTA);
  });
});
