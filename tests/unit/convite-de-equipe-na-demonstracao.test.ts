/**
 * FORK MIA (9020) — O CONVITE DE EQUIPE FUNCIONA NA EMPRESA DE DEMONSTRAÇÃO.
 *
 * ── De onde isto veio ─────────────────────────────────────────────────────
 *
 * Em 07/10/2026, convidar uma pessoa pela tela Convidar membros de uma empresa
 * de demonstração respondia "Erro interno". A trava da demonstração tratava o
 * convite como mais uma saída: o roteador de e-mail recusava o envio, a
 * auditoria `member.invited` era gravada assim mesmo, o banco recusava a linha
 * em `team_invites` e a rota devolvia 500.
 *
 * A decisão do Gabriel: convite de equipe funciona na demonstração como em
 * qualquer empresa. A trava é para nada chegar aos contatos fictícios nem a um
 * destino de fora; convite é o sistema falando com uma pessoa de verdade que
 * quem administra escolheu.
 *
 * ── O que este arquivo prova ──────────────────────────────────────────────
 *
 *  1. A exceção do e-mail tem UM chamador (`issueInvite`), pelo nome, e nenhum
 *     outro e-mail da demonstração sai por ela.
 *  2. `issueInvite`, com o roteador de verdade, manda o convite de uma empresa
 *     de demonstração; no mesmo cenário, outro e-mail segue recusado.
 *  3. `emitirConvite` grava a LINHA antes do e-mail e da auditoria; linha que o
 *     banco recusa não deixa e-mail nem auditoria para trás.
 *  4. A rota devolve o convite criado numa demonstração, e transforma a linha
 *     recusada num item de `failed` com motivo, sem derrubar o lote.
 *  5. A tela tem a frase do motivo e o aviso da demonstração, nos dois idiomas.
 *
 * O banco (o gatilho que saiu, e os que ficaram) é provado em
 * `tests/invariants/empresa-de-demonstracao-nao-envia.test.ts`; o roteador de
 * e-mail sozinho, em `tests/unit/cliente-modelo-trava.test.ts`.
 *
 * Sem dado de ninguém: empresa fictícia e e-mails `@exemplo.invalid`.
 */
import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyInviteToken } from "@/lib/auth/invite-token";
import { traduzir } from "@/lib/i18n/dicionario";
import { ConviteNaoGravadoError, MOTIVO_CONVITE_NAO_GRAVADO } from "@/lib/team/convite-nao-gravado";
import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";

import { arquivosDeCodigo, caminhoRelativo } from "./helpers/varrer-codigo";

const h = vi.hoisted(() => ({
  ORG: "90209020-0000-4000-8000-00000000000d",
  ADMIN: "90209020-1111-4000-8000-00000000000a",
  cliente: null as unknown,
  /** A ORDEM do que aconteceu: `linha`, `email`, `auditoria:<ação>`. */
  eventos: [] as string[],
  auditorias: [] as Array<Record<string, unknown>>,
  emails: [] as Array<Record<string, unknown>>,
}));
const { ORG, ADMIN } = h;

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (entrada: Record<string, unknown>) => {
    h.eventos.push(`auditoria:${String(entrada.action)}`);
    h.auditorias.push(entrada);
  }),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
// Os dois transportes são dublês: o que chega a eles é o que SAIU. O roteador é o de verdade.
vi.mock("@/lib/email/config", () => ({ getSmtpConfig: async () => ({ host: "smtp.invalid" }) }));
vi.mock("@/lib/email/smtp", () => ({
  isSmtpConfigured: () => true,
  sendEmail: vi.fn(async (envio: Record<string, unknown>) => {
    h.eventos.push("email");
    h.emails.push(envio);
    return { ok: true, id: "smtp-ficticio" };
  }),
}));
vi.mock("@/lib/email/resend", () => ({
  isEmailConfigured: async () => true,
  sendEmail: vi.fn(async () => ({ ok: true, id: "resend-ficticio" })),
}));
vi.mock("@/lib/branding/saida", () => ({ marcaDaSaida: async () => ({ nome: "Plataforma Exemplo" }) }));
vi.mock("@/lib/email/templates/invite", () => ({
  buildInviteEmail: (o: { acceptUrl: string }) => ({
    subject: "Convite para a equipe",
    html: `<a href="${o.acceptUrl}">entrar</a>`,
    text: o.acceptUrl,
  }),
}));
// A rota: quem chama é uma pessoa logada que administra a empresa.
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({
    ok: true,
    user: { id: h.ADMIN, email: "quem-administra@exemplo.invalid", full_name: "Pessoa Que Administra", idioma: "pt-BR" },
    org: { orgId: h.ORG, name: "Empresa de Demonstração Exemplo", role: "admin" },
  }),
}));

