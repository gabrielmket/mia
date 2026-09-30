/**
 * O MODO DE VENDA DESCE PELO LAYOUT — e o Novo Lead continua montável sozinho
 * (fork MIA, item C2; docs/FORK-MIA.md).
 *
 * ─── O que aconteceu ────────────────────────────────────────────────────────
 *
 * `useMostraEmpresas` lia `useAuth().activeOrg?.modo_de_venda`. Isso amarrou o
 * `NewLeadDialog` — componente do UPSTREAM, onde o fork pôs o seletor de
 * empresa — ao `<AuthProvider>`. Na fusão da v1.60 o upstream trouxe
 * `novo-lead-escolhe-contato`, que monta o diálogo sozinho, e os quatro casos
 * caíram com "useAuth must be used inside <AuthProvider>". O conserto é o que o
 * upstream já fez com o idioma: um provedor próprio, que recebe o valor PRONTO
 * do layout de `/app` e não pergunta quem está logado.
 *
 * ─── O risco que o conserto cria, e que este arquivo vigia ──────────────────
 *
 * Sem provedor, o hook responde "não mostra" — é o que deixa o diálogo do
 * upstream montável sozinho. O preço: se uma fusão futura perder o provedor do
 * layout, o campo Empresa SOME de toda organização B2B, sem erro nenhum. É o
 * modo de falha que `modo-de-venda-esconde-empresa.test.ts` descreve ("sumir é
 * a mudança que o usuário não reporta"). O segundo bloco executa o layout de
 * verdade, como `faixa-de-conexao-caida-vem-do-seam` faz, e cobra que o
 * provedor está lá, com o modo da organização, EMBRULHANDO a página.
 */
import type { ReactElement, ReactNode } from "react";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Stage } from "@/lib/kanban/types";

// ── o layout de /app, encurtado ao caminho normal (mesmos dublês da faixa) ──

const settingsDaOrg: { atual: unknown } = { atual: null };

