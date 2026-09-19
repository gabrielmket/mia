/**
 * O SELETOR DE MODELO DA PLATAFORMA — operadora, busca, e o que não pode sumir.
 *
 * ── Por que esta tela merece teste, sendo aberta duas vezes por ano ───────
 *
 * Porque o que se grava aqui decide a margem de TODOS os clientes, e porque
 * duas escolhas feitas nela não dão erro NELA — param a publicação de todo
 * cliente novo dias depois, na implantação seguinte
 * (`lib/ai/agents/first-publication.ts`):
 *
 *   modelo fora do catálogo   → `model_not_found`, publicação recusada
 *   operadora sem chave       → `sem_chave`, publicação recusada
 *
 * Nos dois casos o cliente termina o wizard com "Atendente criado, mas ainda
 * não está no ar", longe desta tela e de quem mexeu nela.
 *
 * ── Por que a REGRA é testada fora da tela ────────────────────────────────
 *
 * O Radix só monta `SelectContent` quando o menu está ABERTO. Uma primeira
 * versão destes casos media o DOM fechado e reprovou afirmando que o
 * "Automático" tinha sumido — quando ele nunca chegou a ser renderizado. As
 * garantias de lista vivem em `lib/ai/seletor-de-modelo.ts` e são exercitadas
 * como função pura; aqui fica o que a tela mostra FORA do dropdown.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTOMATICO,
  itensDoSeletor,
  normalizar,
  TODAS,
  type ModeloParaSeletor,
} from "@/lib/ai/seletor-de-modelo";

const MODELO = (
  provider: string,
  id: string,
  nome: string,
  preco: number | null,
): ModeloParaSeletor => ({
  provider,
  model_id: id,
  display_name: nome,
  input_price_per_million_cents: preco,
});

const CATALOGO = [
  MODELO("anthropic", "claude-sonnet-4", "Claude Sonnet 4", 300),
  MODELO("openai", "gpt-4.1", "GPT-4.1", 200),
  MODELO("google", "gemini-2.5-flash", "Gemini 2.5 Flash", 10),
];

const lista = (over: Partial<Parameters<typeof itensDoSeletor>[0]> = {}) =>
  itensDoSeletor({
    modelos: CATALOGO,
    operadora: TODAS,
    busca: "",
    valor: AUTOMATICO,
    ...over,
  });

describe("a regra da lista: o que sempre está lá", () => {
  it("o Automático vem SEMPRE, e primeiro", () => {
    // Ele não é modelo de operadora nenhuma — é a ausência de escolha. Sumir
    // numa busca tiraria da tela o único caminho de volta para {null, null}.
    for (const caso of [
      {},
      { busca: "zzzz" },
      { operadora: "openai" },
      { operadora: "openai", busca: "sonnet" },
    ]) {
      const r = lista(caso);
      expect(r.itens[0]?.valor, JSON.stringify(caso)).toBe(AUTOMATICO);
    }
  });

  it("o valor CORRENTE sobrevive ao filtro, marcado como fora dele", () => {
    // O Radix renderiza o gatilho EM BRANCO quando o `value` não tem item
    // correspondente. Em branco lê-se como "nada escolhido", e o Salvar
    // seguinte grava outra coisa por cima.
    const r = lista({ valor: "anthropic::claude-sonnet-4", busca: "gpt" });
    const injetado = r.itens.find((i) => i.injetado !== null);
    expect(injetado?.valor).toBe("anthropic::claude-sonnet-4");
    expect(injetado?.injetado).toBe("fora_do_filtro");
    expect(r.foraDoCatalogo, "sair do filtro NÃO é sair do catálogo").toBe(false);
  });

  it("vale para o valor MARCADO e ainda não salvo, não só para o salvo", () => {
    // Quem marca um modelo e depois mexe no filtro veria a marcação sumir da
    // tela enquanto ela continua na memória do componente — e salvaria às cegas.
    const r = lista({ valor: "google::gemini-2.5-flash", operadora: "openai" });
    expect(r.itens.some((i) => i.valor === "google::gemini-2.5-flash")).toBe(true);
  });

  it("valor que saiu do CATÁLOGO é outro caso, e se anuncia diferente", () => {
    const r = lista({ valor: "openai::gpt-4-turbo" });
    const injetado = r.itens.find((i) => i.injetado !== null);
    expect(injetado?.injetado).toBe("fora_do_catalogo");
    expect(injetado?.modelo, "não há linha de catálogo para mostrar").toBeNull();
    expect(r.foraDoCatalogo).toBe(true);
  });

  it("não injeta quando o valor já está visível — sem item repetido", () => {
    const r = lista({ valor: "openai::gpt-4.1" });
    const quantos = r.itens.filter((i) => i.valor === "openai::gpt-4.1").length;
    expect(quantos).toBe(1);
  });
});

describe("a regra da lista: os filtros", () => {
  it("a operadora filtra, e TODAS não filtra nada", () => {
    expect(lista({ operadora: "openai" }).filtrados).toBe(1);
    expect(lista({ operadora: TODAS }).filtrados).toBe(CATALOGO.length);
  });

  it("a busca procura no nome E no identificador", () => {
    // O id é o que aparece no log quando a chamada falha, e é por ele que
    // alguém chega a esta tela.
    expect(lista({ busca: "Sonnet" }).filtrados).toBe(1);
    expect(lista({ busca: "gpt-4.1" }).filtrados).toBe(1);
    expect(lista({ busca: "anthropic" }).filtrados).toBe(1);
  });

  it("a busca ignora acento e caixa", () => {
    // Quem digita "codigo" tem de achar "código". Reprovar por uma diferença
    // que não aparece na tela é reprovar o operador por nada.
    expect(normalizar("Código")).toBe(normalizar("codigo"));
    const r = itensDoSeletor({
      modelos: [MODELO("openai", "o3-codigo", "Código O3", 100)],
      operadora: TODAS,
      busca: "CODIGO",
      valor: AUTOMATICO,
    });
    expect(r.filtrados).toBe(1);
  });

  it("os dois filtros se somam", () => {
    expect(lista({ operadora: "openai", busca: "sonnet" }).filtrados).toBe(0);
  });

  it("filtro que não casa é ESTADO PRÓPRIO, distinto de catálogo vazio", () => {
    expect(lista({ busca: "zzzz" }).filtroNaoCasa).toBe(true);
    const vazio = itensDoSeletor({
      modelos: [],
      operadora: TODAS,
      busca: "",
      valor: AUTOMATICO,
    });
    expect(vazio.filtroNaoCasa, "catálogo vazio não é 'o filtro escondeu'").toBe(false);
  });

  it("a lista NUNCA fica sem itens — o Automático segura o piso", () => {
    // Um `<SelectContent>` de zero linhas lê-se como "não existem modelos".
    expect(lista({ busca: "zzzz" }).itens.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// A TELA: só o que aparece FORA do dropdown.
// ─────────────────────────────────────────────────────────────────────────

const estado = vi.hoisted(() => ({
  data: null as unknown,
  isLoading: false,
  error: null as unknown,
}));

vi.mock("@/hooks/useModeloDeIa", () => ({
  useModeloDeIa: () => ({
    data: estado.data,
    isLoading: estado.isLoading,
    error: estado.error,
  }),
  useSalvarModeloDeIa: () => ({ isPending: false, mutate: () => undefined }),
}));

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

const { ModeloDeIa } = await import("@/components/admin/modelo-de-ia/ModeloDeIa");

function montar(over: Record<string, unknown> = {}) {
  estado.data = {
    escolha: null,
    chave_da_instalacao: { anthropic: true, openai: true, google: false },
    modelos: CATALOGO.map((m) => ({
      ...m,
      supports_tools: true,
      output_price_per_million_cents: m.input_price_per_million_cents,
      is_default_for_provider: false,
    })),
    ...over,
  };
  return render(<ModeloDeIa />);
}

beforeEach(() => {
  estado.isLoading = false;
  estado.error = null;
});

describe("a tela", () => {
  it("oferece a operadora, a busca e o modelo — os três", () => {
    montar();
    expect(screen.getByLabelText("Operadora de IA")).toBeTruthy();
    expect(screen.getByLabelText("Buscar modelo")).toBeTruthy();
    expect(screen.getByLabelText("Modelo")).toBeTruthy();
  });

  it("a operadora se anuncia como FILTRO, não como a escolha", () => {
    // Como cascata, ela criaria o estado "operadora sim, modelo não", que
    // `platform_ia` não sabe guardar (os dois campos juntos ou os dois nulos).
    montar();
    expect(document.body.textContent).toContain("Filtra a lista abaixo");
  });

  it("o contador mostra o EFEITO da busca", () => {
    montar();
    const contador = () => screen.getByTestId("contador-de-modelos").textContent ?? "";
    expect(contador()).toContain("3");

    fireEvent.change(screen.getByLabelText("Buscar modelo"), { target: { value: "gpt" } });
    expect(contador()).toContain("1");
    expect(contador()).toContain("3");
  });

  it("busca sem resultado oferece a saída", () => {
    montar();
    fireEvent.change(screen.getByLabelText("Buscar modelo"), { target: { value: "zzzz" } });
    expect(screen.getByText("Limpar filtros")).toBeTruthy();

    fireEvent.click(screen.getByText("Limpar filtros"));
    expect(screen.queryByText("Limpar filtros")).toBeNull();
  });
});

describe("os avisos que evitam parar a publicação", () => {
  it("modelo fora do catálogo: o aviso diz que NINGUÉM novo publica", () => {
    montar({ escolha: { provider: "openai", model_id: "gpt-4-turbo", updated_at: "x" } });
    const aviso = screen.getByTestId("aviso-fora-do-catalogo").textContent ?? "";
    expect(
      aviso,
      "tem de dizer que a publicação PARA, não que 'continua valendo'",
    ).toContain("NENHUM cliente novo consegue publicar agente");
  });

  it("operadora sem chave nesta instalação: avisa antes de salvar", () => {
    // `chaveDePlataforma` não conhece `google`: um modelo Google só roda com
    // credencial da organização, e cliente NOVO não tem nenhuma.
    montar({ escolha: { provider: "google", model_id: "gemini-2.5-flash", updated_at: "x" } });
    expect(screen.getByTestId("aviso-sem-chave")).toBeTruthy();
  });

  it("com chave, nenhum aviso", () => {
    montar({ escolha: { provider: "openai", model_id: "gpt-4.1", updated_at: "x" } });
    expect(screen.queryByTestId("aviso-sem-chave")).toBeNull();
    expect(screen.queryByTestId("aviso-fora-do-catalogo")).toBeNull();
  });

  it("o aviso de chave não empilha com o de catálogo — o grave vem só", () => {
    montar({ escolha: { provider: "google", model_id: "sumiu", updated_at: "x" } });
    expect(screen.getByTestId("aviso-fora-do-catalogo")).toBeTruthy();
    expect(screen.queryByTestId("aviso-sem-chave")).toBeNull();
  });
});

describe("catálogo vazio", () => {
  it("é tratado como DEFEITO, não como tela calma", () => {
    montar({ modelos: [] });
    expect(screen.getByTestId("catalogo-vazio")).toBeTruthy();
    // Filtro sobre lista vazia é mobília.
    expect(screen.queryByLabelText("Operadora de IA")).toBeNull();
    expect(screen.queryByLabelText("Buscar modelo")).toBeNull();
  });

  it("não deixa salvar — não há o que fixar", () => {
    montar({ modelos: [] });
    const botao = screen.getByText("Salvar").closest("button");
    expect(botao?.disabled).toBe(true);
  });
});