const { sendEmail } = await import("@/lib/email/roteador");
const { issueInvite } = await import("@/lib/auth/issue-invite");
const { emitirConvite } = await import("@/lib/team/convites");
const { POST } = await import("@/app/api/v1/team/invite/route");
const { descreverMotivoDaFalha } = await import("@/app/app/team/invite/_components/motivo-da-falha");
const { AvisoDeConviteNaDemonstracao } = await import(
  "@/app/app/team/invite/_components/AvisoDeConviteNaDemonstracao"
);

const RECUSA_DO_BANCO = { code: "42501", message: "recusado pelo banco" };

interface OpcoesDoCenario {
  demonstracao: boolean;
  /** O banco recusa a linha do convite deste e-mail. */
  recusarLinhaDe?: string;
  /** Ler `team_invites` lança (rede fora do ar): um erro que NÃO é a recusa da gravação. */
  leituraLanca?: boolean;
}

/** Uma empresa fictícia, com quem administra dentro dela e nenhum convite. */
function cenario(opcoes: OpcoesDoCenario) {
  const banco = bancoEmMemoria(
    {
      organizations: [{ id: ORG, display_name: "Empresa de Demonstração Exemplo", demonstracao: opcoes.demonstracao }],
      user_organizations: [{ id: "90209020-2222-4000-8000-00000000000a", organization_id: ORG, user_id: ADMIN, role: "admin", revoked_at: null }],
      team_invites: [],
    },
    {
      fn_mia_e_demonstracao: (args, db) => ({
        data: (db.organizations ?? []).find((o) => o.id === args.p_org)?.demonstracao === true,
        error: null,
      }),
    },
  );
  const deVerdade = banco.cliente.from.bind(banco.cliente);
  h.cliente = Object.assign(banco.cliente, {
    from: (nome: string) => {
      const consulta = deVerdade(nome) as Record<string, unknown>;
      if (nome !== "team_invites") return consulta;
      if (opcoes.leituraLanca) {
        consulta.select = () => {
          throw new Error("rede fora do ar");
        };
      }
      const inserir = consulta.insert as (p: Linha) => unknown;
      consulta.insert = (p: Linha) => {
        if (p.email === opcoes.recusarLinhaDe) {
          return { select: () => ({ single: async () => ({ data: null, error: RECUSA_DO_BANCO }) }) };
        }
        h.eventos.push("linha");
        return inserir(p);
      };
      return consulta;
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: id === ADMIN ? { id, email: "quem-administra@exemplo.invalid" } : null },
          error: null,
        }),
      },
    },
  });
  return { banco, convites: () => banco.tabela("team_invites") as Linha[] };
}

const PEDIDO_DE_CONVITE = {
  email: "convidada@exemplo.invalid",
  role: "agent" as const,
  organizationId: ORG,
  orgName: "Empresa de Demonstração Exemplo",
  inviterId: ADMIN,
  inviterName: "Pessoa Que Administra",
  requestId: "req-9020",
};

function pedidoHttp(emails: string[]): never {
  return new Request("https://app.exemplo.invalid/api/v1/team/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invitations: emails.map((email) => ({ email, role: "agent" })) }),
  }) as never;
}

const auditoriasDeConvite = () => h.auditorias.filter((a) => a.action === "member.invited");

