import { describe, expect, it } from "vitest";

import {
  CHANNEL_PROVIDER_META,
  PROVIDERS_QUE_ENTREGAM_EM_GRUPO,
} from "@/lib/channels/capabilities";
import { CHANNEL_SESSION_REF_COLUMNS, type ChannelSessionRef } from "@/lib/channels/session-ref";

import { destinoDoAviso } from "./destino-do-aviso";
import {
  escolherNumeroDoAviso,
  lerOrigemDoAviso,
  ORIGEM_PADRAO,
  type SessaoDaEmpresa,
} from "./origem-do-aviso";

/**
 * FORK MIA (.62) — O AVISO PELO NÚMERO DA PRÓPRIA EMPRESA.
 *
 * A empresa pode trocar o número da plataforma por um número que ela conectou.
 * O risco desta troca é o de sempre nesta casa: o degrade silencioso. Se o
 * número da empresa cai e o aviso passa a sair por outro número sem ninguém
 * saber, o time estranha o remetente; se ele cai e o aviso simplesmente para,
 * ninguém repara até um lead esfriar. Os dois casos têm de DIZER o que
 * aconteceu, e o segundo só vira o primeiro quando a empresa autorizou.
 *
 *     npx vitest run lib/avisos/origem-do-aviso.test.ts
 */

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";
const OUTRA_ORG = "dddddddd-0000-4000-8000-00000000000d";
const NUMERO_DA_EMPRESA = "eeeeeeee-0000-4000-8000-00000000000e";
const GRUPO = "120363000000000001@g.us";

/** Um canal que entrega em grupo, sem nomear qual: a MATRIZ decide. */
function sessaoQueEntregaEmGrupo(ref: string): ChannelSessionRef {
  return {
    ...Object.fromEntries(CHANNEL_SESSION_REF_COLUMNS.split(",").map((c) => [c.trim(), ref])),
    provider: PROVIDERS_QUE_ENTREGAM_EM_GRUPO[0],
  } as unknown as ChannelSessionRef;
}

const DA_PLATAFORMA = sessaoQueEntregaEmGrupo("sessao-da-plataforma");

function daEmpresa(extra: Partial<SessaoDaEmpresa> = {}): SessaoDaEmpresa {
  return {
    ...sessaoQueEntregaEmGrupo("sessao-da-empresa"),
    id: NUMERO_DA_EMPRESA,
    organization_id: ORG,
    status: "WORKING",
    archived_at: null,
    ...extra,
  } as SessaoDaEmpresa;
}

const EMPRESA_SEM_RESERVA = {
  modo: "empresa" as const,
  channel_session_id: NUMERO_DA_EMPRESA,
  reserva_da_plataforma: false,
};
const EMPRESA_COM_RESERVA = { ...EMPRESA_SEM_RESERVA, reserva_da_plataforma: true };

describe("a escolha guardada no settings", () => {
  it("sem escolha é o número da plataforma — o comportamento de sempre", () => {
    expect(lerOrigemDoAviso(null)).toEqual(ORIGEM_PADRAO);
    expect(lerOrigemDoAviso({})).toEqual(ORIGEM_PADRAO);
    expect(lerOrigemDoAviso({ numero_de_avisos: "lixo" })).toEqual(ORIGEM_PADRAO);
    expect(lerOrigemDoAviso({ numero_de_avisos: { modo: "plataforma" } })).toEqual(ORIGEM_PADRAO);
  });

  it("a reserva vem DESLIGADA quando não foi dita", () => {
    expect(
      lerOrigemDoAviso({ numero_de_avisos: { modo: "empresa", channel_session_id: NUMERO_DA_EMPRESA } }),
    ).toEqual(EMPRESA_SEM_RESERVA);
  });

  it("id estragado no modo empresa NÃO vira plataforma calada: vira 'o número sumiu'", () => {
    const origem = lerOrigemDoAviso({ numero_de_avisos: { modo: "empresa", channel_session_id: "x" } });
    expect(origem).toEqual({ modo: "empresa", channel_session_id: null, reserva_da_plataforma: false });

    const n = escolherNumeroDoAviso({ organizationId: ORG, origem, daEmpresa: null, daPlataforma: DA_PLATAFORMA });
    expect(n.ok, "a empresa pediu o número dela, e o aviso saiu pelo da plataforma sem ninguém saber").toBe(false);
    expect(n.ok ? null : n.motivo).toBe("numero_da_empresa_sumiu");
  });
});

