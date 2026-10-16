/**
 * FORK MIA (.81) — o designer de automações do upstream (v1.83,
 * `app/app/webhooks/automacoes/[id]`, `lib/automation/desenho-da-regra.ts`)
 * conhece o que é só do fork.
 *
 * O designer não tem régua própria: converte a regra gravada em caixas e volta
 * no corpo que a API recebe, e o teste dele (`desenho-da-regra.test.ts`) prova
 * a ida e volta das regras DO UPSTREAM. Aqui, a mesma prova sobre as formas
 * que só o fork grava: os gatilhos de obrigação (com o X e o tipo no
 * `trigger_config`), o nome antigo de "horário marcado" (`appointment.booked`),
 * o aviso no grupo (`notify_group`, nos dois formatos) e o "abrir um card novo
 * aqui" do criar/mover (`quando_em_outro_funil`). Abrir e salvar sem mexer não
 * pode mudar uma automação que roda sozinha.
 */
import { describe, expect, it } from "vitest";

import { createAutomationRuleSchema, GATILHOS_OFERECIDOS } from "@/lib/schemas/webhooks";
import { corpoDoDesenho, desenhoDaRegra, validarDesenho, type RegraGravada } from "@/lib/automation/desenho-da-regra";

const U = (n: number) => `${String(n).repeat(8).slice(0, 8)}-2222-4222-8222-222222222222`;
const FUNIL = U(1);
const ETAPA = U(2);
const CANAL = U(3);

const AVISO_NO_GRUPO = { type: "notify_group", config: { template: "Documento de {{contact.name}} vencendo" } };
const AVISO_NO_GRUPO_COM_DESTINO = {
  type: "notify_group",
  config: { channel_session_id: CANAL, chat_id: "120363000000000000@g.us", template: "Lead novo" },
};
const NOVO_CARD = {
  type: "create_or_move_lead",
  config: { pipeline_id: FUNIL, stage_id: ETAPA, quando_em_outro_funil: "abrir_novo_card" },
};

const REGRAS: Array<[string, RegraGravada]> = [
  [
    "documento vencendo: X dias e tipo",
    { trigger_event: "obrigacao.documento_vencendo", trigger_config: { dias: 30, tipo: "Alvará" }, conditions: [], actions: [AVISO_NO_GRUPO] },
  ],
  [
    "documento não enviado: só o X",
    { trigger_event: "obrigacao.documento_nao_enviado", trigger_config: { dias: 5 }, conditions: [], actions: [AVISO_NO_GRUPO] },
  ],
  [
    "documento recebido: sem X, com condição de nome",
    {
      trigger_event: "obrigacao.documento_recebido",
      trigger_config: {},
      conditions: [{ field: "obrigacao.nome", op: "contains", value: "Contrato" }],
      actions: [AVISO_NO_GRUPO],
    },
  ],
  [
    "o nome antigo de horário marcado, com o aviso no grupo de destino escrito",
    { trigger_event: "appointment.booked", trigger_config: {}, conditions: [], actions: [AVISO_NO_GRUPO_COM_DESTINO] },
  ],
  [
    "a passagem de bastão: abrir um card novo no outro funil",
    { trigger_event: "lead.stage_changed", trigger_config: {}, conditions: [], actions: [NOVO_CARD] },
  ],
];

function oQueAApiGrava(nome: string, regra: RegraGravada) {
  return createAutomationRuleSchema.parse({ name: nome, ...regra, trigger_config: regra.trigger_config ?? {} });
}

describe("o designer do upstream e as regras que só o fork grava", () => {
  it("controle positivo: as regras de referência são válidas para o schema", () => {
    for (const [nome, regra] of REGRAS) expect(() => oQueAApiGrava(nome, regra), nome).not.toThrow();
  });

  it.each(REGRAS)("ida e volta sem mexer: %s", (nome, regra) => {
    const resultado = validarDesenho({ nome, desenho: desenhoDaRegra(regra), regraGravada: regra });
    expect(resultado.problemas).toEqual([]);
    expect(resultado.ok).toBe(true);
    expect(resultado.corpo).toEqual(oQueAApiGrava(nome, regra));
  });

  it("a tela do gatilho de obrigação mostra o X e o tipo gravados", () => {
    const desenho = desenhoDaRegra(REGRAS[0]![1]);
    const gatilho = desenho.caixas.find((c) => c.data.kind === "gatilho")!;
    expect(gatilho.data.kind === "gatilho" && gatilho.data.tela.obrigacao).toEqual({ dias: "30", tipo: "Alvará" });
  });

  it("trocar para um gatilho de obrigação usa o X sugerido; limpar o tipo limpa de verdade", () => {
    const regra = REGRAS[0]![1];
    const desenho = desenhoDaRegra({ ...regra, trigger_event: "lead.stage_changed", trigger_config: {} });
    const caixas = desenho.caixas.map((c) =>
      c.data.kind === "gatilho"
        ? { ...c, data: { ...c.data, evento: "obrigacao.atividade_chegando", tela: { ...c.data.tela, obrigacao: undefined } } }
        : c,
    );
    expect(corpoDoDesenho({ nome: "x", desenho: { ...desenho, caixas }, regraGravada: null }).trigger_config).toEqual({ dias: 15 });

    const comTipoLimpo = desenhoDaRegra(regra).caixas.map((c) =>
      c.data.kind === "gatilho" ? { ...c, data: { ...c.data, tela: { ...c.data.tela, obrigacao: { dias: "30", tipo: "" } } } } : c,
    );
    const corpo = corpoDoDesenho({ nome: "x", desenho: { ...desenhoDaRegra(regra), caixas: comTipoLimpo }, regraGravada: regra });
    expect(corpo.trigger_config).toEqual({ dias: 30 });
  });

  it("o gatilho de obrigação sem X é recusado na caixa do gatilho, com a frase do fork", () => {
    const regra = REGRAS[1]![1];
    const caixas = desenhoDaRegra(regra).caixas.map((c) =>
      c.data.kind === "gatilho" ? { ...c, data: { ...c.data, tela: { ...c.data.tela, obrigacao: { dias: "", tipo: "" } } } } : c,
    );
    const r = validarDesenho({ nome: "x", desenho: { ...desenhoDaRegra(regra), caixas }, regraGravada: regra });
    expect(r.ok).toBe(false);
    expect(r.problemas.map((p) => p.mensagem)).toContain("Diga com quantos dias a regra dispara (de 1 a 3650).");
  });

  it("o nome antigo de horário marcado não é oferecido para regra nova", () => {
    expect(GATILHOS_OFERECIDOS).not.toContain("appointment.booked");
    expect(GATILHOS_OFERECIDOS).toContain("obrigacao.documento_vencendo");
  });
});
