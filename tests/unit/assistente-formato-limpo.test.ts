/**
 * FORK MIA (.120, MIA-253) — a resposta do assistente sai sem o formato que a tela não mostra.
 *
 * O diagnóstico da MIA-239 achou 4 respostas com o botão escrito como texto, todas
 * no fim da resposta: o link markdown para a tela, o `[[...]]`, o link para
 * `functions://...` e o link com a barra escapada ("\/app\/..."), que aparecia como
 * texto estranho no fim. Os 4 estão reescritos abaixo com dado fictício, no mesmo
 * formato. O botão de verdade vem do coletor do turno, nunca do texto.
 */
import { describe, expect, it, vi } from "vitest";

import { limparFormatoDaResposta } from "@/lib/assistente/formato";
import { responderNoAssistente } from "@/lib/assistente/turno";
import { telasParaOPapel } from "@/lib/assistente/telas";

describe("os 4 casos do diagnóstico (dado fictício)", () => {
  it("1. o 'Me leva lá' como link markdown no fim sai inteiro", () => {
    const texto = [
      "Para criar uma tarefa, abra **Tarefas** e clique em **Nova tarefa**.",
      "- Escolha o responsável.",
      "- Defina a data de vencimento.",
      "",
      "[Me leva lá](/app/tasks)",
    ].join("\n");
    expect(limparFormatoDaResposta(texto)).toBe(
      [
        "Para criar uma tarefa, abra **Tarefas** e clique em **Nova tarefa**.",
        "- Escolha o responsável.",
        "- Defina a data de vencimento.",
      ].join("\n"),
    );
  });

  it("2. o botão entre colchetes duplos sai", () => {
    const texto = "O funil mostra cada lead na etapa em que ele está.\n\n[[Me leva aos Funis]]";
    expect(limparFormatoDaResposta(texto)).toBe("O funil mostra cada lead na etapa em que ele está.");
  });

  it("3. o link para functions:// sai, e nenhum functions:// sobra", () => {
    const texto =
      "Os contatos ficam na tela de Contatos, com a busca no topo.\n\n" +
      "[Ir para Contatos](functions://mostrar_me_leva_la?href=%2Fapp%2Fcontacts&rotulo=Ir+para+Contatos)";
    const limpo = limparFormatoDaResposta(texto);
    expect(limpo).toBe("Os contatos ficam na tela de Contatos, com a busca no topo.");
    expect(limpo).not.toContain("functions://");
  });

  it("4. o link com a barra escapada no fim (o texto estranho) sai, como item de lista também", () => {
    const texto = [
      "Para mandar uma campanha, abra Campanhas.",
      "",
      "**Caminho:** Campanhas → Nova campanha.",
      "",
      "[Me leva às Campanhas](\\/app\\/broadcast)",
    ].join("\n");
    expect(limparFormatoDaResposta(texto)).toBe(
      ["Para mandar uma campanha, abra Campanhas.", "", "**Caminho:** Campanhas → Nova campanha."].join("\n"),
    );
    expect(limparFormatoDaResposta("Pronto.\n\n- [Me leva lá]( /app/broadcast )")).toBe("Pronto.");
  });
});

