/**
 * A agenda do Outlook (FORK MIA, docs/fork/agenda-microsoft.md): as partes
 * PURAS, provadas antes de existir token de verdade. Sincronização não falha com
 * barulho, falha escrevendo o horário errado; por isso a leitura do evento, o
 * consentimento e a classificação de erro são provados aqui um a um.
 */

import { describe, expect, it } from "vitest";

import { origemPublicaDoPedido, enderecoDeRetornoMicrosoft } from "@/lib/agenda/microsoft/config";
import { classificarErroDaMicrosoft, GraphHttpError } from "@/lib/agenda/microsoft/erros";
import {
  deltaMicrosoft,
  doEventoDaMicrosoft,
  paraEventoDaMicrosoft,
  projecaoLocalMicrosoft,
  projecaoRemotaMicrosoft,
  type CompromissoParaMicrosoft,
} from "@/lib/agenda/microsoft/evento";
import {
  desafioPkce,
  empresaPrecisaAprovar,
  escoposFaltandoMicrosoft,
  montarUrlDeConsentimentoMicrosoft,
  tipoDeConta,
  TENANT_DAS_CONTAS_PESSOAIS,
  verificadorPkce,
} from "@/lib/agenda/microsoft/oauth";
import { linkDaGraph, PROPRIEDADE_COMPROMISSO, type EventoDaMicrosoft } from "@/lib/agenda/microsoft/transport";
import { compare, checkpoint } from "@/lib/agenda/google/sync-model";

const cabecalhos = (valores: Record<string, string>) => ({ get: (n: string) => valores[n.toLowerCase()] ?? null });

describe("consentimento da Microsoft", () => {
  it("o verificador do PKCE é derivado do nonce: igual na ida e na volta, diferente por nonce", () => {
    const a = verificadorPkce("nonce-1", "segredo-do-servidor-com-folga");
    expect(a).toBe(verificadorPkce("nonce-1", "segredo-do-servidor-com-folga"));
    expect(a).not.toBe(verificadorPkce("nonce-2", "segredo-do-servidor-com-folga"));
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(desafioPkce(a)).not.toBe(a);
  });

  it("a URL pede PKCE S256, o seletor de contas e os quatro escopos, sem prompt=consent", () => {
    const url = new URL(
      montarUrlDeConsentimentoMicrosoft(
        { clientId: "11111111-2222-3333-4444-555555555555", tenant: "common", redirectUri: "https://crm.exemplo.com.br/api/v1/agenda/microsoft/callback" },
        { state: "st", verificador: verificadorPkce("n", "segredo-do-servidor-com-folga"), contaSugerida: "ana@exemplo.com.br" },
      ),
    );
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("login_hint")).toBe("ana@exemplo.com.br");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "openid",
      "offline_access",
      "https://graph.microsoft.com/User.Read",
      "https://graph.microsoft.com/Calendars.ReadWrite",
    ]);
  });

  it("escopo com endereço e sem caixa conta como concedido; o que falta é nomeado", () => {
    expect(escoposFaltandoMicrosoft("https://graph.microsoft.com/User.Read https://graph.microsoft.com/Calendars.ReadWrite")).toEqual([]);
    expect(escoposFaltandoMicrosoft(["User.Read"])).toEqual(["calendars.readwrite"]);
  });

  it("o erro raro da empresa que exige o TI é reconhecido; desistência não é", () => {
    expect(empresaPrecisaAprovar("access_denied", "AADSTS65001: The user or administrator has not consented")).toBe(true);
    expect(empresaPrecisaAprovar("access_denied", "AADSTS90094: Admin approval required")).toBe(true);
    expect(empresaPrecisaAprovar("consent_required", null)).toBe(true);
    expect(empresaPrecisaAprovar("access_denied", "AADSTS65004: User declined to consent")).toBe(false);
  });

  it("o tenant das contas pessoais vira conta pessoal; qualquer outro, de trabalho", () => {
    expect(tipoDeConta(TENANT_DAS_CONTAS_PESSOAIS)).toBe("pessoal");
    expect(tipoDeConta("72f988bf-86f1-41af-91ab-2d7cd011db47")).toBe("trabalho");
    expect(tipoDeConta(null)).toBe("trabalho");
  });

  it("a volta cai no domínio público do pedido; host interno do contêiner cai no canônico", () => {
    expect(origemPublicaDoPedido(cabecalhos({ "x-forwarded-host": "app.iamia.com.br", "x-forwarded-proto": "https" }))).toBe(
      "https://app.iamia.com.br",
    );
    const interno = origemPublicaDoPedido(cabecalhos({ host: "app:3000" }));
    expect(interno).not.toContain("app:3000");
    expect(enderecoDeRetornoMicrosoft("https://app.iamia.com.br/")).toBe(
      "https://app.iamia.com.br/api/v1/agenda/microsoft/callback",
    );
  });

  it("só link da própria Graph recebe o token", () => {
    expect(linkDaGraph("https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=x")).not.toBeNull();
    expect(linkDaGraph("https://graph.microsoft.com.evil.com/v1.0/x")).toBeNull();
    expect(linkDaGraph("http://graph.microsoft.com/v1.0/x")).toBeNull();
  });
});

