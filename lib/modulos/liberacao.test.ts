import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { modulosDaOrganizacao, moduloLiberado } from "@/lib/modulos/liberacao";

/**
 * FALHA DE LEITURA NÃO PODE VIRAR LIBERAÇÃO.
 *
 * A tentação, ao escrever isto, é devolver `true` quando o banco não responde —
 * "para não quebrar o cliente que pagou". O efeito é o oposto do pretendido:
 * libera o módulo para TODO MUNDO exatamente no minuto em que o banco oscila.
 * Num módulo que cobra por mensagem, esse minuto é dinheiro saindo.
 *
 * Recusar aparece na hora e se conserta. Liberar por engano não aparece em
 * lugar nenhum — e é por isso que estes dois casos existem.
 *
 *     npx vitest run lib/modulos/liberacao.test.ts
 */

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";

function db(resposta: { data: unknown; error: unknown }): SupabaseClient {
  const cadeia: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is"]) cadeia[m] = () => cadeia;
  cadeia.maybeSingle = async () => resposta;
  cadeia.then = (r: (v: unknown) => unknown) => r(resposta);
  return { from: () => cadeia } as unknown as SupabaseClient;
}

describe("a liberação por módulo", () => {
  it("linha viva libera", async () => {
    expect(await moduloLiberado(db({ data: { id: "x" }, error: null }), ORG, "disparador")).toBe(true);
  });

  it("sem linha, recusa — ausência é 'não contratado', não 'não se sabe'", async () => {
    expect(await moduloLiberado(db({ data: null, error: null }), ORG, "disparador")).toBe(false);
  });

  it("ERRO de banco recusa — nunca libera por não conseguir perguntar", async () => {
    expect(
      await moduloLiberado(db({ data: null, error: { message: "timeout" } }), ORG, "disparador"),
      "o banco oscilou e o módulo pago abriu para todo mundo — num módulo que cobra por mensagem, isso é dinheiro saindo sem contrato",
    ).toBe(false);
  });

  it("a lista também nasce VAZIA no erro, e não com tudo dentro", async () => {
    const s = await modulosDaOrganizacao(db({ data: null, error: { message: "timeout" } }), ORG);
    expect(s.size, "a falha de leitura virou um menu com tudo liberado").toBe(0);
  });

  it("a lista traz o que está vivo — e o que a INSTALAÇÃO libera", async () => {
    vi.stubEnv("MARCA_DA_ORGANIZACAO", "");
    const s = await modulosDaOrganizacao(db({ data: [{ modulo: "disparador" }], error: null }), ORG);
    // A tela de marca por empresa não se compra: entra na lista do menu quando
    // a instalação a libera (lib/branding/marca-da-organizacao-no-fork.ts).
    expect([...s]).toEqual(["disparador", "marca_da_organizacao"]);
    vi.unstubAllEnvs();
  });

  it("com a marca travada (a MIA no ar), a lista é só o contratado", async () => {
    vi.stubEnv("MARCA_DA_ORGANIZACAO", "travada");
    const s = await modulosDaOrganizacao(db({ data: [{ modulo: "disparador" }], error: null }), ORG);
    expect([...s]).toEqual(["disparador"]);
    vi.unstubAllEnvs();
  });
});