describe("por qual número o aviso sai", () => {
  it("modo plataforma: o número da plataforma, como sempre", () => {
    const n = escolherNumeroDoAviso({
      organizationId: ORG,
      origem: ORIGEM_PADRAO,
      daEmpresa: null,
      daPlataforma: DA_PLATAFORMA,
    });
    expect(n).toMatchObject({ ok: true, via: "plataforma", desvio: null, sessao: DA_PLATAFORMA });
  });

  it("⭐ modo empresa com o número de pé: sai pelo da EMPRESA", () => {
    const n = escolherNumeroDoAviso({
      organizationId: ORG,
      origem: EMPRESA_COM_RESERVA,
      daEmpresa: daEmpresa(),
      daPlataforma: DA_PLATAFORMA,
    });
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    expect(n.via).toBe("empresa");
    expect((n.sessao as SessaoDaEmpresa).id).toBe(NUMERO_DA_EMPRESA);
  });

  it("⭐ o número da empresa CAIU e a reserva está desligada: NÃO troca, e diz por quê", () => {
    const n = escolherNumeroDoAviso({
      organizationId: ORG,
      origem: EMPRESA_SEM_RESERVA,
      daEmpresa: daEmpresa({ status: "FAILED" }),
      daPlataforma: DA_PLATAFORMA,
    });
    expect(
      n.ok,
      "o aviso trocou de número calado: a empresa não autorizou a reserva, e o time passou a receber de outro remetente",
    ).toBe(false);
    if (n.ok) return;
    expect(n.motivo).toBe("numero_da_empresa_fora_do_ar");
    expect(n.reserva, "a falha não diz que a reserva estava desligada — a tela não teria o que explicar").toBe(
      "desligada",
    );
  });

  it("⭐ o número da empresa CAIU e a reserva está ligada: sai pela plataforma, COM o desvio dito", () => {
    const n = escolherNumeroDoAviso({
      organizationId: ORG,
      origem: EMPRESA_COM_RESERVA,
      daEmpresa: daEmpresa({ status: "SCAN_QR_CODE" }),
      daPlataforma: DA_PLATAFORMA,
    });
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    expect(n.via, "saiu pela plataforma e a decisão não disse que era reserva").toBe("reserva");
    expect(n.desvio, "o desvio não carrega o motivo: o histórico diria só 'enviado'").toBe(
      "numero_da_empresa_fora_do_ar",
    );
    expect(n.sessao).toBe(DA_PLATAFORMA);
  });

  it("reserva ligada e SEM número de plataforma: não sai, e a reserva aparece indisponível", () => {
    const n = escolherNumeroDoAviso({
      organizationId: ORG,
      origem: EMPRESA_COM_RESERVA,
      daEmpresa: daEmpresa({ status: "STOPPED" }),
      daPlataforma: null,
    });
    expect(n).toEqual({ ok: false, motivo: "numero_da_empresa_fora_do_ar", reserva: "indisponivel" });
  });

  it("número arquivado ou de OUTRA empresa é tratado como sumido — nunca usado", () => {
    for (const sessao of [daEmpresa({ archived_at: "2026-09-29T10:00:00Z" }), daEmpresa({ organization_id: OUTRA_ORG })]) {
      const n = escolherNumeroDoAviso({
        organizationId: ORG,
        origem: EMPRESA_SEM_RESERVA,
        daEmpresa: sessao,
        daPlataforma: DA_PLATAFORMA,
      });
      expect(n.ok, "o aviso — com nome do lead e resumo — sairia por um número que não é deste cliente").toBe(false);
      expect(n.ok ? null : n.motivo).toBe("numero_da_empresa_sumiu");
    }
  });

  it("número oficial (não entrega em grupo) é recusado pela CAPACIDADE", () => {
    const oficial = {
      id: NUMERO_DA_EMPRESA,
      organization_id: ORG,
      status: "WORKING",
      provider: CHANNEL_PROVIDER_META,
      meta_phone_number_id: "123",
    } as unknown as SessaoDaEmpresa;
    const n = escolherNumeroDoAviso({
      organizationId: ORG,
      origem: EMPRESA_SEM_RESERVA,
      daEmpresa: oficial,
      daPlataforma: DA_PLATAFORMA,
    });
    expect(n.ok ? null : n.motivo).toBe("numero_da_empresa_nao_entrega_em_grupo");
  });
});

