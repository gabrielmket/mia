/**
 * FORK MIA — os cinco gatilhos de automação de documentos e obrigações.
 *
 * O que este arquivo guarda: a configuração que a regra aceita, em que dia cada
 * gatilho cai, a janela (com a tolerância de quem perdeu a hora e os pisos que
 * impedem aviso do passado) e que os cinco estão ligados ao motor de
 * automações que já existe: mesma lista de gatilhos, mesma entidade, mesma
 * frase na tela.
 */
import { describe, expect, it } from "vitest";

import { TRIGGER_LABELS } from "@/app/app/webhooks/_components/labels";
import {
  configDoGatilhoDeObrigacao,
  DIAS_SUGERIDOS,
  disparoDoRelogio,
  ehGatilhoDeObrigacao,
  ENTIDADE_DA_OBRIGACAO,
  EXPLICACAO_DOS_GATILHOS_DE_OBRIGACAO,
  GATILHO_ATIVIDADE_CHEGANDO,
  GATILHO_DOCUMENTO_NAO_ENVIADO,
  GATILHO_DOCUMENTO_RECEBIDO,
  GATILHO_DOCUMENTO_VENCENDO,
  GATILHO_DOCUMENTO_VENCIDO,
  GATILHOS_DE_OBRIGACAO,
  GATILHOS_DO_RELOGIO,
  gatilhoPedeDias,
  MARCACOES_DA_OBRIGACAO,
  passaNoFiltroDeTipo,
  ROTULOS_DOS_GATILHOS_DE_OBRIGACAO,
  TOLERANCIA_EM_DIAS,
  venceNaJanela,
} from "@/lib/obrigacoes/gatilhos";
import type { ItemParaSituacao } from "@/lib/obrigacoes/tipos";
import {
  createAutomationRuleSchema,
  ENTIDADE_ESPERADA_POR_GATILHO,
  TRIGGER_EVENTS,
  updateAutomationRuleSchema,
} from "@/lib/schemas/webhooks";

function documento(datas: Partial<ItemParaSituacao> = {}): ItemParaSituacao {
  return {
    categoria: "documento",
    recorrencia: "anual",
    recorrencia_meses: null,
    validade_meses: 12,
    avisos_dias: [30, 15, 7],
    dias_sem_resposta: 5,
    pedido_em: null,
    prazo_em: null,
    cobrado_em: null,
    recebido_em: null,
    valido_ate: null,
    renovado_em: null,
    proxima_em: null,
    feita_em: null,
    ...datas,
  };
}

const atividade = (datas: Partial<ItemParaSituacao> = {}) =>
  documento({ categoria: "atividade", recorrencia: "mensal", validade_meses: 0, avisos_dias: [5, 2], ...datas });

