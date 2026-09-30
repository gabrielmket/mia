import { describe, expect, it } from "vitest";

import {
  capabilitiesOf,
  PROVIDERS_DE_MENSAGEM,
  PROVIDERS_SEM_MENSAGEM,
} from "@/lib/channels/capabilities";

import {
  canaisLiberados,
  decidirAcesso,
  ehNumeroPorQr,
  moduloExigidoPeloRecurso,
  RECURSOS_DO_QR,
} from "./canais-do-disparo";

/**
 * FORK MIA — a porta do Broadcast unificado (docs/fork/broadcast-unificado.md).
 *
 * As duas posições do interruptor `QR_EXIGE_O_MODULO` são medidas aqui, e não
 * só a ligada: a proposta ainda vai ao dono do produto, e virar a chave não
 * pode ser o dia de descobrir que a outra posição nunca funcionou.
 *
 *     npx vitest run lib/broadcast/canais-do-disparo.test.ts
 */

describe("quem usa cada caminho do Broadcast", () => {
  it("com o QR atrás do módulo, quem não contratou não usa nenhum dos dois", () => {
    expect(canaisLiberados(false, true)).toEqual({ oficial: false, qr: false });
    expect(canaisLiberados(true, true)).toEqual({ oficial: true, qr: true });
  });

  it("com o QR livre, o oficial continua exigindo o módulo — é ele que cobra", () => {
    expect(canaisLiberados(false, false)).toEqual({ oficial: false, qr: true });
    expect(canaisLiberados(true, false)).toEqual({ oficial: true, qr: true });
  });

  it("a trava pelo recurso só existe com o interruptor ligado, e só para os recursos do QR", () => {
    for (const r of RECURSOS_DO_QR) {
      expect(moduloExigidoPeloRecurso(r, true)).toBe("disparador");
      expect(moduloExigidoPeloRecurso(r, false)).toBeNull();
    }
    // Recurso qualquer nunca cai na trava: acrescentar módulo a uma rota que os
    // clientes já usam seria um apagão silencioso.
    expect(moduloExigidoPeloRecurso("leads", true)).toBeNull();
    expect(moduloExigidoPeloRecurso(undefined, true)).toBeNull();
    // O oficial já confere o módulo dentro das próprias rotas; conferir de novo
    // por aqui seria uma ida a mais ao banco em toda chamada.
    expect(moduloExigidoPeloRecurso("broadcasts", true)).toBeNull();
  });
});

describe("o que a tela do Broadcast mostra", () => {
  const base = { temOrganizacao: true, papelSuficiente: true, contratado: true, qrExigeOModulo: true };

  it("papel abaixo de manager ouve 'é de quem gerencia', antes de qualquer conversa de módulo", () => {
    expect(decidirAcesso({ ...base, papelSuficiente: false, contratado: false }).estado).toBe("sem_papel");
  });

  it("sem o módulo e com o QR atrás dele: 'não contratado'", () => {
    expect(decidirAcesso({ ...base, contratado: false }).estado).toBe("nao_contratado");
  });

  it("sem o módulo e com o QR livre: abre, só com o QR", () => {
    expect(decidirAcesso({ ...base, contratado: false, qrExigeOModulo: false })).toEqual({
      estado: "liberado",
      canais: { oficial: false, qr: true },
    });
  });

  it("quando abre, o caminho por QR está SEMPRE liberado — a lista conta com isso", () => {
    for (const contratado of [true, false]) {
      for (const qrExigeOModulo of [true, false]) {
        const a = decidirAcesso({ ...base, contratado, qrExigeOModulo });
        if (a.estado === "liberado") expect(a.canais.qr).toBe(true);
      }
    }
  });

  it("sem organização ativa não há o que mostrar", () => {
    expect(decidirAcesso({ ...base, temOrganizacao: false }).estado).toBe("sem_organizacao");
  });
});

describe("qual número é 'por QR'", () => {
  // Pela MATRIZ de capacidades, nunca pelo nome do provedor (a catraca
  // `lint:channels` reprova o nome até em teste): um canal novo entra ou fica de
  // fora pela linha dele na matriz.
  it("é quem manda texto livre a qualquer hora E corre risco de bloqueio", () => {
    const porQr = PROVIDERS_DE_MENSAGEM.filter((p) => ehNumeroPorQr(p));
    const outros = PROVIDERS_DE_MENSAGEM.filter((p) => !ehNumeroPorQr(p));
    // Controle de vacuidade: os dois lados existem hoje.
    expect(porQr.length).toBeGreaterThan(0);
    expect(outros.length).toBeGreaterThan(0);
    for (const p of porQr) {
      expect(capabilitiesOf(p)).toMatchObject({ freeformOutsideWindow: true, banRisk: true });
    }
    // O que exige modelo aprovado nunca é "por QR": no formulário das Campanhas
    // ele receberia texto livre e a Meta recusaria depois, pelo webhook.
    for (const p of outros) {
      const c = capabilitiesOf(p);
      expect(c.freeformOutsideWindow && c.banRisk).toBe(false);
    }
  });

  it("linha de voz e provedor desconhecido ficam fora, sem lançar", () => {
    for (const p of PROVIDERS_SEM_MENSAGEM) expect(ehNumeroPorQr(p)).toBe(false);
    expect(ehNumeroPorQr("provedor_do_futuro")).toBe(false);
    expect(ehNumeroPorQr(null)).toBe(false);
    expect(ehNumeroPorQr(undefined)).toBe(false);
  });
});
