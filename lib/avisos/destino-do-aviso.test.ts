import { describe, expect, it } from "vitest";

import {
  CHANNEL_PROVIDER_META,
  CHANNEL_PROVIDER_WAHA,
} from "@/lib/channels/capabilities";

import { destinoDoAviso, lerGrupoDeAvisos } from "./destino-do-aviso";

/**
 * O AVISO INTERNO TEM DUAS METADES, E CADA UMA FALTA DE UM JEITO.
 *
 * Sem NÚMERO, nenhum cliente recebe aviso — é a plataforma que precisa
 * conectar. Sem GRUPO, só aquele cliente fica mudo — é a configuração dele que
 * falta. As duas são "o time não foi avisado" para quem está de fora, e o
 * sistema não tem como pedir socorro se disser as duas com a mesma palavra:
 * quem lê o log vai procurar no lugar errado, e o aviso interno é justamente o
 * que ninguém repara faltando até um lead esfriar.
 *
 *     npx vitest run lib/avisos/destino-do-aviso.test.ts
 */

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";
const GRUPO = "120363405136320907@g.us";

const wahaOk = { provider: CHANNEL_PROVIDER_WAHA, waha_session_name: "plataforma_avisos" };

function adminCom(sessao: unknown, settings: unknown) {
  return {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: tabela === "channel_sessions" ? sessao : settings === null ? null : { settings },
            error: null,
          }),
        }),
      }),
    }),
  } as never;
}

describe("de onde sai o aviso e para onde vai", () => {
  it("junta o número da PLATAFORMA com o grupo DO CLIENTE", async () => {
    const d = await destinoDoAviso(adminCom(wahaOk, { grupo_de_avisos: { id: GRUPO, nome: "Comercial" } }), ORG);

    expect(d.ok, "o par que a régua usa todo dia não resolveu").toBe(true);
    if (!d.ok) return;
    expect(d.chatId).toBe(GRUPO);
    expect(d.nomeDoGrupo, "a tela mostraria o identificador cru no lugar do nome").toBe("Comercial");
  });

  it("diz SEM NÚMERO quando ninguém marcou a sessão de avisos", async () => {
    const d = await destinoDoAviso(adminCom(null, { grupo_de_avisos: { id: GRUPO, nome: "Comercial" } }), ORG);

    expect(d.ok).toBe(false);
    expect(
      d.ok ? null : d.motivo,
      "o motivo mandaria o operador conferir a configuração DO CLIENTE quando o que falta é o número da plataforma inteira",
    ).toBe("sem_numero_de_avisos");
  });

  it("diz SEM GRUPO quando é só este cliente que não foi configurado", async () => {
    const d = await destinoDoAviso(adminCom(wahaOk, {}), ORG);

    expect(d.ok).toBe(false);
    expect(
      d.ok ? null : d.motivo,
      "o motivo mandaria mexer no número da plataforma — que está de pé e avisando todos os outros clientes",
    ).toBe("sem_grupo_no_cliente");
  });

  it("RECUSA número da API oficial marcado como o de avisos", async () => {
    const meta = { provider: CHANNEL_PROVIDER_META, meta_phone_number_id: "123" };
    const d = await destinoDoAviso(adminCom(meta, { grupo_de_avisos: { id: GRUPO, nome: "Comercial" } }), ORG);

    expect(d.ok).toBe(false);
    expect(
      d.ok ? null : d.motivo,
      "a Meta não entrega em grupo: sem a recusa aqui, o erro chega como 4xx de provider e ninguém liga uma coisa à outra",
    ).toBe("numero_nao_entrega_em_grupo");
  });
});

describe("o grupo guardado no settings", () => {
  it("IGNORA um id que não é de grupo", () => {
    expect(
      lerGrupoDeAvisos({ grupo_de_avisos: { id: "5531999999999@c.us", nome: "Fulano" } }),
      "um telefone salvo no lugar do grupo faria o aviso interno — com resumo da qualificação — chegar a uma PESSOA",
    ).toBeNull();
  });

  it("cai no id quando o nome se perdeu, em vez de sumir com a configuração", () => {
    const g = lerGrupoDeAvisos({ grupo_de_avisos: { id: GRUPO } });
    expect(g?.id, "a configuração inteira foi descartada por falta de um rótulo").toBe(GRUPO);
    expect(g?.nome).toBe(GRUPO);
  });

  it("aguenta settings vazio, nulo e lixo", () => {
    expect(lerGrupoDeAvisos(null)).toBeNull();
    expect(lerGrupoDeAvisos({})).toBeNull();
    expect(lerGrupoDeAvisos({ grupo_de_avisos: "120363@g.us" })).toBeNull();
  });
});