describe("os cinco gatilhos estão ligados ao motor de automações", () => {
  it("são cinco, e quatro nascem do relógio", () => {
    expect(GATILHOS_DE_OBRIGACAO).toEqual([
      "obrigacao.documento_vencendo",
      "obrigacao.documento_vencido",
      "obrigacao.documento_nao_enviado",
      "obrigacao.documento_recebido",
      "obrigacao.atividade_chegando",
    ]);
    expect(GATILHOS_DO_RELOGIO).toHaveLength(4);
    expect(GATILHOS_DO_RELOGIO).not.toContain(GATILHO_DOCUMENTO_RECEBIDO);
  });

  it("o motor reconhece os cinco, com o próprio item como entidade", () => {
    for (const gatilho of GATILHOS_DE_OBRIGACAO) {
      expect(TRIGGER_EVENTS as readonly string[], gatilho).toContain(gatilho);
      expect(ENTIDADE_ESPERADA_POR_GATILHO[gatilho]).toBe(ENTIDADE_DA_OBRIGACAO);
      expect(ehGatilhoDeObrigacao(gatilho)).toBe(true);
    }
    expect(ehGatilhoDeObrigacao("lead.created")).toBe(false);
    expect(ehGatilhoDeObrigacao(null)).toBe(false);
  });

  it("a frase do seletor de gatilhos é a do domínio, palavra por palavra", () => {
    // A tabela do upstream leva as frases literais (para a cerca de espanhol
    // alcançar cada uma). Se uma mudar só de um lado, a tela e o MCP passam a
    // dar nomes diferentes ao mesmo gatilho.
    for (const gatilho of GATILHOS_DE_OBRIGACAO) {
      expect(TRIGGER_LABELS[gatilho]).toBe(ROTULOS_DOS_GATILHOS_DE_OBRIGACAO[gatilho]);
      expect(EXPLICACAO_DOS_GATILHOS_DE_OBRIGACAO[gatilho].length).toBeGreaterThan(20);
    }
  });

  it("as frases de tela não usam travessão", () => {
    const frases = [
      ...Object.values(ROTULOS_DOS_GATILHOS_DE_OBRIGACAO),
      ...Object.values(EXPLICACAO_DOS_GATILHOS_DE_OBRIGACAO),
      ...MARCACOES_DA_OBRIGACAO.map((m) => m.significa),
    ];
    for (const frase of frases) expect(frase).not.toMatch(/[—–]/);
  });
});

describe("a configuração da regra", () => {
  it("três gatilhos pedem o X; vencido e recebido não", () => {
    expect(gatilhoPedeDias(GATILHO_DOCUMENTO_VENCENDO)).toBe(true);
    expect(gatilhoPedeDias(GATILHO_DOCUMENTO_NAO_ENVIADO)).toBe(true);
    expect(gatilhoPedeDias(GATILHO_ATIVIDADE_CHEGANDO)).toBe(true);
    expect(gatilhoPedeDias(GATILHO_DOCUMENTO_VENCIDO)).toBe(false);
    expect(gatilhoPedeDias(GATILHO_DOCUMENTO_RECEBIDO)).toBe(false);
    expect(DIAS_SUGERIDOS[GATILHO_DOCUMENTO_VENCENDO]).toBe(30);
    expect(DIAS_SUGERIDOS[GATILHO_DOCUMENTO_NAO_ENVIADO]).toBe(5);
    expect(DIAS_SUGERIDOS[GATILHO_ATIVIDADE_CHEGANDO]).toBe(15);
  });

  it("lê os dias e o filtro por tipo", () => {
    expect(configDoGatilhoDeObrigacao(GATILHO_DOCUMENTO_VENCENDO, { dias: 30, tipo: " Alvará de funcionamento " })).toEqual({
      dias: 30,
      tipo: "Alvará de funcionamento",
    });
    expect(configDoGatilhoDeObrigacao(GATILHO_DOCUMENTO_VENCENDO, { dias: 30 })).toEqual({ dias: 30, tipo: null });
    expect(configDoGatilhoDeObrigacao(GATILHO_DOCUMENTO_VENCIDO, undefined)).toEqual({ dias: null, tipo: null });
    expect(configDoGatilhoDeObrigacao(GATILHO_DOCUMENTO_RECEBIDO, { tipo: "CNH" })).toEqual({ dias: null, tipo: "CNH" });
  });

  it("recusa o que nunca dispararia, sem estourar", () => {
    for (const torta of [undefined, null, {}, [], "30", { dias: "30" }, { dias: 0 }, { dias: -5 }, { dias: 1.5 }, { dias: 3651 }]) {
      expect(configDoGatilhoDeObrigacao(GATILHO_DOCUMENTO_VENCENDO, torta), JSON.stringify(torta)).toBeNull();
    }
    expect(configDoGatilhoDeObrigacao("lead.created", { dias: 30 })).toBeNull();
  });

  it("o filtro por tipo compara o nome como uma pessoa compara", () => {
    expect(passaNoFiltroDeTipo({ nome: "Alvará de funcionamento" }, null)).toBe(true);
    expect(passaNoFiltroDeTipo({ nome: "Alvará de funcionamento" }, "alvara de  funcionamento")).toBe(true);
    expect(passaNoFiltroDeTipo({ nome: "Licença sanitária" }, "Alvará de funcionamento")).toBe(false);
  });

  const regra = (trigger_event: string, trigger_config?: Record<string, unknown>) => ({
    name: "Alvará vencendo",
    trigger_event,
    actions: [{ type: "add_tag", config: { tags: ["renovar"] } }],
    ...(trigger_config ? { trigger_config } : {}),
  });

  it("a rota de criar regra aceita os cinco gatilhos", () => {
    expect(createAutomationRuleSchema.safeParse(regra(GATILHO_DOCUMENTO_VENCENDO, { dias: 30 })).success).toBe(true);
    expect(createAutomationRuleSchema.safeParse(regra(GATILHO_DOCUMENTO_NAO_ENVIADO, { dias: 5 })).success).toBe(true);
    expect(createAutomationRuleSchema.safeParse(regra(GATILHO_ATIVIDADE_CHEGANDO, { dias: 45, tipo: "Renovação anual do contrato" })).success).toBe(true);
    expect(createAutomationRuleSchema.safeParse(regra(GATILHO_DOCUMENTO_VENCIDO)).success).toBe(true);
    expect(createAutomationRuleSchema.safeParse(regra(GATILHO_DOCUMENTO_RECEBIDO)).success).toBe(true);
  });

  it("a rota recusa, na porta, o gatilho de X dias sem o X", () => {
    const semDias = createAutomationRuleSchema.safeParse(regra(GATILHO_DOCUMENTO_VENCENDO));
    expect(semDias.success).toBe(false);
    if (!semDias.success) {
      expect(semDias.error.issues[0]?.path).toEqual(["trigger_config"]);
      expect(semDias.error.issues[0]?.message).toBe("Diga com quantos dias a regra dispara (de 1 a 3650).");
    }
    expect(createAutomationRuleSchema.safeParse(regra(GATILHO_DOCUMENTO_NAO_ENVIADO, { dias: 0 })).success).toBe(false);
    expect(
      updateAutomationRuleSchema.safeParse({ trigger_event: GATILHO_ATIVIDADE_CHEGANDO, trigger_config: { dias: "15" } }).success,
    ).toBe(false);
  });
});

