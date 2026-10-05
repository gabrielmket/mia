/**
 * FORK MIA — os grupos do número de avisos, com o corpo que CADA motor do WAHA
 * devolve, passando pela cadeia inteira que a tela usa:
 *
 *     HTTP → WahaClient.listarGrupos → wahaAdapter.listGroups → lerGruposDoNumero
 *
 * Só o HTTP é dublê. Dublar o `listGroups` provaria o formato que o próprio
 * teste escreveu, que foi como a leitura da .55 (só aceitava LISTA) passou verde
 * e travou o seletor de grupo em produção — o NOWEB devolve um MAPA.
 *
 * O GOWS devolve as chaves do whatsmeow em PascalCase: o `JID` já era lido pelo
 * upstream, o `Name` não, e a tela listava os grupos pelo id cru — escolher o
 * grupo de cada empresa "pelo nome" virava adivinhar entre `120363…@g.us`.
 *
 *     npx vitest run lib/waha/client-grupos-motores.test.ts
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wahaAdapter } from "@/lib/channels/adapters/waha";
import { lerGruposDoNumero } from "@/lib/avisos/grupos-do-numero";

/** A fixture MEDIDA no WAHA 2026.7.2 (NOWEB), re-chaveada por id como o servidor devolve. */
const medidoNoweb = JSON.parse(
  readFileSync("lib/waha/__fixtures__/grupos-noweb-2026.7.2.json", "utf8"),
) as { groups: Array<{ id: string; subject: string }> };

const G1 = "120363000000000001@g.us";
const G2 = "120363000000000002@g.us";

const RESPOSTA: Record<"NOWEB" | "GOWS" | "WEBJS", unknown> = {
  NOWEB: {
    [G1]: { id: G1, subject: "Vita Odonto · Comercial", participants: [], addressingMode: "lid" },
    [G2]: { id: G2, subject: "Time Company · Interno", participants: [] },
  },
  GOWS: [
    {
      JID: G1,
      OwnerJID: "5511900000000@s.whatsapp.net",
      Name: "Vita Odonto · Comercial",
      NameSetAt: "2026-09-01T12:00:00Z",
      Topic: "",
      IsAnnounce: false,
      Participants: [{ JID: "5511900000000@s.whatsapp.net", IsAdmin: true }],
    },
    { JID: G2, Name: "Time Company · Interno", Participants: [] },
  ],
  WEBJS: [
    { id: { server: "g.us", user: "120363000000000001", _serialized: G1 }, name: "Vita Odonto · Comercial", isGroup: true },
    { id: { server: "g.us", user: "120363000000000002", _serialized: G2 }, name: "Time Company · Interno", isGroup: true },
  ],
};

function transporteResponde(corpo: unknown, status = 200) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => new Response(JSON.stringify(corpo), { status }));
}

beforeEach(() => {
  vi.stubEnv("WAHA_API_BASE_URL", "http://waha:3000");
  vi.stubEnv("WAHA_API_KEY", "chave-de-teste");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("grupos do número de avisos, motor por motor", () => {
  for (const motor of ["NOWEB", "GOWS", "WEBJS"] as const) {
    it(`⭐ ${motor}: a tela recebe os grupos PELO NOME`, async () => {
      const fetch = transporteResponde(RESPOSTA[motor]);
      const r = await lerGruposDoNumero(wahaAdapter, "org_ultra_sm");
      expect(r).toEqual({
        ok: true,
        grupos: [
          { id: G1, nome: "Vita Odonto · Comercial" },
          { id: G2, nome: "Time Company · Interno" },
        ],
      });
      expect(String(fetch.mock.calls[0]?.[0])).toBe("http://waha:3000/api/org_ultra_sm/groups");
    });
  }

  it("a fixture MEDIDA no NOWEB real sai inteira, com o assunto de cada grupo", async () => {
    transporteResponde(Object.fromEntries(medidoNoweb.groups.map((g) => [g.id, g])));
    const r = await lerGruposDoNumero(wahaAdapter, "s1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.grupos).toEqual(medidoNoweb.groups.map((g) => ({ id: g.id, nome: g.subject || g.id })));
  });

  it("sessão caída (422) é FALHA com motivo, nunca 'nenhum grupo'", async () => {
    transporteResponde({ message: "Session status is not as expected" }, 422);
    const r = await lerGruposDoNumero(wahaAdapter, "s1");
    expect(r).toEqual({ ok: false, motivo: "desconectado" });
  });
});