/** Cadeia do supabase-js que responde a qualquer filtro e termina em `resposta`. */
function cadeia(resposta: { data: unknown; error: null }) {
  const c: Record<string, unknown> = {};
  for (const metodo of ["select", "eq", "is", "in"]) c[metodo] = () => c;
  c.maybeSingle = async () => resposta;
  c.then = (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
    Promise.resolve(resposta).then(ok, falha);
  return c;
}

const adminClient = {
  from: (tabela: string) =>
    tabela === "organizations"
      ? cadeia({
          data: { onboarded_at: "2026-01-01", status: "active", settings: settingsDaOrg.atual },
          error: null,
        })
      : cadeia({ data: [], error: null }),
};

vi.mock("@/lib/channels/health", () => ({ listarConexoesCaidas: async () => [] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminClient }));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: async () => ({
    id: "user-1",
    idioma: "pt-BR",
    is_platform_admin: false,
    support: null,
    organizations: [],
  }),
  resolveActiveOrg: async () => ({ orgId: "org-1", role: "admin", interface_settings: null }),
  isMfaEnrolled: async () => true,
  requiresMfa: async () => false,
}));
vi.mock("@/lib/auth/vinculo-revogado", () => ({ acessoFoiRevogado: async () => false }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect inesperado para ${destino}`);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/branding/instalacao", () => ({ marcaDaInstalacao: async () => ({}) }));
vi.mock("@/lib/branding/organizacao", () => ({
  resolverMarcaDaOrganizacao: () => ({
    name: "Deskcomm",
    logoUrl: null,
    cor: "#000000",
    origens: { nome: "instalacao", logoUrl: "instalacao", cor: "instalacao" },
  }),
}));

// ── o Novo Lead, com os mesmos dublês de `novo-lead-escolhe-contato` ────────

const criarLead = vi.fn();
vi.mock("@/hooks/kanban/useCreateLead", () => ({
  useCreateLead: () => ({ mutateAsync: criarLead, isPending: false }),
}));
vi.mock("@/hooks/contacts/useContactList", () => ({
  useContactList: () => ({ data: { pages: [{ data: [] }] }, isLoading: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const EMPRESA = "44444444-4444-4444-8444-444444444444";
vi.mock("@/hooks/useEmpresas", () => ({
  useEmpresas: () => ({ data: { data: [{ id: EMPRESA, nome: "Padaria do Zé" }] }, isLoading: false }),
}));

import { NewLeadDialog } from "@/components/kanban/NewLeadDialog";
import { ProvedorDoModoDeVenda, useMostraEmpresas } from "@/hooks/useMostraEmpresas";
import type { ModoDeVenda } from "@/lib/empresas/modo-de-venda";

const ETAPAS = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Novo", is_won: false, is_lost: false, is_archived: false },
] as unknown as Stage[];
const FUNIL = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  settingsDaOrg.atual = null;
  criarLead.mockReset();
  criarLead.mockResolvedValue({ data: { id: "lead-1" } });
});

afterEach(cleanup);

function achar(no: ReactNode, casa: (e: ReactElement) => boolean): ReactElement | null {
  if (!no || typeof no !== "object") return null;
  if (Array.isArray(no)) {
    for (const filho of no) {
      const achado = achar(filho as ReactNode, casa);
      if (achado) return achado;
    }
    return null;
  }
  const elemento = no as ReactElement<{ children?: ReactNode }>;
  if (casa(elemento)) return elemento;
  return achar(elemento.props?.children, casa);
}

describe("useMostraEmpresas — três estados, e eles não são o mesmo", () => {
  const com = (modo: ModoDeVenda | undefined) =>
    function Envelope({ children }: { children: ReactNode }) {
      return <ProvedorDoModoDeVenda modo={modo}>{children}</ProvedorDoModoDeVenda>;
    };

  it("o modo da organização decide", () => {
    expect(renderHook(useMostraEmpresas, { wrapper: com("b2b") }).result.current).toBe(true);
    expect(renderHook(useMostraEmpresas, { wrapper: com("b2c") }).result.current).toBe(false);
  });

  it("provedor SEM modo mostra — na dúvida o produto mostra de mais", () => {
    expect(renderHook(useMostraEmpresas, { wrapper: com(undefined) }).result.current).toBe(true);
  });

  it("SEM provedor não mostra — fora da casca não há organização de quem listar empresas", () => {
    expect(renderHook(useMostraEmpresas).result.current).toBe(false);
  });
});

describe("o layout de /app monta o provedor", () => {
  it("com o modo que a organização gravou, e embrulhando a página", async () => {
    settingsDaOrg.atual = { modo_de_venda: "b2c" };
    const { default: AppLayout } = await import("@/app/app/layout");
    const pagina = <main data-pagina="" />;

    const arvore = (await AppLayout({ children: pagina })) as ReactElement;

    const provedor = achar(arvore, (e) => e.type === ProvedorDoModoDeVenda) as ReactElement<{
      modo: ModoDeVenda | undefined;
      children: ReactNode;
    }> | null;
    expect(
      provedor,
      "o layout não monta mais o ProvedorDoModoDeVenda — o campo Empresa sumiu de toda organização B2B",
    ).not.toBeNull();
    expect(provedor!.props.modo).toBe("b2c");
    // Provedor ao lado da página, e não em volta dela, não serve a ninguém.
    expect(achar(provedor!.props.children, (e) => e === pagina)).not.toBeNull();
  });

  it("sem modo gravado, o provedor recebe o padrão que mostra", async () => {
    const { default: AppLayout } = await import("@/app/app/layout");
    const arvore = (await AppLayout({ children: null })) as ReactElement;
    const provedor = achar(arvore, (e) => e.type === ProvedorDoModoDeVenda) as ReactElement<{
      modo: ModoDeVenda | undefined;
    }> | null;
    expect(provedor?.props.modo).toBe("b2b");
  });
});

describe("o Novo Lead com a empresa (dentro do provedor)", () => {
  function dialogo(aberto: boolean, modo: ModoDeVenda) {
    return (
      <ProvedorDoModoDeVenda modo={modo}>
        <NewLeadDialog open={aberto} onOpenChange={() => {}} pipelineId={FUNIL} stages={ETAPAS} />
      </ProvedorDoModoDeVenda>
    );
  }

  /** O Radix Select espelha as opções num `<select>` nativo oculto, ao lado do gatilho. */
  function escolherEmpresa(id: string) {
    const gatilho = screen.getByRole("combobox", { name: "Empresa" });
    const nativo = gatilho.parentElement?.querySelector("select");
    expect(nativo, "o <select> nativo do campo Empresa não foi achado").toBeTruthy();
    fireEvent.change(nativo!, { target: { value: id } });
  }

  it("B2B: a empresa escolhida vai na criação", async () => {
    const user = userEvent.setup();
    render(dialogo(true, "b2b"));

    await screen.findByRole("combobox", { name: "Empresa" });
    escolherEmpresa(EMPRESA);
    await user.type(screen.getByLabelText("Título"), "Pedido de pães");
    await user.click(screen.getByRole("button", { name: "Criar lead" }));

    await waitFor(() => expect(criarLead).toHaveBeenCalledTimes(1));
    expect(criarLead.mock.calls[0]?.[0]).toMatchObject({ empresa_id: EMPRESA });
  });

  it("fechar o diálogo esquece a empresa — como o contato, ela é vínculo", async () => {
    // O diálogo NÃO desmonta ao fechar (o funil o mantém montado). Sem a limpeza,
    // a empresa escolhida e abandonada voltava selecionada e o próximo negócio
    // nascia ligado a ela, sem nada na tela dizendo.
    const user = userEvent.setup();
    const { rerender } = render(dialogo(true, "b2b"));

    await screen.findByRole("combobox", { name: "Empresa" });
    escolherEmpresa(EMPRESA);

    rerender(dialogo(false, "b2b"));
    rerender(dialogo(true, "b2b"));

    await user.type(await screen.findByLabelText("Título"), "Outro assunto");
    await user.click(screen.getByRole("button", { name: "Criar lead" }));

    await waitFor(() => expect(criarLead).toHaveBeenCalledTimes(1));
    expect(criarLead.mock.calls[0]?.[0]).not.toHaveProperty("empresa_id");
  });

  it("B2C: o campo não aparece", async () => {
    render(dialogo(true, "b2c"));
    await screen.findByLabelText("Título");
    expect(screen.queryByRole("combobox", { name: "Empresa" })).toBeNull();
  });
});
