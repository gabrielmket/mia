/**
 * A separação que faz o custo virar decisão de preço.
 *
 * "A IA custou X" não decide nada. O que decide é: quanto disso veio de CLIENTE
 * conversando (cobrável por conversa ou por pacote) e quanto veio da OPERAÇÃO
 * (o agente se avaliando, ensaio de versão, indexação) — que não cabe no preço
 * por conversa de ninguém.
 *
 * A catraca importante é a última: ponto novo no registro precisa cair de um
 * lado de propósito. Sem ela, um ponto caro entraria calado no custo por
 * conversa e o preço sairia errado sem ninguém ver um erro.
 */
import { describe, expect, it } from "vitest";

import { naturezaDoGasto, separarGasto } from "@/lib/ai/custo/natureza";
import { PONTOS_DE_IA } from "@/lib/ai/pontos/registro";

describe("de que natureza é cada ponto", () => {
  it("responder o cliente é atendimento", () => {
    expect(naturezaDoGasto("agent_turn")).toBe("atendimento");
  });

  it("os auxiliares que rodam dentro do turno são atendimento", () => {
    // FORK MIA — `handoff_promise`: o Jev lê a resposta que saiu no turno (a
    // passagem prometida), com o contato da conversa na linha.
    for (const p of ["stage_classifier", "promise_semantic", "jailbreak_detect", "checkpoint", "handoff_promise"]) {
      expect(naturezaDoGasto(p), p).toBe("atendimento");
    }
  });

  it("o agente se avaliando é sistema — o cron carimba no dia dele, não no da conversa", () => {
    expect(naturezaDoGasto("flywheel_judge")).toBe("sistema");
    expect(naturezaDoGasto("flywheel_distiller")).toBe("sistema");
  });

  it("ensaio de versão é sistema, mesmo tendo papel 'atender' no registro", () => {
    // É o caso que impede derivar a natureza do `papel`: ensaio roda quando
    // alguém testa, e num dia sem conversa nenhuma ele criaria custo "por conversa".
    const ponto = PONTOS_DE_IA.find((p) => p.id === "agent_preview");
    expect(ponto?.papel).toBe("atender");
    expect(naturezaDoGasto("agent_preview")).toBe("sistema");
  });

  it("indexar o acervo é sistema; consultar o acervo é atendimento", () => {
    expect(naturezaDoGasto("embedding_indexar")).toBe("sistema");
    expect(naturezaDoGasto("embedding_consultar")).toBe("atendimento");
  });

  it("validar a resposta do fluxo é atendimento — roda dentro do turno, a cada resposta do cliente", () => {
    expect(naturezaDoGasto("flow_validate")).toBe("atendimento");
  });

  it("configurar com o administrador é sistema — montar agente e importar modelo de proposta não têm cliente na linha", () => {
    expect(naturezaDoGasto("prospecting_agent_setup_chat")).toBe("sistema");
    expect(naturezaDoGasto("proposal_template_import")).toBe("sistema");
  });

  it("ferramenta da equipe é sistema — o clique é de quem opera, não mensagem do cliente", () => {
    // `case_chat` carimba o contato do caso: contado como atendimento, criaria
    // uma conversa num dia em que o cliente não escreveu.
    for (const p of ["proposal_assistant", "proposal_fill_from_conversation", "case_chat"]) {
      expect(naturezaDoGasto(p), p).toBe("sistema");
    }
  });

  it("ler o valor da venda na conversa é sistema — roda quando o negócio é ganho, não quando o cliente escreve", () => {
    // Uma leitura por venda de anúncio sem valor, no dia do ganho: contada como
    // atendimento, entraria no custo por conversa de um dia sem conversa.
    expect(naturezaDoGasto("conversion_value_from_conversation")).toBe("sistema");
  });

  it("purpose desconhecido vai para sistema — nunca infla o preço por conversa", () => {
    expect(naturezaDoGasto("ponto_que_nao_existe_mais")).toBe("sistema");
  });

  it("CATRACA: todo ponto do registro está classificado de propósito", () => {
    // Se este caso ficar vermelho, um ponto novo entrou no registro e ninguém
    // decidiu de que lado ele fica. Decidir é uma linha em `DO_SISTEMA` (ou a
    // escolha consciente de deixá-lo em atendimento) — e um caso aqui dizendo por quê.
    const classificados = new Set([
      "agent_turn",
      "operator_turn",
      "automation_ai_message",
      "draft_suggestion",
      "bot_respond",
      "intent_router",
      "stage_classifier",
      "sentiment_classify",
      "followup_classify",
      "followup_decide_timing",
      "flow_validate",
      "jailbreak_detect",
      // FORK MIA — o Jev conferindo a resposta que saiu no turno: atendimento.
      "handoff_promise",
      "promise_semantic",
      "compaction",
      "flush",
      "checkpoint",
      "embedding_consultar",
      "transcricao_de_audio",
      "visao_de_imagem",
      "agent_preview",
      "teste_de_agente",
      "connection_test",
      "contagem_de_tokens",
      "flywheel_judge",
      "flywheel_distiller",
      "embedding_indexar",
      "prospecting_agent_setup_chat",
      "proposal_template_import",
      "proposal_assistant",
      "proposal_fill_from_conversation",
      "case_chat",
      "conversion_value_from_conversation",
    ]);
    const novos = PONTOS_DE_IA.map((p) => p.id).filter((id) => !classificados.has(id));
    expect(novos, "pontos de IA sem natureza decidida").toEqual([]);
  });
});

