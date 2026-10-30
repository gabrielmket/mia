/**
 * FORK MIA (.97) — a conferência do disparo não deixa um zero mudo.
 *
 * Os quatro zeros queriam dizer "o filtro não achou ninguém", e pareciam dizer
 * "ninguém ficou de fora". O que este teste prende é a frase da tela em cada caso.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CampanhaCriada } from "@/hooks/useBroadcasts";

import { FormularioDoOficial } from "./FormularioDoOficial";

let resposta: CampanhaCriada;
let filtroDaTela: { tags: string[]; etapas: string[] };

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/useCarteira", () => ({ useCarteira: () => ({ data: { preco_por_mensagem_cents: 10, saldo_cents: 100 } }) }));
vi.mock("@/hooks/channels/useTemplates", () => ({
  useTemplates: () => ({
    data: { data: { templates: [{ name: "modelo", language: "pt_BR", status: "APPROVED", slots: [] }] } },
  }),
}));
vi.mock("@/hooks/useBroadcasts", () => ({
  useCriarCampanha: () => ({
    isPending: false,
    mutate: (_input: unknown, opcoes: { onSuccess: (r: { data: CampanhaCriada }) => void }) =>
      opcoes.onSuccess({ data: resposta }),
  }),
  useDispararCampanha: () => ({ isPending: false, mutate: vi.fn() }),
}));
// Os seletores ligam os filtros direto: o que se mede aqui é a conferência.
vi.mock("./SeletorDeTags", () => ({
  SeletorDeTags: ({ onChange }: { onChange: (v: string[]) => void }) => (
    <button onClick={() => onChange(filtroDaTela.tags)}>ligar etiquetas</button>
  ),
}));
vi.mock("./SeletorDeEtapas", () => ({
  SeletorDeEtapas: ({ aoMudarEtapas }: { aoMudarEtapas: (v: string[]) => void }) => (
    <button onClick={() => aoMudarEtapas(filtroDaTela.etapas)}>ligar etapas</button>
  ),
}));

const base: CampanhaCriada = {
  id: "d-1",
  destinatarios: 0,
  fora: { sem_telefone: 0, repetidos: 0, pediram_para_sair: 0, pessoais: 0, sem_negocio_na_etapa: 0 },
  pode_disparar: false,
  motivo: "lista_vazia",
  falta_cents: null,
  custo_estimado_cents: 0,
};

async function montar() {
  const user = userEvent.setup();
  render(<FormularioDoOficial />);
  await user.click(screen.getByRole("button", { name: "ligar etiquetas" }));
  await user.click(screen.getByRole("button", { name: "ligar etapas" }));
  await user.type(screen.getByLabelText("Nome da campanha"), "Campanha");
  await user.selectOptions(screen.getByLabelText("Template aprovado"), "modelo:pt_BR");
  await user.click(screen.getByRole("button", { name: "Montar lista" }));
}

beforeEach(() => {
  resposta = base;
  filtroDaTela = { tags: ["leads odonto jhs"], etapas: [] };
});

describe("a conferência do disparo", () => {
  it("25 sem telefone: o número aparece, e não há frase de filtro vazio", async () => {
    resposta = { ...base, fora: { ...base.fora, sem_telefone: 25 } };
    await montar();

    expect(screen.getByText(/25 sem telefone/)).toBeInTheDocument();
    expect(screen.queryByTestId("filtro-sem-ninguem")).toBeNull();
  });

  it("etiqueta que ninguém tem: diz para conferir a etiqueta", async () => {
    await montar();

    expect(screen.getByTestId("filtro-sem-ninguem")).toHaveTextContent(
      "Nenhum contato tem esta etiqueta. Volte e confira a etiqueta marcada.",
    );
  });

  it("etiqueta e etapa: conta quem ficou de fora pela etapa", async () => {
    filtroDaTela = { tags: ["leads odonto jhs"], etapas: ["e-1"] };
    resposta = { ...base, fora: { ...base.fora, sem_negocio_na_etapa: 25 } };
    await montar();

    expect(screen.getByText(/25 sem negócio aberto na etapa/)).toBeInTheDocument();
    expect(screen.queryByTestId("filtro-sem-ninguem")).toBeNull();
  });

  it("só a etapa, sem ninguém: diz para conferir a etapa", async () => {
    filtroDaTela = { tags: [], etapas: ["e-1"] };
    await montar();

    expect(screen.getByTestId("filtro-sem-ninguem")).toHaveTextContent("Volte e confira a etapa marcada.");
  });

  it("com destinatário, nenhuma frase de filtro vazio", async () => {
    resposta = { ...base, destinatarios: 3, pode_disparar: true, motivo: null };
    await montar();

    expect(screen.queryByTestId("filtro-sem-ninguem")).toBeNull();
    expect(screen.getByRole("button", { name: "Disparar agora" })).toBeInTheDocument();
  });
});