describe("em que dia cada gatilho cai", () => {
  it("documento vencendo: X dias antes do válido até", () => {
    const item = documento({ recebido_em: "2025-10-14", valido_ate: "2026-10-13" });
    expect(disparoDoRelogio(item, GATILHO_DOCUMENTO_VENCENDO, { dias: 30, tipo: null })).toEqual({
      ancora: "2026-10-13",
      dia_do_disparo: "2026-09-13",
    });
  });

  it("documento vencido: no dia seguinte ao vencimento", () => {
    const item = documento({ valido_ate: "2026-09-28" });
    expect(disparoDoRelogio(item, GATILHO_DOCUMENTO_VENCIDO, { dias: null, tipo: null })).toEqual({
      ancora: "2026-09-28",
      dia_do_disparo: "2026-09-29",
    });
  });

  it("documento não enviado: X dias depois do pedido, só enquanto o pedido está em aberto", () => {
    const pedido = documento({ pedido_em: "2026-09-26" });
    expect(disparoDoRelogio(pedido, GATILHO_DOCUMENTO_NAO_ENVIADO, { dias: 5, tipo: null })).toEqual({
      ancora: "2026-09-26",
      dia_do_disparo: "2026-10-01",
    });
    const chegou = documento({ pedido_em: "2026-09-26", recebido_em: "2026-09-28" });
    expect(disparoDoRelogio(chegou, GATILHO_DOCUMENTO_NAO_ENVIADO, { dias: 5, tipo: null })).toBeNull();
    expect(disparoDoRelogio(documento(), GATILHO_DOCUMENTO_NAO_ENVIADO, { dias: 5, tipo: null })).toBeNull();
  });

  it("atividade chegando: X dias antes da próxima data", () => {
    const item = atividade({ proxima_em: "2026-11-15" });
    expect(disparoDoRelogio(item, GATILHO_ATIVIDADE_CHEGANDO, { dias: 45, tipo: null })).toEqual({
      ancora: "2026-11-15",
      dia_do_disparo: "2026-10-01",
    });
  });

  it("documento sem validade não vence, e gatilho de documento não pega atividade (nem o contrário)", () => {
    expect(disparoDoRelogio(documento({ recebido_em: "2026-09-23" }), GATILHO_DOCUMENTO_VENCENDO, { dias: 30, tipo: null })).toBeNull();
    expect(disparoDoRelogio(documento({ recebido_em: "2026-09-23" }), GATILHO_DOCUMENTO_VENCIDO, { dias: null, tipo: null })).toBeNull();
    expect(disparoDoRelogio(atividade({ proxima_em: "2026-11-15" }), GATILHO_DOCUMENTO_VENCENDO, { dias: 30, tipo: null })).toBeNull();
    expect(disparoDoRelogio(documento({ valido_ate: "2026-11-15" }), GATILHO_ATIVIDADE_CHEGANDO, { dias: 15, tipo: null })).toBeNull();
    expect(disparoDoRelogio(atividade({ recorrencia: "unica" }), GATILHO_ATIVIDADE_CHEGANDO, { dias: 15, tipo: null })).toBeNull();
  });

  it("o recebimento não é do relógio", () => {
    expect(disparoDoRelogio(documento({ valido_ate: "2026-11-15" }), GATILHO_DOCUMENTO_RECEBIDO, { dias: null, tipo: null })).toBeNull();
  });

  it("renovou, a data medida muda: o aviso volta a valer para a validade nova", () => {
    const antes = disparoDoRelogio(documento({ valido_ate: "2026-10-13" }), GATILHO_DOCUMENTO_VENCENDO, { dias: 30, tipo: null });
    const depois = disparoDoRelogio(documento({ valido_ate: "2027-10-13" }), GATILHO_DOCUMENTO_VENCENDO, { dias: 30, tipo: null });
    expect(antes?.ancora).not.toBe(depois?.ancora);
  });
});

