import { describe, expect, it } from "vitest";

import { motivoDaFalhaAoListarGrupos } from "./motivo-da-falha-de-grupos";

/**
 * FORK MIA — o motivo que a tela do número de avisos mostra quando a lista de
 * grupos não vem. Cada código leva a pessoa a uma AÇÃO diferente; juntar todos
 * em "não consegui perguntar" foi o estado em produção em 29/09/2026.
 */
describe("motivoDaFalhaAoListarGrupos", () => {
  it("sessão conectada? 422 = desconectado; 404 = a sessão sumiu", () => {
    expect(motivoDaFalhaAoListarGrupos(new Error("waha_groups_422"))).toBe("desconectado");
    expect(motivoDaFalhaAoListarGrupos(new Error("waha_groups_404"))).toBe("sessao_inexistente");
  });

  it("chave recusada é OUTRA ação — ler o QR não resolve", () => {
    expect(motivoDaFalhaAoListarGrupos(new Error("waha_groups_401"))).toBe("chave_recusada");
    expect(motivoDaFalhaAoListarGrupos(new Error("waha_groups_403"))).toBe("chave_recusada");
  });

  it("o teto de tempo e o transporte ausente têm código próprio", () => {
    expect(
      motivoDaFalhaAoListarGrupos(
        new Error("waha_timeout: o WAHA não respondeu em 15000ms (http://waha:3000/api/s1/groups)"),
      ),
    ).toBe("sem_resposta");
    expect(motivoDaFalhaAoListarGrupos(new Error("waha_not_configured"))).toBe("sem_transporte");
  });

  it("código desconhecido é 'recusado'; texto desconhecido, 'desconhecido'", () => {
    expect(motivoDaFalhaAoListarGrupos(new Error("waha_groups_500"))).toBe("recusado");
    expect(motivoDaFalhaAoListarGrupos(new Error("ECONNRESET 10.0.0.3"))).toBe("desconhecido");
    expect(motivoDaFalhaAoListarGrupos("x")).toBe("desconhecido");
    expect(motivoDaFalhaAoListarGrupos(undefined)).toBe("desconhecido");
  });
});
