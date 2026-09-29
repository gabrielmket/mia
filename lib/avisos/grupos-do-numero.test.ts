import { describe, expect, it } from "vitest";

import { gruposDoNumero } from "@/lib/avisos/grupos-do-numero";

/**
 * FORK MIA — a tela do número de avisos lê os grupos pelo `listGroups` do
 * upstream (ChannelGroup: `chatId`, `subject`). O contrato da tela continua o
 * nosso: `null` é falha, `[]` é "nenhum grupo", e o nome cai para o id quando o
 * grupo não tem assunto.
 */
describe("gruposDoNumero", () => {
  it("traduz o formato do upstream para o da tela", async () => {
    const r = await gruposDoNumero(
      {
        listGroups: async () => [
          { chatId: "120363000000000001@g.us", subject: "Time · Cliente A" },
          { chatId: "120363000000000002@g.us", subject: null },
        ],
      },
      "sessao",
    );
    expect(r).toEqual([
      { id: "120363000000000001@g.us", nome: "Time · Cliente A" },
      { id: "120363000000000002@g.us", nome: "120363000000000002@g.us" },
    ]);
  });

  it("⭐ o upstream LANÇA na falha; a tela recebe null, e não 'nenhum grupo'", async () => {
    const r = await gruposDoNumero(
      {
        listGroups: async () => {
          throw new Error("waha_groups_502");
        },
      },
      "sessao",
    );
    expect(r).toBeNull();
  });

  it("lista vazia continua sendo lista vazia (o controle)", async () => {
    expect(await gruposDoNumero({ listGroups: async () => [] }, "sessao")).toEqual([]);
  });

  it("canal que não lista grupos devolve null", async () => {
    expect(await gruposDoNumero({}, "sessao")).toBeNull();
  });
});