/**
 * O destino inteiro, com um Supabase de mentira que responde cada consulta pelo
 * filtro: `e_numero_de_avisos` é o número da plataforma, `id` é o da empresa.
 */
function adminCom(b: { settings: unknown; plataforma: unknown; empresa: unknown }) {
  return {
    from(tabela: string) {
      const filtros: string[] = [];
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (coluna: string) => {
        filtros.push(coluna);
        return q;
      };
      q.maybeSingle = async () => {
        if (tabela === "organizations") return { data: { settings: b.settings }, error: null };
        if (filtros.includes("e_numero_de_avisos")) return { data: b.plataforma, error: null };
        if (filtros.includes("id")) return { data: b.empresa, error: null };
        return { data: null, error: null };
      };
      return q;
    },
  } as never;
}

describe("o destino do aviso com o número da empresa", () => {
  const comGrupo = (origem: unknown) => ({
    grupo_de_avisos: { id: GRUPO, nome: "Comercial" },
    numero_de_avisos: origem,
  });

  it("⭐ junta o número DA EMPRESA com o grupo dela", async () => {
    const d = await destinoDoAviso(
      adminCom({ settings: comGrupo(EMPRESA_SEM_RESERVA), plataforma: DA_PLATAFORMA, empresa: daEmpresa() }),
      ORG,
    );
    expect(d).toMatchObject({ ok: true, chatId: GRUPO, via: "empresa", desvio: null });
  });

  it("⭐ número da empresa caído, sem reserva: o destino recusa com o motivo e a reserva", async () => {
    const d = await destinoDoAviso(
      adminCom({
        settings: comGrupo(EMPRESA_SEM_RESERVA),
        plataforma: DA_PLATAFORMA,
        empresa: daEmpresa({ status: "FAILED" }),
      }),
      ORG,
    );
    expect(d).toEqual({ ok: false, motivo: "numero_da_empresa_fora_do_ar", reserva: "desligada" });
  });

  it("número da empresa caído, com reserva: o destino é a plataforma, e diz que é reserva", async () => {
    const d = await destinoDoAviso(
      adminCom({
        settings: comGrupo(EMPRESA_COM_RESERVA),
        plataforma: DA_PLATAFORMA,
        empresa: daEmpresa({ status: "FAILED" }),
      }),
      ORG,
    );
    expect(d).toMatchObject({ ok: true, chatId: GRUPO, via: "reserva", desvio: "numero_da_empresa_fora_do_ar" });
    expect(d.ok ? d.sessao : null).toBe(DA_PLATAFORMA);
  });

  it("sem escolha nenhuma, nada muda: plataforma, sem desvio", async () => {
    const d = await destinoDoAviso(
      adminCom({ settings: { grupo_de_avisos: { id: GRUPO, nome: "Comercial" } }, plataforma: DA_PLATAFORMA, empresa: null }),
      ORG,
    );
    expect(d).toMatchObject({ ok: true, via: "plataforma", desvio: null, sessao: DA_PLATAFORMA });
  });
});