describe("o resto do que a tela não mostra", () => {
  it("link no meio da frase vira só o texto, de dentro ou de fora", () => {
    expect(limparFormatoDaResposta("Abra [Funis](/app/kanban) e arraste o card.")).toBe("Abra Funis e arraste o card.");
    expect(limparFormatoDaResposta("Veja a [central de ajuda](https://ajuda.exemplo.com.br/x) depois.")).toBe(
      "Veja a central de ajuda depois.",
    );
    // A linha só de link para fora não é botão: fica o texto.
    expect(limparFormatoDaResposta("[Central de ajuda](https://ajuda.exemplo.com.br)")).toBe("Central de ajuda");
    // A linha só de link para tela, pelo endereço inteiro do sistema, é botão.
    expect(limparFormatoDaResposta("Feito.\n[Abrir](https://sistema.exemplo.com.br/app/tasks)")).toBe("Feito.");
  });

  it("functions:// e [[...]] soltos no meio da frase saem", () => {
    expect(limparFormatoDaResposta("Clique functions://mostrar_me_leva_la?href=%2Fapp aqui [[Abrir]] e pronto.")).toBe(
      "Clique aqui e pronto.",
    );
  });

  it("título perde o #, fica o texto", () => {
    expect(limparFormatoDaResposta("## Sua rotina de hoje\n- **Tarefas:** 2")).toBe("Sua rotina de hoje\n- **Tarefas:** 2");
    expect(limparFormatoDaResposta("# Resumo #")).toBe("Resumo");
    // "#" no meio da frase não é título.
    expect(limparFormatoDaResposta("O pedido #12 entrou.")).toBe("O pedido #12 entrou.");
  });

  it("tabela vira lista, sem perder o número", () => {
    const texto = [
      "Seus negócios por etapa:",
      "",
      "| Etapa | Negócios | Valor |",
      "|---|---:|---|",
      "| Proposta | 3 | R$ 1.200,00 |",
      "| **Fechamento** | 1 | R$ 800,00 |",
    ].join("\n");
    expect(limparFormatoDaResposta(texto)).toBe(
      [
        "Seus negócios por etapa:",
        "",
        "- **Proposta:** Negócios 3, Valor R$ 1.200,00",
        "- **Fechamento:** Negócios 1, Valor R$ 800,00",
      ].join("\n"),
    );
    // Duas colunas: o cabeçalho não repete.
    expect(limparFormatoDaResposta("| Pessoa | Vendas |\n|--|--|\n| Ana Souza | 4 |")).toBe("- **Ana Souza:** 4");
    // Sem cabeçalho.
    expect(limparFormatoDaResposta("| Hoje | 2 | 5 |")).toBe("- **Hoje:** 2, 5");
    expect(limparFormatoDaResposta("Uma barra | no meio não é tabela.")).toBe("Uma barra | no meio não é tabela.");
  });

  it("travessão sai: entre números vira 'a', no começo vira item, no meio vira vírgula", () => {
    expect(limparFormatoDaResposta("Abra Funis — lá você vê cada lead.")).toBe("Abra Funis, lá você vê cada lead.");
    expect(limparFormatoDaResposta("De 10–15 de outubro.")).toBe("De 10 a 15 de outubro.");
    expect(limparFormatoDaResposta("— primeiro passo\n— segundo passo")).toBe("- primeiro passo\n- segundo passo");
    expect(limparFormatoDaResposta("**Tarefas:** — nenhuma —")).toBe("**Tarefas:** nenhuma");
    expect(limparFormatoDaResposta("Ana—Bruno")).toBe("Ana, Bruno");
  });

  it("negrito, listas com sub-item e o hífen comum ficam como estão", () => {
    const texto = [
      "Sua rotina hoje:",
      "",
      "- **Compromissos:** nenhum.",
      "- **Tarefas atrasadas:** 2:",
      "  - **Ligar para a Clínica Modelo**, vencida em 28/09.",
      "  - **Enviar a proposta**, vencida em 30/09.",
      "- **Follow-up:** 1 pendente.",
    ].join("\n");
    expect(limparFormatoDaResposta(texto)).toBe(texto);
  });

  it("limpar duas vezes dá o mesmo texto", () => {
    const sujo = "## Título\n\nAbra [Funis](/app/kanban) — e veja.\n\n| a | b |\n|-|-|\n| x | 1 |\n\n\n\n[[Me leva]]";
    const uma = limparFormatoDaResposta(sujo);
    expect(limparFormatoDaResposta(uma)).toBe(uma);
    expect(uma).not.toMatch(/\n{3,}/);
  });
});

describe("no turno", () => {
  // O cliente de sessão de mentira: a base da empresa falha (o turno segue sem ela).
  const db = {
    supabaseKey: "chave-anon-de-teste",
    headers: { "X-Client-Info": "supabase-ssr/sessao" },
    from: () => {
      throw new Error("sem banco no teste");
    },
  };
  const entrada = {
    db: db as never,
    organizationId: "0a000000-0000-4000-8000-000000000253",
    nomeDaEmpresa: "Empresa Modelo",
    userId: "0b000000-0000-4000-8000-000000000253",
    primeiroNome: "Juliana",
    papel: "agent" as const,
    idioma: "pt-BR",
    fuso: "America/Sao_Paulo",
    agora: new Date("2026-11-27T12:00:00Z"),
    tela: { caminho: "/app/kanban", rotulo: "Funis" },
    telas: telasParaOPapel({ papel: "agent" }),
    equipe: [],
    historico: [],
    pergunta: "Onde vejo os meus leads?",
    ultimaRecusa: null,
  };

  it("a resposta sai limpa e o botão continua vindo do coletor", async () => {
    const modelo = vi.fn(async (pedido: { tools: Record<string, { execute?: (a: unknown, o: unknown) => Promise<unknown> }> }) => {
      await pedido.tools.mostrar_me_leva_la?.execute?.({ caminho: "/app/kanban" }, { toolCallId: "x", messages: [] });
      return { texto: "Os leads ficam em Funis — cada um na etapa dele.\n\n[[Me leva aos Funis]]", callId: null };
    });
    const r = await responderNoAssistente(entrada, { chamarModelo: modelo as never, chaveDeServico: "chave-de-servico-de-teste" });
    expect(r.texto).toBe("Os leads ficam em Funis, cada um na etapa dele.");
    expect(r.semResposta).toBe(false);
  });

  it("resposta que era só lixo de formato vira o 'não sei', como a vazia", async () => {
    const modelo = vi.fn(async () => ({ texto: "[[Me leva aos Funis]]", callId: null }));
    const r = await responderNoAssistente(entrada, { chamarModelo: modelo as never, chaveDeServico: "chave-de-servico-de-teste" });
    expect(r.texto).toMatch(/^Ainda não sei responder isso/);
    expect(r.semResposta).toBe(true);
    expect(r.acoes.some((a) => a.tipo === "suporte")).toBe(true);
  });
});