describe("a leitura do evento do Outlook como ocupação", () => {
  const SP = "America/Sao_Paulo";
  const evento = (e: Partial<EventoDaMicrosoft>): EventoDaMicrosoft => ({ id: "ev-1", ...e }) as EventoDaMicrosoft;

  it("horário em UTC sem deslocamento é lido como UTC", () => {
    const r = doEventoDaMicrosoft(
      evento({
        start: { dateTime: "2026-10-15T17:00:00.0000000", timeZone: "UTC" },
        end: { dateTime: "2026-10-15T18:00:00.0000000", timeZone: "UTC" },
        showAs: "busy",
      }),
      { fusoDoCalendario: SP },
    );
    expect(r).toMatchObject({ tipo: "evento", evento: { inicio: "2026-10-15T17:00:00.000Z", fim: "2026-10-15T18:00:00.000Z", transparencia: "opaque", ocupa: true } });
  });

  it("apagado na delta (@removed) e cancelado saem, sem exigir horário", () => {
    expect(doEventoDaMicrosoft(evento({ "@removed": { reason: "deleted" } }), { fusoDoCalendario: SP })).toEqual({
      tipo: "cancelado",
      externalEventId: "ev-1",
    });
    expect(doEventoDaMicrosoft(evento({ isCancelled: true }), { fusoDoCalendario: SP }).tipo).toBe("cancelado");
  });

  it("'Disponível', 'Trabalhando em outro lugar' e convite recusado não ocupam", () => {
    const base = {
      start: { dateTime: "2026-10-15T12:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-10-15T13:00:00.0000000", timeZone: "UTC" },
    };
    for (const e of [
      evento({ ...base, showAs: "free" }),
      evento({ ...base, showAs: "workingElsewhere" }),
      evento({ ...base, showAs: "busy", responseStatus: { response: "declined" } }),
    ]) {
      const r = doEventoDaMicrosoft(e, { fusoDoCalendario: SP });
      expect(r.tipo === "evento" && r.evento.ocupa).toBe(false);
    }
    const provisorio = doEventoDaMicrosoft(evento({ ...base, showAs: "tentative" }), { fusoDoCalendario: SP });
    expect(provisorio).toMatchObject({ evento: { situacao: "tentative", ocupa: true } });
  });

  it("dia inteiro é o dia no fuso da agenda, com o fim exclusivo", () => {
    const r = doEventoDaMicrosoft(
      evento({
        isAllDay: true,
        start: { dateTime: "2026-10-15T00:00:00.0000000", timeZone: "UTC" },
        end: { dateTime: "2026-10-16T00:00:00.0000000", timeZone: "UTC" },
      }),
      { fusoDoCalendario: SP },
    );
    expect(r).toMatchObject({ evento: { inicio: "2026-10-15T03:00:00.000Z", fim: "2026-10-16T03:00:00.000Z", dia_inteiro: true } });
  });

  it("fuso em nome do Windows (que o Intl não conhece) é recusado com nome, nunca adivinhado", () => {
    const r = doEventoDaMicrosoft(
      evento({
        start: { dateTime: "2026-10-15T14:00:00", timeZone: "E. South America Standard Time" },
        end: { dateTime: "2026-10-15T15:00:00", timeZone: "E. South America Standard Time" },
      }),
      { fusoDoCalendario: SP },
    );
    expect(r).toMatchObject({ tipo: "recusado", motivo: "fuso_invalido" });
  });
});