describe("separar o gasto de uma janela", () => {
  const linhas = [
    { purpose: "agent_turn", cost_cents: 9.68, contact_id: "c1" },
    { purpose: "stage_classifier", cost_cents: 0.12, contact_id: "c1" },
    { purpose: "agent_turn", cost_cents: 4.2, contact_id: "c2" },
    { purpose: "flywheel_judge", cost_cents: 30, contact_id: null },
  ];

  it("soma cada natureza no seu lado", () => {
    const g = separarGasto(linhas);
    expect(g.atendimentoCents).toBeCloseTo(14, 6);
    expect(g.sistemaCents).toBe(30);
    expect(g.totalCents).toBeCloseTo(44, 6);
  });

  it("divide o atendimento pelas conversas que o causaram, não pelo total de linhas", () => {
    const g = separarGasto(linhas);
    expect(g.conversas).toBe(2);
    expect(g.porConversaCents).toBeCloseTo(7, 6);
  });

  it("o gasto do sistema não cria conversa — senão um dia sem cliente teria custo por conversa", () => {
    const g = separarGasto([{ purpose: "flywheel_judge", cost_cents: 30, contact_id: "c9" }]);
    expect(g.conversas).toBe(0);
    expect(g.porConversaCents).toBeNull();
    expect(g.sistemaCents).toBe(30);
  });

  it("numeric que chega como string soma, não concatena", () => {
    const g = separarGasto([
      { purpose: "agent_turn", cost_cents: "10.5", contact_id: "c1" },
      { purpose: "agent_turn", cost_cents: "2.5", contact_id: "c1" },
    ]);
    expect(g.atendimentoCents).toBeCloseTo(13, 6);
  });

  it("conta as linhas sem preço em vez de tratá-las como zero", () => {
    const g = separarGasto([
      { purpose: "agent_turn", cost_cents: null, contact_id: "c1" },
      { purpose: "agent_turn", cost_cents: 5, contact_id: "c1" },
    ]);
    expect(g.semPreco).toBe(1);
    expect(g.atendimentoCents).toBe(5);
  });

  it("janela vazia não vira NaN nem divisão por zero", () => {
    const g = separarGasto([]);
    expect(g).toMatchObject({ atendimentoCents: 0, sistemaCents: 0, totalCents: 0, conversas: 0, porConversaCents: null });
  });
});