describe("a janela do disparo", () => {
  it("dispara no dia, e recupera quem perdeu a hora em até dois dias", () => {
    expect(TOLERANCIA_EM_DIAS).toBe(2);
    expect(venceNaJanela("2026-10-01", "2026-09-30", [])).toBe(false);
    expect(venceNaJanela("2026-10-01", "2026-10-01", [])).toBe(true);
    expect(venceNaJanela("2026-10-01", "2026-10-02", [])).toBe(true);
    expect(venceNaJanela("2026-10-01", "2026-10-03", [])).toBe(true);
    expect(venceNaJanela("2026-10-01", "2026-10-04", [])).toBe(false);
  });

  it("não manda aviso do passado: item migrado de planilha e regra ligada depois não disparam o que já devia ter saído", () => {
    // O dia do disparo foi 29/09; o item entrou no sistema em 01/10.
    expect(venceNaJanela("2026-09-29", "2026-10-01", ["2026-10-01"])).toBe(false);
    // A regra foi ligada em 30/09: o disparo de 29/09 ficou para trás.
    expect(venceNaJanela("2026-09-29", "2026-10-01", ["2026-09-20", "2026-09-30"])).toBe(false);
    // Item e regra já existiam no dia do disparo.
    expect(venceNaJanela("2026-09-29", "2026-10-01", ["2026-09-20", "2026-09-29"])).toBe(true);
    // Piso vazio não segura nada.
    expect(venceNaJanela("2026-09-29", "2026-10-01", [null, undefined])).toBe(true);
  });

  it("data torta não dispara", () => {
    expect(venceNaJanela("2026-02-30", "2026-03-01", [])).toBe(false);
  });
});