describe("a escrita e a comparação de três vias", () => {
  const compromisso: CompromissoParaMicrosoft = {
    id: "8f7c1f0e-0000-4000-8000-000000000001",
    organization_id: "8f7c1f0e-0000-4000-8000-0000000000aa",
    title: "Reunião de proposta",
    description: "Levar a planilha",
    starts_at: "2026-10-15T17:00:00.000Z",
    ends_at: "2026-10-15T18:00:00.000Z",
    time_zone: "America/Sao_Paulo",
    status: "confirmed",
    location_kind: "video_link",
    location_details: "Microsoft Teams",
    teams: true,
  };

  it("o corpo vai em UTC, com transactionId, a propriedade do compromisso e o pedido de Teams", () => {
    const corpo = paraEventoDaMicrosoft(compromisso, { transactionId: "tx-1", pedirTeams: true });
    expect(corpo).toMatchObject({
      subject: "Reunião de proposta",
      start: { dateTime: "2026-10-15T17:00:00.000", timeZone: "UTC" },
      transactionId: "tx-1",
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
      location: { displayName: "Microsoft Teams" },
    });
    expect(JSON.stringify(corpo)).toContain(PROPRIEDADE_COMPROMISSO);
  });

  it("o Outlook acrescentar o bloco do Teams na descrição não é conflito", () => {
    const local = projecaoLocalMicrosoft(compromisso);
    const remoto: EventoDaMicrosoft = {
      id: "ev",
      subject: "Reunião de proposta",
      body: { content: "Levar a planilha\n\n________________\nReunião do Microsoft Teams\nIngressar: https://teams.microsoft.com/l/meetup-join/x" },
      start: { dateTime: "2026-10-15T17:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-10-15T18:00:00.0000000", timeZone: "UTC" },
      location: { displayName: "Microsoft Teams" },
    } as EventoDaMicrosoft;
    const projecao = projecaoRemotaMicrosoft(remoto, local, null, { descricaoLocal: "Levar a planilha", fuso: "America/Sao_Paulo" });
    expect(compare(null, local, projecao).kind).toBe("converged");
  });

  it("remarcado no Outlook e intocado aqui: aceita o horário de lá", () => {
    const local = projecaoLocalMicrosoft(compromisso);
    const remoto = {
      id: "ev",
      subject: "Reunião de proposta",
      body: { content: "Levar a planilha" },
      start: { dateTime: "2026-10-15T19:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-10-15T20:00:00.0000000", timeZone: "UTC" },
      location: { displayName: "Microsoft Teams" },
    } as EventoDaMicrosoft;
    const antes = projecaoRemotaMicrosoft({ ...remoto, start: { dateTime: "2026-10-15T17:00:00", timeZone: "UTC" }, end: { dateTime: "2026-10-15T18:00:00", timeZone: "UTC" } } as EventoDaMicrosoft, local, null, { descricaoLocal: "Levar a planilha", fuso: "America/Sao_Paulo" });
    const base = checkpoint(null, local, antes, ["title", "description", "location", "guest"], true);
    const depois = projecaoRemotaMicrosoft(remoto, local, base, { descricaoLocal: "Levar a planilha", fuso: "America/Sao_Paulo" });
    expect(compare(base, local, depois).kind).toBe("accept_remote");
  });

  it("o PATCH leva só o que mudou e não derruba convidado de fora", () => {
    const patch = deltaMicrosoft(
      { ...compromisso, guest_email: "socio@cliente.com.br" },
      { id: "ev", attendees: [{ emailAddress: { address: "outro@cliente.com.br" }, type: "required" }] } as EventoDaMicrosoft,
      null,
      ["guest"],
      false,
    );
    expect(patch).not.toHaveProperty("start");
    expect((patch.attendees as Array<{ emailAddress: { address: string } }>).map((a) => a.emailAddress.address)).toEqual([
      "outro@cliente.com.br",
      "socio@cliente.com.br",
    ]);
  });
});

describe("o mapa de desfechos da Microsoft", () => {
  it("delta expirada recomeça; exclusão que não acha o evento já está feita", () => {
    expect(classificarErroDaMicrosoft(new GraphHttpError(410, null, { error: { code: "SyncStateNotFound" } }), "sincronizar").desfecho).toBe("ressincronizar");
    expect(classificarErroDaMicrosoft(new GraphHttpError(404), "apagar").desfecho).toBe("ja_esta_feito");
    expect(classificarErroDaMicrosoft(new GraphHttpError(404), "criar").desfecho).toBe("calendario_sumiu");
  });

  it("autorização revogada pede reconexão; limite pede espera; rede é passageira", () => {
    expect(classificarErroDaMicrosoft({ error: "invalid_grant" }, "token").desfecho).toBe("reautenticar");
    expect(classificarErroDaMicrosoft({ error: "interaction_required" }, "token").desfecho).toBe("reautenticar");
    expect(classificarErroDaMicrosoft(new GraphHttpError(429, 30), "sincronizar")).toMatchObject({ desfecho: "recuar", esperarSegundos: 30 });
    expect(classificarErroDaMicrosoft({ error: "temporarily_unavailable" }, "token").desfecho).toBe("transitorio");
    expect(classificarErroDaMicrosoft({}, "token").desfecho).toBe("transitorio");
    expect(classificarErroDaMicrosoft({ error: "invalid_client" }, "token").desfecho).toBe("permanente");
  });

  it("a frase gravada leva o código, nunca o texto livre da Microsoft", () => {
    const c = classificarErroDaMicrosoft(
      new GraphHttpError(400, null, { error: { code: "ErrorInvalidRecipients", message: "ana@cliente.com.br é inválido" } }),
      "criar",
    );
    expect(c.mensagem).toContain("errorinvalidrecipients");
    expect(c.mensagem).not.toContain("ana@cliente.com.br");
  });
});