beforeEach(() => {
  h.eventos.length = 0;
  h.auditorias.length = 0;
  h.emails.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("a exceção da trava no e-mail tem UM chamador, pelo nome", () => {
  const CAMPO = "excecaoDaTravaDaDemonstracao";

  /** O CÓDIGO do arquivo, sem comentário: prosa que cita o campo não é chamador. */
  function codigoDe(fonte: string): string {
    const arquivo = ts.createSourceFile("x.tsx", fonte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return ts.createPrinter({ removeComments: true }).printFile(arquivo);
  }

  const quemUsa = () =>
    arquivosDeCodigo(["app", "lib", "components", "hooks", "workers", "scripts"])
      .filter((arquivo) => {
        const fonte = readFileSync(arquivo, "utf8");
        // O texto primeiro (barato); o código sem comentário só em quem cita.
        return fonte.includes(CAMPO) && codigoDe(fonte).includes(CAMPO);
      })
      .map(caminhoRelativo)
      .sort();

  it("CONTROLE: a varredura acha quem declara a exceção, e não conta comentário", () => {
    // Instrumento que não acha nada dá verde igual: o roteador tem de aparecer.
    expect(quemUsa()).toContain("lib/email/roteador.ts");
    expect(codigoDe(`// ${CAMPO} só em prosa\nexport const x = 1;`)).not.toContain(CAMPO);
    expect(codigoDe(`enviar({ ${CAMPO}: "convite_de_equipe" });`)).toContain(CAMPO);
  });

  it("⭐ só `issueInvite` pede a exceção: um segundo chamador reprova aqui", () => {
    expect(
      quemUsa(),
      "outro arquivo passou a usar a exceção da trava de e-mail da demonstração. Ela é só do convite de equipe: " +
        "qualquer outro e-mail de uma empresa de demonstração continua recusado (docs/fork/cliente-modelo.md).",
    ).toEqual(["lib/auth/issue-invite.ts", "lib/email/roteador.ts"]);
  });

  it("⭐ e pede uma vez só, com o valor nomeado", () => {
    const codigo = codigoDe(readFileSync("lib/auth/issue-invite.ts", "utf8"));
    expect(codigo.split(CAMPO).length - 1).toBe(1);
    expect(codigo).toContain(`${CAMPO}: "convite_de_equipe"`);
  });
});

// ---------------------------------------------------------------------------

describe("o e-mail do convite sai da empresa de demonstração, e só ele", () => {
  it("⭐ `issueInvite` manda o convite de uma demonstração pelo transporte, e audita que saiu", async () => {
    const { banco } = cenario({ demonstracao: true });

    const emitido = await issueInvite(PEDIDO_DE_CONVITE);

    expect(emitido.email_dispatched).toBe(true);
    expect(emitido.email_error).toBeUndefined();
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0]).toMatchObject({ to: "convidada@exemplo.invalid", subject: "Convite para a equipe" });
    // Nenhum campo do fork chega ao transporte.
    expect(h.emails[0]).not.toHaveProperty("organizationId");
    expect(h.emails[0]).not.toHaveProperty("excecaoDaTravaDaDemonstracao");
    // O convite sai de qualquer empresa: o roteador nem pergunta se é demonstração.
    expect(banco.chamadasRpc).toEqual([]);
    expect(auditoriasDeConvite()).toHaveLength(1);
    expect(auditoriasDeConvite()[0]!.metadata).toMatchObject({ email_dispatched: true, email_error: null, email_via: "smtp" });
  });

  it("⭐ CONTROLE: na MESMA demonstração, um e-mail que não é o convite segue recusado", async () => {
    const { banco } = cenario({ demonstracao: true });

    const r = await sendEmail({
      to: "titular@exemplo.invalid",
      subject: "Seus dados",
      html: "<p>relatório</p>",
      organizationId: ORG,
    });

    expect(r).toMatchObject({ ok: false, error: "organizacao_de_demonstracao", details: "demonstracao" });
    expect(h.emails).toEqual([]);
    expect(banco.chamadasRpc.map((c) => c.nome)).toEqual(["fn_mia_e_demonstracao"]);
  });

  it("controle: na empresa de verdade o convite sai igual", async () => {
    cenario({ demonstracao: false });
    const emitido = await issueInvite(PEDIDO_DE_CONVITE);
    expect(emitido.email_dispatched).toBe(true);
    expect(h.emails).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("emitirConvite: a linha nasce ANTES do e-mail e da auditoria", () => {
  it("⭐ a ordem é linha, e-mail, auditoria; e a linha termina dizendo que o e-mail saiu", async () => {
    const { convites } = cenario({ demonstracao: true });

    const r = await emitirConvite(h.cliente as never, PEDIDO_DE_CONVITE);

    expect(h.eventos).toEqual(["linha", "email", "auditoria:member.invited"]);
    expect(r.email_dispatched).toBe(true);
    expect(convites()).toHaveLength(1);
    expect(convites()[0]).toMatchObject({
      id: r.convite.id,
      organization_id: ORG,
      email: "convidada@exemplo.invalid",
      role: "agent",
      invited_by: ADMIN,
      email_dispatched: true,
    });
    // O link do e-mail é o do convite gravado: mesmo id, mesma empresa, mesmo prazo.
    const token = String(h.emails[0]!.text).split("/").at(-1)!;
    const lido = verifyInviteToken(token);
    expect(lido).toMatchObject({ invite_id: r.convite.id, organization_id: ORG, role: "agent" });
    expect(new Date(lido!.exp * 1000).toISOString()).toBe(convites()[0]!.expires_at);
    expect(r.accept_url.endsWith(token)).toBe(true);
  });

  it("⭐ linha que o banco recusa: erro com nome, NENHUM e-mail e NENHUMA auditoria", async () => {
    const { convites } = cenario({ demonstracao: true, recusarLinhaDe: "convidada@exemplo.invalid" });

    const erro = await emitirConvite(h.cliente as never, PEDIDO_DE_CONVITE).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ConviteNaoGravadoError);
    expect((erro as ConviteNaoGravadoError).email).toBe("convidada@exemplo.invalid");
    expect((erro as ConviteNaoGravadoError).codigoDoBanco).toBe("42501");
    expect((erro as ConviteNaoGravadoError).message).toContain("recusado pelo banco");
    // Antes da 9020 o e-mail e a auditoria saíam ANTES de a linha ser tentada.
    expect(h.eventos).toEqual([]);
    expect(convites()).toEqual([]);
  });

  it("e-mail que não sai (instalação sem transporte funcionando): a linha existe e diz que não saiu", async () => {
    const { convites } = cenario({ demonstracao: true });
    const { sendEmail: smtp } = await import("@/lib/email/smtp");
    vi.mocked(smtp).mockResolvedValueOnce({ ok: false, error: "send_failed" } as never);

    const r = await emitirConvite(h.cliente as never, PEDIDO_DE_CONVITE);

    expect(r.email_dispatched).toBe(false);
    expect(r.email_error).toBe("send_failed");
    expect(convites()).toHaveLength(1);
    expect(convites()[0]).toMatchObject({ email_dispatched: false });
    expect(auditoriasDeConvite()[0]!.metadata).toMatchObject({ email_dispatched: false, email_error: "send_failed" });
  });
});

// ---------------------------------------------------------------------------

describe("POST /api/v1/team/invite", () => {
  it("⭐ na empresa de demonstração devolve o convite criado: 201, a linha gravada e o e-mail enviado", async () => {
    const { convites } = cenario({ demonstracao: true });

    const resposta = await POST(pedidoHttp(["Convidada@Exemplo.invalid"]));
    const corpo = (await resposta.json()) as { data: { sent: Array<Record<string, unknown>>; failed: unknown[] } };

    expect(resposta.status).toBe(201);
    expect(corpo.data.failed).toEqual([]);
    expect(corpo.data.sent).toHaveLength(1);
    expect(convites()).toHaveLength(1);
    expect(corpo.data.sent[0]).toMatchObject({
      email: "convidada@exemplo.invalid",
      invite_id: convites()[0]!.id,
      email_dispatched: true,
    });
    expect(String(corpo.data.sent[0]!.accept_url)).toContain("/team/accept-invite/");
    expect(convites()[0]).toMatchObject({ organization_id: ORG, role: "agent", invited_by: ADMIN, email_dispatched: true });
    expect(h.emails).toHaveLength(1);
    expect(auditoriasDeConvite()).toHaveLength(1);
    expect(auditoriasDeConvite()[0]).toMatchObject({ organizationId: ORG, resourceId: convites()[0]!.id });
  });

  it("controle: na empresa de verdade a resposta tem a mesma forma", async () => {
    const { convites } = cenario({ demonstracao: false });

    const resposta = await POST(pedidoHttp(["convidada@exemplo.invalid"]));
    const corpo = (await resposta.json()) as { data: { sent: Array<Record<string, unknown>>; failed: unknown[] } };

    expect(resposta.status).toBe(201);
    expect(corpo.data.sent[0]).toMatchObject({ invite_id: convites()[0]!.id, email_dispatched: true });
    expect(corpo.data.failed).toEqual([]);
  });

  it("⭐ linha que o banco recusa vira item de `failed` com motivo: sem 500, sem e-mail, sem auditoria, e o lote segue", async () => {
    const erroNoConsole = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { convites } = cenario({ demonstracao: true, recusarLinhaDe: "recusada@exemplo.invalid" });

    const resposta = await POST(pedidoHttp(["recusada@exemplo.invalid", "aceita@exemplo.invalid"]));
    const corpo = (await resposta.json()) as { data: { sent: Array<Record<string, unknown>>; failed: unknown[] } };

    expect(resposta.status).toBe(201);
    expect(corpo.data.failed).toEqual([{ email: "recusada@exemplo.invalid", reason: MOTIVO_CONVITE_NAO_GRAVADO }]);
    expect(corpo.data.sent.map((s) => s.email)).toEqual(["aceita@exemplo.invalid"]);
    // Nada ficou para trás em nome de quem não tem convite.
    expect(convites().map((c) => c.email)).toEqual(["aceita@exemplo.invalid"]);
    expect(h.emails.map((e) => e.to)).toEqual(["aceita@exemplo.invalid"]);
    expect(auditoriasDeConvite().map((a) => (a.metadata as { email: string }).email)).toEqual(["aceita@exemplo.invalid"]);
    // O registro do servidor diz o que o banco respondeu, e não leva o e-mail de ninguém.
    const registro = erroNoConsole.mock.calls.map((c) => String(c[0])).join("\n");
    expect(registro).toContain("o convite não foi gravado");
    expect(registro).toContain("42501");
    expect(registro).not.toContain("exemplo.invalid");
  });

  it("CONTROLE NEGATIVO: erro que não é a recusa da gravação continua subindo (a rota não engole qualquer coisa)", async () => {
    cenario({ demonstracao: true, leituraLanca: true });

    await expect(POST(pedidoHttp(["convidada@exemplo.invalid"]))).rejects.toThrow("rede fora do ar");
    expect(h.eventos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("a tela Convidar membros", () => {
  const AVISO = "Esta é a empresa de demonstração. O convite dá acesso a ela, e nada mais sai daqui.";

  it("o motivo `convite_nao_gravado` tem frase, e a frase tem espanhol", () => {
    // O código que a rota devolve é o que a tabela da tela conhece.
    expect(MOTIVO_CONVITE_NAO_GRAVADO).toBe("convite_nao_gravado");
    const frase = descreverMotivoDaFalha(MOTIVO_CONVITE_NAO_GRAVADO);
    expect(frase).not.toBe(MOTIVO_CONVITE_NAO_GRAVADO);
    expect(frase).toContain("nenhum e-mail foi enviado");
    expect(traduzir(frase, "es")).not.toBe(frase);
    // Controle: código desconhecido continua aparecendo como veio.
    expect(descreverMotivoDaFalha("codigo_que_nao_existe")).toBe("codigo_que_nao_existe");
  });

  it("⭐ na empresa de demonstração a tela avisa que o convite dá acesso a ela e que nada mais sai", async () => {
    cenario({ demonstracao: true });
    const html = renderToStaticMarkup(await AvisoDeConviteNaDemonstracao({ organizationId: ORG, idioma: "pt-BR" }));
    expect(html).toContain(AVISO);
    expect(html).toContain("data-aviso-de-convite-na-demonstracao");
  });

  it("o aviso fala espanhol", async () => {
    cenario({ demonstracao: true });
    const html = renderToStaticMarkup(await AvisoDeConviteNaDemonstracao({ organizationId: ORG, idioma: "es" }));
    expect(traduzir(AVISO, "es")).not.toBe(AVISO);
    expect(html).toContain("La invitación da acceso a ella");
    expect(html).not.toContain("O convite dá acesso");
  });

  it("CONTROLE: na empresa de verdade não há aviso nenhum", async () => {
    cenario({ demonstracao: false });
    expect(await AvisoDeConviteNaDemonstracao({ organizationId: ORG, idioma: "pt-BR" })).toBeNull();
  });

  it("se a leitura da marca falhar, o aviso some e a tela não quebra", async () => {
    h.cliente = {
      from: () => {
        throw new Error("fora do ar");
      },
    };
    expect(await AvisoDeConviteNaDemonstracao({ organizationId: ORG, idioma: "pt-BR" })).toBeNull();
  });
});
