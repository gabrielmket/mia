/**
 * FORK MIA (9017) — A TELA das conversões da Meta, pelo que a pessoa vê e clica:
 * as regras por etapa (com "Usar o recomendado" e o quadro "Como a Meta vai
 * enxergar este funil"), a chave dos leads de formulário, o diagnóstico e o
 * histórico de envios.
 *
 * É a régua do protótipo aprovado: o que ele mostrava e deixava fazer, a tela faz.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { DiagnosticoDaMetaNaTela } from "@/app/app/settings/conversoes/_diagnosticoMeta";
import { HistoricoDeEnviosDasPlataformas } from "@/app/app/settings/conversoes/_historicoDeEnvios";
import { LeadsDeFormularioDaMeta } from "@/app/app/settings/conversoes/_leadsDeFormularioMeta";
import { RegrasDeConversaoMeta } from "@/app/app/settings/conversoes/_regrasMeta";
import type { FiltrosDoHistoricoDeEnvios, LinhaDoHistoricoDeEnvios } from "@/lib/conversoes-meta/historico";
import type { FunilDaRegua, RegraDeConversaoMeta } from "@/lib/conversoes-meta/regras";
import { reenvioDoEnvio, situacaoDoEnvio } from "@/lib/conversoes-meta/situacao";

const mock = vi.hoisted(() => ({
  salvar: vi.fn(),
  chave: vi.fn(),
  testar: vi.fn(),
  reenviar: vi.fn(),
  aviso: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));
vi.mock("@/app/actions/settings/conversoesDaMeta", () => ({
  salvarRegrasDeConversaoMeta: mock.salvar,
  definirLeadsDeFormularioDaMeta: mock.chave,
  testarConexaoDaMeta: mock.testar,
  reenviarConversaoDaMeta: mock.reenviar,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: mock.aviso }));

const E = {
  novo: "11111111-1111-4111-8111-111111111111",
  qualificacao: "22222222-2222-4222-8222-222222222222",
  agendada: "33333333-3333-4333-8333-333333333333",
  compareceu: "44444444-4444-4444-8444-444444444444",
  entrada: "55555555-5555-4555-8555-555555555555",
};

const FUNIS: FunilDaRegua[] = [
  {
    id: "f1",
    nome: "Agendamentos · Clínica",
    etapas: [
      { id: E.novo, nome: "Novo contato" },
      { id: E.qualificacao, nome: "Qualificação" },
      { id: E.agendada, nome: "Avaliação agendada" },
      { id: E.compareceu, nome: "Compareceu" },
    ],
    ganho: ["Fechou tratamento"],
    perda: ["Perdido"],
  },
  { id: "f2", nome: "Comercial", etapas: [{ id: E.entrada, nome: "Entrada" }], ganho: ["Ganho"], perda: ["Perdido"] },
  { id: "f3", nome: "Funil sem etapa aberta", etapas: [], ganho: [], perda: [] },
];

const CONEXAO = { conectada: true, habilitada: true, emTeste: false };

const regraSalva = (stageId: string, over: Partial<RegraDeConversaoMeta> = {}): RegraDeConversaoMeta => ({
  id: `r-${stageId}`,
  stageId,
  ligada: true,
  evento: "lead_qualificado",
  canal: "todos",
  modoDoValor: "sem_valor",
  valorFixoCentavos: null,
  configuradaEm: "2026-09-25T00:00:00Z",
  ...over,
});

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mock.salvar.mockResolvedValue({ ok: true });
  mock.chave.mockResolvedValue({ ok: true });
  mock.reenviar.mockResolvedValue({ ok: true, agendado: true });
});

describe("o que cada etapa do funil informa à Meta", () => {
  it("uma linha por etapa ABERTA do funil escolhido; ganho e perda não aparecem, e a tela diz por quê", () => {
    render(<RegrasDeConversaoMeta funis={FUNIS} regras={[]} conexao={CONEXAO} idioma="pt-BR" />);
    for (const id of [E.novo, E.qualificacao, E.agendada, E.compareceu]) {
      expect(screen.getByTestId(`regra-meta-${id}`)).toBeTruthy();
    }
    expect(screen.queryByTestId(`regra-meta-${E.entrada}`)).toBeNull();
    const aviso = screen.getByTestId("regras-meta-ganho-e-perda").textContent ?? "";
    expect(aviso).toContain("Ganho é a compra. Perda não é conversão.");
    expect(aviso).toContain("Fechou tratamento");
    // O funil sem etapa aberta não entra no seletor.
    expect(within(screen.getByLabelText("Funil")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Agendamentos · Clínica",
      "Comercial",
    ]);
    expect(screen.getByTestId("etapas-informando-a-meta").textContent).toContain("0 de 4");
  });

  it("⭐ \"Usar o recomendado\" liga pelo nome da etapa, e o quadro mostra a sequência terminando na compra", () => {
    render(<RegrasDeConversaoMeta funis={FUNIS} regras={[]} conexao={CONEXAO} idioma="pt-BR" />);
    fireEvent.click(screen.getByRole("button", { name: "Usar o recomendado" }));
    expect(screen.getByTestId("etapas-informando-a-meta").textContent).toContain("3 de 4");
    expect(screen.getByTestId("regras-meta-nao-salvas")).toBeTruthy();

    const quadro = screen.getByTestId("como-a-meta-enxerga");
    const passos = within(quadro).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(passos).toHaveLength(4);
    expect(passos[0]).toContain("Novo lead");
    expect(passos[0]).toContain("LeadSubmitted");
    expect(passos[0]).toContain("ao entrar em “Novo contato”");
    expect(passos[1]).toContain("QualifiedLead");
    expect(passos[2]).toContain("Agendou");
    expect(passos[2]).toContain("Todos os canais · sem valor");
    expect(passos[3]).toContain("Compra");
    expect(passos[3]).toContain("Purchase");
    expect(passos[3]).toContain("Fechou tratamento");
    expect(quadro.textContent).toContain("3 etapas informam a Meta antes da compra.");
    // "Compareceu" não tem recomendação: fica desligada.
    expect(within(screen.getByTestId(`regra-meta-${E.compareceu}`)).getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("⭐ salvar manda só o funil que está na tela, com evento, canal e valor; e avisa que vale daqui para a frente", async () => {
    render(<RegrasDeConversaoMeta funis={FUNIS} regras={[]} conexao={CONEXAO} idioma="pt-BR" />);
    fireEvent.click(screen.getByRole("button", { name: "Usar o recomendado" }));
    const agendada = within(screen.getByTestId(`regra-meta-${E.agendada}`));
    fireEvent.change(agendada.getByLabelText("Canal de entrada"), { target: { value: "whatsapp" } });
    fireEvent.change(agendada.getByLabelText("Valor do evento (opcional)"), { target: { value: "valor_fixo" } });
    fireEvent.change(agendada.getByLabelText("Valor fixo em reais na etapa Avaliação agendada"), { target: { value: "150,00" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar regras" }));
    await waitFor(() => expect(mock.salvar).toHaveBeenCalledOnce());
    expect(mock.salvar.mock.calls[0]![0]).toEqual([
      { stage_id: E.novo, ligada: true, evento: "novo_lead", canal: "todos", modo_do_valor: "sem_valor", valor_fixo_centavos: null },
      { stage_id: E.qualificacao, ligada: true, evento: "lead_qualificado", canal: "todos", modo_do_valor: "sem_valor", valor_fixo_centavos: null },
      { stage_id: E.agendada, ligada: true, evento: "agendou", canal: "whatsapp", modo_do_valor: "valor_fixo", valor_fixo_centavos: 15000 },
      { stage_id: E.compareceu, ligada: false, evento: "iniciou_compra", canal: "todos", modo_do_valor: "sem_valor", valor_fixo_centavos: null },
    ]);
    await waitFor(() =>
      expect(mock.aviso.success).toHaveBeenCalledWith(
        "Regras salvas. Vale para os negócios que entrarem nas etapas a partir de agora.",
      ),
    );
    expect(screen.getByText("Vale para os negócios que entrarem nas etapas a partir de agora.")).toBeTruthy();
  });

  it("valor fixo sem valor não sai da tela: a pessoa lê o que falta", () => {
    render(<RegrasDeConversaoMeta funis={FUNIS} regras={[]} conexao={CONEXAO} idioma="pt-BR" />);
    const novo = within(screen.getByTestId(`regra-meta-${E.novo}`));
    fireEvent.click(novo.getByRole("switch"));
    fireEvent.change(novo.getByLabelText("Valor do evento (opcional)"), { target: { value: "valor_fixo" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar regras" }));
    expect(mock.salvar).not.toHaveBeenCalled();
    expect(mock.aviso.error).toHaveBeenCalledWith("Toda etapa com valor fixo precisa de um valor maior que zero.");
  });

  it("⭐ o mesmo evento em duas etapas: a tela AVISA que a segunda não envia de novo, e não bloqueia", async () => {
    render(
      <RegrasDeConversaoMeta
        funis={FUNIS}
        regras={[regraSalva(E.qualificacao), regraSalva(E.compareceu)]}
        conexao={CONEXAO}
        idioma="pt-BR"
      />,
    );
    const passos = within(screen.getByTestId("como-a-meta-enxerga")).getAllByRole("listitem");
    expect(passos[0]!.getAttribute("data-repetido")).toBe("nao");
    expect(passos[1]!.getAttribute("data-repetido")).toBe("sim");
    expect(passos[1]!.textContent).toContain("repetido: não envia de novo para o mesmo negócio");
    fireEvent.click(within(screen.getByTestId(`regra-meta-${E.novo}`)).getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar regras" }));
    await waitFor(() => expect(mock.salvar).toHaveBeenCalledOnce());
  });

  it("evento que não está na lista da Meta para anúncio de WhatsApp vem com o aviso", () => {
    render(
      <RegrasDeConversaoMeta
        funis={FUNIS}
        regras={[regraSalva(E.agendada, { evento: "agendou" }), regraSalva(E.qualificacao)]}
        conexao={CONEXAO}
        idioma="pt-BR"
      />,
    );
    expect(within(screen.getByTestId(`regra-meta-${E.agendada}`)).getByText(/Evento fora da lista da Meta/)).toBeTruthy();
    expect(within(screen.getByTestId(`regra-meta-${E.qualificacao}`)).queryByText(/Evento fora da lista da Meta/)).toBeNull();
  });

  it("trocar de funil mostra as etapas dele; sem conexão ou com o envio pausado, a tela avisa que nada sai", () => {
    const { rerender } = render(
      <RegrasDeConversaoMeta funis={FUNIS} regras={[]} conexao={{ conectada: false, habilitada: false, emTeste: false }} idioma="pt-BR" />,
    );
    expect(screen.getByText(/A Meta ainda não está conectada/)).toBeTruthy();
    expect(screen.getByTestId("passo-da-compra").textContent).toContain("desligada no cartão da Meta");
    fireEvent.change(screen.getByLabelText("Funil"), { target: { value: "f2" } });
    expect(screen.getByTestId(`regra-meta-${E.entrada}`)).toBeTruthy();
    expect(screen.queryByTestId(`regra-meta-${E.novo}`)).toBeNull();

    rerender(
      <RegrasDeConversaoMeta funis={FUNIS} regras={[]} conexao={{ conectada: true, habilitada: false, emTeste: true }} idioma="pt-BR" />,
    );
    expect(screen.getByText(/O envio está pausado no cartão da Meta/)).toBeTruthy();
    expect(screen.getByTestId("como-a-meta-enxerga").textContent).toContain("Modo de teste ligado");
  });

  it("organização sem funil com etapa aberta: a tela diz o que fazer", () => {
    render(<RegrasDeConversaoMeta funis={[FUNIS[2]!]} regras={[]} conexao={CONEXAO} idioma="pt-BR" />);
    expect(screen.getByText("Crie um funil com etapas para escolher o que cada etapa informa à Meta.")).toBeTruthy();
  });

  it("em espanhol, a régua não fala português", () => {
    render(<RegrasDeConversaoMeta funis={FUNIS} regras={[]} conexao={CONEXAO} idioma="es" />);
    expect(screen.getByText("Lo que cada etapa del embudo informa a Meta")).toBeTruthy();
    expect(screen.getByText("Cómo verá Meta este embudo")).toBeTruthy();
  });
});

describe("leads de formulário voltam para a Meta", () => {
  it("vem desligada; ligar salva no clique", async () => {
    render(<LeadsDeFormularioDaMeta ligada={false} desde={null} idioma="pt-BR" />);
    expect(screen.getByTestId("leads-de-formulario-estado").textContent).toContain("Desligada: lead de formulário não volta para a Meta.");
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(mock.chave).toHaveBeenCalledWith(true));
    expect(screen.getByTestId("leads-de-formulario-estado").textContent).toContain("Ligada: a Meta fica sabendo");
  });

  it("a recusa do servidor devolve a chave ao que estava", async () => {
    mock.chave.mockResolvedValueOnce({ ok: false, error: "forbidden_role" });
    render(<LeadsDeFormularioDaMeta ligada={false} desde={null} idioma="pt-BR" />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(mock.aviso.error).toHaveBeenCalled());
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("ligada, diz desde quando: é dali para a frente que os eventos voltam", () => {
    render(<LeadsDeFormularioDaMeta ligada desde="2026-09-26T12:00:00Z" idioma="pt-BR" />);
    expect(screen.getByTestId("leads-de-formulario-estado").textContent).toContain("Desde 26/09/2026");
  });
});

describe("o diagnóstico da Meta", () => {
  it("só roda quando alguém pede, e mostra cada conferência com o que fazer", async () => {
    mock.testar.mockResolvedValue({
      ok: true,
      diagnostico: {
        veredito: "com_problema",
        testadoEm: "2026-10-01T10:35:00Z",
        itens: [
          { chave: "token", caso: "token_recusado", saude: "problema", dado: "Session has expired" },
          { chave: "destino", caso: "destino_nao_conferido", saude: "atencao", dado: null },
          { chave: "permissao", caso: "permissao_nao_conferida", saude: "atencao", dado: null },
          {
            chave: "ultimo_envio",
            caso: "ultimo_envio_aceito",
            saude: "ok",
            dado: null,
            ultimo: { em: "2026-10-01T08:31:00Z", evento: "Novo lead", negocio: "Negócio de teste", leadId: "l1" },
          },
          {
            chave: "recusados",
            caso: "com_recusados",
            saude: "atencao",
            dado: null,
            recusados: { total: 2, motivos: [{ motivo: "token de acesso vencido", quantos: 2 }] },
          },
          { chave: "modo_de_teste", caso: "modo_de_teste", saude: "atencao", dado: null },
        ],
      },
    });
    render(<DiagnosticoDaMetaNaTela idioma="pt-BR" />);
    expect(screen.getByTestId("diagnostico-meta-vazio").textContent).toBe("Ainda não testado nesta visita.");
    expect(mock.testar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Testar conexão" }));
    await waitFor(() => expect(screen.getByTestId("diagnostico-meta-veredito")).toBeTruthy());

    const secao = within(screen.getByTestId("diagnostico-meta"));
    expect(secao.getByText("Token recusado pela Meta")).toBeTruthy();
    expect(secao.getByText(/Gere um token novo na Meta/)).toBeTruthy();
    expect(secao.getByText("Session has expired")).toBeTruthy();
    expect(secao.getByText("Último envio aceito há 2 horas")).toBeTruthy();
    expect(secao.getByText("Eventos recusados nos últimos 7 dias: 2")).toBeTruthy();
    expect(secao.getByText("2 · token de acesso vencido")).toBeTruthy();
    expect(secao.getByText("Modo de teste ligado")).toBeTruthy();
    // O atalho para o histórico já filtrado.
    expect(secao.getByRole("link", { name: "Ver no histórico" }).getAttribute("href")).toBe(
      "?aba=historico&plataforma=meta_ads&situacao=recusado&periodo=7d",
    );
    expect(screen.getByTestId("diagnostico-meta-veredito").textContent).toBe("A Meta não está recebendo. Veja o item em vermelho.");
  });
});

describe("o histórico de envios", () => {
  const AGORA = new Date("2026-10-01T12:00:00Z");
  const linha = (over: Partial<LinhaDoHistoricoDeEnvios>): LinhaDoHistoricoDeEnvios => {
    const base = {
      id: "1",
      leadId: "0e000000-0000-4000-8000-000000000001",
      tituloDoLead: "Sala comercial",
      plataforma: "meta_ads",
      evento: "Meta:pediu_orcamento",
      status: "error",
      motivo: "recusado_pela_plataforma" as string | null,
      detalhe: "token de acesso vencido" as string | null,
      eventoId: "x:Meta:pediu_orcamento",
      protocolo: null,
      acaoGoogle: null,
      valorCentavos: 29500000 as number | null,
      moeda: "BRL",
      ocorridoEm: "2026-09-30T15:48:00Z" as string | null,
      tentadoEm: "2026-09-30T15:48:30Z",
      ...over,
    };
    return {
      ...base,
      situacao: situacaoDoEnvio(base.status, base.motivo),
      reenvio: reenvioDoEnvio(
        { plataforma: base.plataforma, status: base.status, motivo: base.motivo, ocorridoEm: base.ocorridoEm, tentadoEm: base.tentadoEm },
        AGORA,
      ),
    };
  };
  const FILTROS: FiltrosDoHistoricoDeEnvios = { periodo: "30d", situacao: "todas", evento: "", plataforma: "", busca: "", pagina: 1 };

  function montar(linhas: LinhaDoHistoricoDeEnvios[], filtros: FiltrosDoHistoricoDeEnvios = FILTROS) {
    render(
      <HistoricoDeEnviosDasPlataformas
        linhas={linhas}
        total={linhas.length}
        filtros={filtros}
        regrasGoogle={[
          { id: "g", stageId: "s", eventName: "Etapa:11111111-1111-4111-8111-111111111111", label: "Agendamento", googleActionId: "42", category: "BOOK_APPOINTMENT", includedInConversions: true, channel: "todos", enabled: true, configuredAt: "2026-09-01T00:00:00Z" },
        ]}
        idioma="pt-BR"
      />,
    );
    return screen.queryAllByRole("row").slice(1);
  }

  it("⭐ cada linha diz o negócio, o evento, a plataforma e a situação com o motivo, e o negócio abre o cartão dele", () => {
    const [recusado, velho, semValor, anterior, enviado, google] = montar([
      linha({}),
      linha({ id: "2", evento: "Purchase", detalhe: "evento com 12 dias", ocorridoEm: "2026-09-18T17:30:00Z", tituloDoLead: "Casa em condomínio" }),
      linha({ id: "3", evento: "Purchase", status: "skipped", motivo: "sem_valor", detalhe: null, valorCentavos: null }),
      linha({ id: "4", evento: "Meta:agendou", status: "skipped", motivo: "anterior_a_regra", detalhe: null, valorCentavos: null }),
      linha({ id: "5", evento: "Meta:lead_qualificado", status: "sent", motivo: null, detalhe: null, valorCentavos: null }),
      linha({ id: "6", plataforma: "google_ads", evento: "Etapa:11111111-1111-4111-8111-111111111111", status: "sent", motivo: null, detalhe: null, valorCentavos: null }),
    ]) as [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement];

    expect(within(recusado).getByRole("link", { name: "Sala comercial" }).getAttribute("href")).toBe(
      "/app/leads/0e000000-0000-4000-8000-000000000001",
    );
    expect(recusado.textContent).toContain("Pediu orçamento ou proposta");
    expect(recusado.textContent).toContain("SubmitApplication");
    expect(recusado.textContent).toContain("Recusado pela plataforma");
    expect(recusado.textContent).toContain("token de acesso vencido");
    expect(recusado.getAttribute("data-situacao")).toBe("recusado");
    // ⭐ Reenviar só onde resolve.
    expect(within(recusado).getByRole("button", { name: "Reenviar" })).toBeTruthy();

    // Mais de 7 dias na Meta: não há reenvio que resolva, e a tela diz.
    expect(within(velho).queryByRole("button", { name: "Reenviar" })).toBeNull();
    expect(velho.textContent).toContain("sem reenvio: passou de 7 dias");

    expect(semValor.textContent).toContain("Não enviado · sem valor");
    expect(within(semValor).getByRole("button", { name: "Reenviar" })).toBeTruthy();

    expect(anterior.textContent).toContain("Não enviado · anterior à regra");
    expect(anterior.textContent).toContain("O negócio entrou na etapa antes de a regra ser ligada.");
    expect(within(anterior).queryByRole("button", { name: "Reenviar" })).toBeNull();

    expect(enviado.textContent).toContain("Lead qualificado");
    expect(enviado.textContent).toContain("Enviado");
    expect(within(enviado).queryByRole("button", { name: "Reenviar" })).toBeNull();

    // O evento de etapa do Google leva o nome que a pessoa deu à conversão.
    expect(google.textContent).toContain("Agendamento");
    expect(google.textContent).toContain("Google Ads");
  });

  it("os filtros: plataforma, evento (com os da Meta), situação (as sete) e período", () => {
    montar([], { ...FILTROS, plataforma: "meta_ads", situacao: "recusado", periodo: "7d" });
    const opcoes = (rotulo: string) => within(screen.getByLabelText(rotulo)).getAllByRole("option").map((o) => o.textContent);
    expect(opcoes("Plataforma")).toEqual(["Todas", "Meta", "Google Ads"]);
    expect(opcoes("Situação")).toEqual([
      "Todas as situações",
      "Enviado",
      "Aguardando",
      "Recusado pela plataforma",
      "Não enviado · sem clique de anúncio",
      "Não enviado · sem valor",
      "Não enviado · anterior à regra",
      "Não enviado · conexão ou modo de teste",
    ]);
    expect(opcoes("Evento")).toEqual([
      "Todos os eventos",
      "Compra",
      "Novo lead",
      "Lead qualificado",
      "Agendou",
      "Pediu orçamento ou proposta",
      "Iniciou a compra",
      "Agendamento",
    ]);
    expect((screen.getByLabelText("Situação") as HTMLSelectElement).value).toBe("recusado");
    expect(screen.getByRole("link", { name: "Limpar filtros" }).getAttribute("href")).toBe("?aba=historico");
    expect(screen.getByText("Nenhum envio com estes filtros.")).toBeTruthy();
  });

  it("⭐ Reenviar: o evento de etapa da Meta vai pela ação nossa; a compra e os do Google, pela rota do upstream", async () => {
    const buscar = vi.fn(async () => new Response(JSON.stringify({ data: { queued: true } }), { status: 200 }));
    vi.stubGlobal("fetch", buscar);
    const [daMeta, compra] = montar([
      linha({}),
      linha({ id: "2", evento: "Purchase", status: "skipped", motivo: "sem_valor", detalhe: null }),
    ]) as [HTMLElement, HTMLElement];

    fireEvent.click(within(daMeta).getByRole("button", { name: "Reenviar" }));
    await waitFor(() =>
      expect(mock.reenviar).toHaveBeenCalledWith("0e000000-0000-4000-8000-000000000001", "Meta:pediu_orcamento"),
    );
    expect(buscar).not.toHaveBeenCalled();
    await waitFor(() => expect(mock.aviso.success).toHaveBeenCalledWith("Reenvio na fila, com os dados do primeiro envio."));

    fireEvent.click(within(compra).getByRole("button", { name: "Reenviar" }));
    await waitFor(() => expect(buscar).toHaveBeenCalledOnce());
    expect(String((buscar.mock.calls[0] as unknown[])[0])).toBe(
      "/api/v1/leads/0e000000-0000-4000-8000-000000000001/conversion/retry",
    );
    expect(mock.reenviar).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
