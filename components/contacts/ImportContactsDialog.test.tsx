/**
 * FORK MIA (.97) — o resumo da importação diz o que aconteceu com o telefone.
 *
 * A planilha de 565 linhas entrou sem nenhum telefone, e a tela disse só "332
 * importados". Quem vem sem telefone não recebe WhatsApp, e a coluna que ninguém
 * leu precisa aparecer aqui.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ImportContactsResult } from "@/hooks/contacts/useImportContacts";

import { ImportContactsDialog } from "./ImportContactsDialog";

let resumo: ImportContactsResult;

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/contacts/useImportContacts", () => ({
  useImportContacts: () => ({ isPending: false, mutateAsync: async () => resumo }),
}));

const base: ImportContactsResult = {
  total_linhas: 3,
  imported: 3,
  skipped_duplicates: 0,
  errors: [],
  telefones_completados: 0,
  emails_completados: 0,
  linhas_sem_telefone: 0,
  sem_coluna_de_telefone: false,
  colunas_ignoradas: [],
  avisos: [],
};

async function importar() {
  const user = userEvent.setup();
  render(<ImportContactsDialog open onOpenChange={vi.fn()} />);
  await user.upload(screen.getByTestId("arquivo-de-contatos"), new File(["a"], "c.csv", { type: "text/csv" }));
  await user.click(screen.getByTestId("confirmar-importacao"));
}

beforeEach(() => {
  resumo = base;
});

describe("o resumo da importação", () => {
  it("diz quantos vieram sem telefone, e o que isso quer dizer", async () => {
    resumo = { ...base, linhas_sem_telefone: 33 };
    await importar();

    expect(screen.getByTestId("importacao-sem-telefone")).toHaveTextContent("33 sem telefone");
    expect(screen.getByText("Contato sem telefone fica na base, mas não recebe WhatsApp nem disparo.")).toBeInTheDocument();
  });

  it("todos com telefone: nenhum aviso", async () => {
    await importar();

    expect(screen.queryByTestId("importacao-sem-telefone")).toBeNull();
    expect(screen.queryByTestId("importacao-sem-coluna-de-telefone")).toBeNull();
    expect(screen.queryByTestId("importacao-colunas-ignoradas")).toBeNull();
  });

  it("sem coluna de telefone: ensina o nome, e nomeia a coluna que ficou de fora", async () => {
    resumo = { ...base, linhas_sem_telefone: 3, sem_coluna_de_telefone: true, colunas_ignoradas: ["fone do trabalho"] };
    await importar();

    expect(screen.getByTestId("importacao-sem-coluna-de-telefone")).toHaveTextContent("telefone, celular, whatsapp ou phone");
    expect(screen.getByTestId("importacao-colunas-ignoradas")).toHaveTextContent("fone do trabalho");
  });

  it("a reimportação mostra os telefones completados e os avisos por linha", async () => {
    resumo = {
      ...base,
      imported: 0,
      skipped_duplicates: 1,
      telefones_completados: 332,
      avisos: [{ linha: 7, motivo: "O contato deste e-mail já tem outro telefone, e ele foi mantido." }],
    };
    await importar();

    expect(screen.getByText(/332 telefone\(s\) completado\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/Linha 7: O contato deste e-mail já tem outro telefone/)).toBeInTheDocument();
  });
});
