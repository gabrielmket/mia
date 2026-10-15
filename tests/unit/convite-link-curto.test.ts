/**
 * FORK MIA (9023) — O LINK CURTO DO CONVITE DE EQUIPE (`/c/<código>`).
 *
 * O pedido: o link do convite (`/team/accept-invite/<token>`, 300+ caracteres)
 * ficava ilegível no WhatsApp. O desenho está em `lib/team/link-curto.ts`.
 *
 * O que este arquivo prova:
 *
 *  1. O código: 12 caracteres de um alfabeto sem ambíguos, sorteado; a forma
 *     é conferida antes de qualquer consulta; o hash é um HMAC de 64 hex que
 *     depende do segredo do servidor e não contém o código.
 *  2. A emissão: o convite novo nasce com o hash na linha (nunca o código), o
 *     e-mail leva o link curto, e reemitir ou reenviar troca o código (o
 *     anterior morre). O reenvio grava o código ANTES de o e-mail sair.
 *  3. A resolução: pendente resolve; vencido, aceito, revogado, inexistente e
 *     malformado não, e todos com a MESMA resposta.
 *  4. A página `/c/<código>`: só lê (abrir não consome o convite, nem muda a
 *     linha), redireciona para o aceite de sempre com um token do mesmo
 *     convite, conta a tentativa no teto por IP do limitador do login (o 61º
 *     pedido do mesmo IP leva "Muitas tentativas", mesmo com código bom) e não
 *     tem metadado próprio.
 *  5. "Copiar link do convite": gera código novo, o anterior (inclusive o do
 *     e-mail) deixa de valer, audita quem e qual convite sem o código, e
 *     recusa o que não está pendente. A rota pede a permissão de reenviar e
 *     revogar (admin) e respeita o acompanhamento só-leitura.
 *  6. A rota é pública, num segmento só.
 *
 * Sem dado de ninguém: empresa fictícia e e-mails `@exemplo.invalid`.
 */
import { readFileSync } from "node:fs";

import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { verifyInviteToken } from "@/lib/auth/invite-token";
import { isPublicPath } from "@/lib/auth/public-paths";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { traduzir } from "@/lib/i18n/dicionario";
import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  ORG: "90239023-0000-4000-8000-00000000000a",
  OUTRA_ORG: "90239023-0000-4000-8000-00000000000b",
  ADMIN: "90239023-1111-4000-8000-00000000000a",
  APP: "https://app.exemplo.invalid",
  cliente: null as unknown,
  /** A ORDEM do que aconteceu na emissão: `hash`, `email`. */
  eventos: [] as string[],
  emails: [] as Array<Record<string, unknown>>,
  auditorias: [] as Array<Record<string, unknown>>,
  leituras: 0,
  ip: "203.0.113.1" as string | null,
  aceitaIdioma: "pt-BR",
  serviceRole: true,
  papel: "admin" as "admin" | "manager",
  suporteSoLeitura: false,
}));
const { ORG, OUTRA_ORG, ADMIN, APP } = h;

vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: h.APP } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (entrada: Record<string, unknown>) => {
    h.auditorias.push(entrada);
  }),
  isServiceRoleConfigured: () => h.serviceRole,
  hashEmail: (e: string) => e,
}));
vi.mock("@/lib/email/roteador", () => ({
  sendEmail: vi.fn(async (envio: Record<string, unknown>) => {
    h.eventos.push("email");
    h.emails.push(envio);
    return { ok: true, via: "smtp" };
  }),
}));
vi.mock("@/lib/branding/saida", () => ({ marcaDaSaida: async () => ({ nome: "Plataforma Exemplo" }) }));
vi.mock("@/lib/email/templates/invite", () => ({
  buildInviteEmail: (o: { acceptUrl: string }) => ({ subject: "Convite", html: `<a href="${o.acceptUrl}">entrar</a>`, text: o.acceptUrl }),
}));
// O limitador é o DE VERDADE (`lib/auth/rate-limit.ts`, contador em memória sem
// Redis); só o cabeçalho do IP é o do teste.
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      "accept-language": h.aceitaIdioma,
      ...(h.ip ? { "x-forwarded-for": h.ip } : {}),
    }),
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { destino });
  },
}));
vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: async () =>
    h.suporteSoLeitura ? new Response(JSON.stringify({ error: { code: "support_read_only" } }), { status: 403 }) : null,
}));
// A régua de papéis de verdade, num ponto só: quem pede menos que o exigido é recusado.
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async (minimo: string) => {
    const ordem = ["viewer", "agent", "manager", "admin"];
    if (ordem.indexOf(h.papel) < ordem.indexOf(minimo)) {
      return { ok: false, response: new Response(JSON.stringify({ error: { code: "forbidden" } }), { status: 403 }) };
    }
    return {
      ok: true,
      user: { id: h.ADMIN, email: "quem-administra@exemplo.invalid", full_name: "Pessoa Que Administra", idioma: "pt-BR" },
      org: { orgId: h.ORG, name: "Empresa Exemplo", role: h.papel },
    };
  }),
}));

const {
  ALFABETO_DO_LINK_CURTO,
  LIMITE_DO_LINK_CURTO,
  TAMANHO_DO_LINK_CURTO,
  gerarCodigoCurto,
  hashDoCodigoCurto,
  normalizarCodigoCurto,
  resolverLinkCurto,
  trocarLinkCurto,
} = await import("@/lib/team/link-curto");
const { emitirConvite, reenviarConvite } = await import("@/lib/team/convites");
const { default: PaginaDoLinkCurto } = await import("@/app/c/[codigo]/page");
const { POST: gerarLinkPelaRota } = await import("@/app/api/v1/team/invites/[id]/link-curto/route");
const { requireRole } = await import("@/lib/auth/require-role");

// ---------------------------------------------------------------------------

function cenario() {
  const banco = bancoEmMemoria({ team_invites: [] });
  const deVerdade = banco.cliente.from.bind(banco.cliente);
  h.cliente = Object.assign(banco.cliente, {
    from: (nome: string) => {
      h.leituras += 1;
      const consulta = deVerdade(nome) as Record<string, unknown>;
      if (nome !== "team_invites") return consulta;
      // A ordem da emissão: quando o hash do link curto é gravado.
      const atualizar = consulta.update as (p: Linha) => unknown;
      const inserir = consulta.insert as (p: Linha) => unknown;
      consulta.update = (p: Linha) => {
        if ("codigo_curto_hash" in p) h.eventos.push("hash");
        return atualizar(p);
      };
      consulta.insert = (p: Linha) => {
        if ("codigo_curto_hash" in p) h.eventos.push("hash");
        return inserir(p);
      };
      return consulta;
    },
  });
  return { banco, convites: () => banco.tabela("team_invites") as Linha[] };
}

const PEDIDO = {
  email: "convidada@exemplo.invalid",
  role: "agent" as const,
  organizationId: ORG,
  orgName: "Empresa Exemplo",
  inviterId: ADMIN,
  inviterName: "Pessoa Que Administra",
  requestId: "req-9023",
};

const codigoDe = (link: string | undefined) => String(link).split("/c/").at(-1)!;

/** Abre `/c/<código>` como o navegador (ou o verificador do Outlook) abriria. */
async function abrir(codigo: string): Promise<{ destino: string | null; html: string; elemento: ReactElement | null }> {
  try {
    const elemento = (await PaginaDoLinkCurto({ params: Promise.resolve({ codigo }) })) as ReactElement;
    return { destino: null, html: renderToStaticMarkup(elemento), elemento };
  } catch (err) {
    const destino = (err as { destino?: string }).destino;
    if (!destino) throw err;
    return { destino, html: "", elemento: null };
  }
}

let ipSeguinte = 10;
beforeEach(() => {
  h.eventos.length = 0;
  h.emails.length = 0;
  h.auditorias.length = 0;
  h.leituras = 0;
  // Um IP por caso: o contador do limitador vive no processo.
  h.ip = `198.51.100.${ipSeguinte++}`;
  h.aceitaIdioma = "pt-BR";
  h.serviceRole = true;
  h.papel = "admin";
  h.suporteSoLeitura = false;
});

// ---------------------------------------------------------------------------

describe("o código", () => {
  it("12 caracteres de um alfabeto de 31 sem os que se confundem (0, 1, i, l, o)", () => {
    expect(TAMANHO_DO_LINK_CURTO).toBe(12);
    expect(ALFABETO_DO_LINK_CURTO).toHaveLength(31);
    expect(ALFABETO_DO_LINK_CURTO).not.toMatch(/[01ilo]/);
    expect(new Set(ALFABETO_DO_LINK_CURTO).size).toBe(31);
    // ~59 bits: a conta do tamanho está no cabeçalho de lib/team/link-curto.ts.
    expect(TAMANHO_DO_LINK_CURTO * Math.log2(ALFABETO_DO_LINK_CURTO.length)).toBeGreaterThan(59);
  });

  it("é sorteado: 2.000 códigos, todos com a forma, nenhum repetido, e todo caractere do alfabeto aparece", () => {
    const codigos = Array.from({ length: 2000 }, () => gerarCodigoCurto());
    for (const c of codigos) expect(normalizarCodigoCurto(c)).toBe(c);
    expect(new Set(codigos).size).toBe(codigos.length);
    expect(new Set(codigos.join(""))).toEqual(new Set(ALFABETO_DO_LINK_CURTO));
  });

  it("a forma é conferida: maiúscula e espaço nas pontas valem; tamanho, caractere ambíguo e lixo não", () => {
    expect(normalizarCodigoCurto(" ABCD2345EFGH ")).toBe("abcd2345efgh");
    expect(normalizarCodigoCurto("abcd2345efg")).toBeNull(); // 11
    expect(normalizarCodigoCurto("abcd2345efghj")).toBeNull(); // 13
    expect(normalizarCodigoCurto("abcd2345efg0")).toBeNull(); // zero
    expect(normalizarCodigoCurto("abcd2345efgl")).toBeNull(); // l
    expect(normalizarCodigoCurto("abcd-345efgh")).toBeNull();
    expect(normalizarCodigoCurto(undefined)).toBeNull();
    expect(normalizarCodigoCurto(["abcd2345efgh"])).toBeNull();
  });

  it("o hash é um HMAC de 64 hex, estável, que não contém o código e muda com o segredo do servidor", () => {
    const codigo = "abcd2345efgh";
    const hash = hashDoCodigoCurto(codigo);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDoCodigoCurto(codigo)).toBe(hash);
    expect(hash).not.toContain(codigo);
    expect(hashDoCodigoCurto("abcd2345efgj")).not.toBe(hash);
    const antes = process.env.INVITE_TOKEN_SECRET;
    process.env.INVITE_TOKEN_SECRET = "outro-segredo-de-teste";
    try {
      expect(hashDoCodigoCurto(codigo)).not.toBe(hash);
    } finally {
      if (antes === undefined) delete process.env.INVITE_TOKEN_SECRET;
      else process.env.INVITE_TOKEN_SECRET = antes;
    }
  });

  it("a ação de auditoria existe no vocabulário canônico", () => {
    expect(AUDIT_ACTIONS).toContain("member.invite_link_created");
  });
});

// ---------------------------------------------------------------------------

describe("a emissão leva o link curto, e só o hash fica na linha", () => {
  it("⭐ convite novo: a linha nasce com o hash (nunca o código), e o e-mail leva o link curto que resolve para ela", async () => {
    const { convites } = cenario();
    const r = await emitirConvite(h.cliente as never, PEDIDO);

    expect(r.link_curto).toMatch(new RegExp(`^${APP}/c/[${ALFABETO_DO_LINK_CURTO}]{12}$`));
    const codigo = codigoDe(r.link_curto);
    expect(convites()[0]!.codigo_curto_hash).toBe(hashDoCodigoCurto(codigo));
    expect(JSON.stringify(convites())).not.toContain(codigo);
    // O hash nasce com a linha, ANTES do e-mail.
    expect(h.eventos).toEqual(["hash", "email"]);
    expect(h.emails[0]!.text).toBe(r.link_curto);
    expect(await resolverLinkCurto(h.cliente as never, codigo)).toMatchObject({ id: r.convite.id });
    // A auditoria da emissão diz que houve link curto, sem o código.
    const emitida = h.auditorias.find((a) => a.action === "member.invited")!;
    expect(emitida.metadata).toMatchObject({ link_curto: true });
    expect(JSON.stringify(h.auditorias)).not.toContain(codigo);
    // O link longo continua existindo e apontando para o mesmo convite (convites antigos e a tela).
    expect(verifyInviteToken(r.accept_url.split("/").at(-1)!)).toMatchObject({ invite_id: r.convite.id });
  });

  it("⭐ reconvidar o mesmo e-mail renova a linha com código NOVO: o link anterior morre", async () => {
    cenario();
    const primeiro = await emitirConvite(h.cliente as never, PEDIDO);
    const segundo = await emitirConvite(h.cliente as never, PEDIDO);
    expect(segundo.convite.id).toBe(primeiro.convite.id);
    expect(segundo.link_curto).not.toBe(primeiro.link_curto);
    expect(await resolverLinkCurto(h.cliente as never, codigoDe(primeiro.link_curto))).toBeNull();
    expect(await resolverLinkCurto(h.cliente as never, codigoDe(segundo.link_curto))).toMatchObject({ id: primeiro.convite.id });
  });

  it("⭐ reenviar grava o código novo ANTES do e-mail, e o e-mail leva o link novo", async () => {
    cenario();
    const emitido = await emitirConvite(h.cliente as never, PEDIDO);
    h.eventos.length = 0;
    h.emails.length = 0;

    const reenviado = await reenviarConvite(h.cliente as never, {
      convite: emitido.convite,
      orgName: "Empresa Exemplo",
      actorId: ADMIN,
      actorName: "Pessoa Que Administra",
      requestId: "req-9023-reenvio",
    });

    expect(h.eventos).toEqual(["hash", "email"]);
    expect(reenviado!.link_curto).not.toBe(emitido.link_curto);
    expect(h.emails[0]!.text).toBe(reenviado!.link_curto);
    expect(await resolverLinkCurto(h.cliente as never, codigoDe(emitido.link_curto))).toBeNull();
    expect(await resolverLinkCurto(h.cliente as never, codigoDe(reenviado!.link_curto))).toMatchObject({ id: emitido.convite.id });
  });

  it("reenviar um convite que foi revogado no meio do caminho: nada sai e nada muda", async () => {
    const { convites } = cenario();
    const emitido = await emitirConvite(h.cliente as never, PEDIDO);
    const hashAntes = convites()[0]!.codigo_curto_hash;
    convites()[0]!.revoked_at = new Date().toISOString();
    h.emails.length = 0;

    const r = await reenviarConvite(h.cliente as never, {
      convite: emitido.convite,
      orgName: "Empresa Exemplo",
      actorId: ADMIN,
      actorName: "Pessoa Que Administra",
      requestId: "req-9023-corrida",
    });

    expect(r).toBeNull();
    expect(h.emails).toEqual([]);
    expect(convites()[0]!.codigo_curto_hash).toBe(hashAntes);
  });
});

// ---------------------------------------------------------------------------

describe("a resolução: só o convite pendente, e a mesma resposta para todo o resto", () => {
  async function convitePendente() {
    const { convites } = cenario();
    const r = await emitirConvite(h.cliente as never, PEDIDO);
    return { codigo: codigoDe(r.link_curto), linha: convites()[0]!, id: r.convite.id };
  }

  it("pendente resolve; vencido, aceito e revogado não", async () => {
    const { codigo, linha, id } = await convitePendente();
    expect(await resolverLinkCurto(h.cliente as never, codigo)).toMatchObject({ id });
    // Maiúscula e espaço, como quem digita do celular.
    expect(await resolverLinkCurto(h.cliente as never, ` ${codigo.toUpperCase()} `)).toMatchObject({ id });

    const prazo = linha.expires_at;
    linha.expires_at = new Date(Date.now() - 1000).toISOString();
    expect(await resolverLinkCurto(h.cliente as never, codigo)).toBeNull();
    linha.expires_at = prazo;

    linha.accepted_at = new Date().toISOString();
    expect(await resolverLinkCurto(h.cliente as never, codigo)).toBeNull();
    linha.accepted_at = null;

    linha.revoked_at = new Date().toISOString();
    expect(await resolverLinkCurto(h.cliente as never, codigo)).toBeNull();
    linha.revoked_at = null;

    // CONTROLE: de volta ao pendente, resolve de novo (o instrumento enxerga o caso bom).
    expect(await resolverLinkCurto(h.cliente as never, codigo)).toMatchObject({ id });
  });

  it("código inexistente não resolve, e código malformado nem chega ao banco", async () => {
    await convitePendente();
    expect(await resolverLinkCurto(h.cliente as never, gerarCodigoCurto())).toBeNull();
    const antes = h.leituras;
    expect(await resolverLinkCurto(h.cliente as never, "../../etc")).toBeNull();
    expect(await resolverLinkCurto(h.cliente as never, "a".repeat(200))).toBeNull();
    expect(h.leituras).toBe(antes);
  });

  it("a resolução não devolve o hash", async () => {
    const { codigo } = await convitePendente();
    // O banco em memória devolve a linha inteira; o que importa é a lista pedida.
    const fonte = readFileSync("lib/team/link-curto.ts", "utf8");
    const colunas = fonte.match(/const COLUNAS_DO_CONVITE =\s*"([^"]+)"/)![1]!;
    expect(colunas).not.toContain("codigo_curto_hash");
    expect(colunas).toContain("expires_at");
    expect(await resolverLinkCurto(h.cliente as never, codigo)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("a página /c/<código>", () => {
  it("⭐ código bom: redireciona para o aceite de sempre, com um token do MESMO convite", async () => {
    cenario();
    const r = await emitirConvite(h.cliente as never, PEDIDO);
    const { destino } = await abrir(codigoDe(r.link_curto));
    expect(destino).toMatch(/^\/team\/accept-invite\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifyInviteToken(destino!.split("/").at(-1)!)).toMatchObject({
      invite_id: r.convite.id,
      organization_id: ORG,
      email: "convidada@exemplo.invalid",
      role: "agent",
    });
  });

  it("⭐ ABRIR NÃO CONSOME: o verificador do Outlook e a prévia do WhatsApp abrem quantas vezes for, sem escrita", async () => {
    const { banco, convites } = cenario();
    const r = await emitirConvite(h.cliente as never, PEDIDO);
    const escritasAntes = banco.escritas.length;
    const linhaAntes = JSON.stringify(convites());

    for (let i = 0; i < 3; i += 1) {
      expect((await abrir(codigoDe(r.link_curto))).destino).toContain("/team/accept-invite/");
    }

    expect(banco.escritas.length).toBe(escritasAntes);
    expect(JSON.stringify(convites())).toBe(linhaAntes);
    expect(convites()[0]!.accepted_at ?? null).toBeNull();
    expect(convites()[0]!.revoked_at ?? null).toBeNull();
  });

  it("⭐ vencido, aceito, revogado, inexistente e malformado: a MESMA tela, sem dizer qual é", async () => {
    const { convites } = cenario();
    const r = await emitirConvite(h.cliente as never, PEDIDO);
    const codigo = codigoDe(r.link_curto);
    const linha = convites()[0]!;
    const telas: string[] = [];

    linha.expires_at = new Date(Date.now() - 1000).toISOString();
    telas.push((await abrir(codigo)).html);
    linha.expires_at = new Date(Date.now() + 86_400_000).toISOString();
    linha.accepted_at = new Date().toISOString();
    telas.push((await abrir(codigo)).html);
    linha.accepted_at = null;
    linha.revoked_at = new Date().toISOString();
    telas.push((await abrir(codigo)).html);
    telas.push((await abrir(gerarCodigoCurto())).html);
    telas.push((await abrir("nao-e-um-codigo")).html);

    expect(new Set(telas).size).toBe(1);
    expect(telas[0]).toContain("Convite inválido ou expirado");
    // Nada do convite vaza na tela de recusa.
    expect(telas[0]).not.toContain("convidada@exemplo.invalid");
    expect(telas[0]).not.toContain("Empresa Exemplo");
  });

  it("⭐ teto por IP com o limitador do login: o 61º pedido do mesmo IP leva \"Muitas tentativas\", mesmo com código bom", async () => {
    cenario();
    const r = await emitirConvite(h.cliente as never, PEDIDO);
    const bom = codigoDe(r.link_curto);
    expect(LIMITE_DO_LINK_CURTO).toEqual({ ip: 60, windowSec: 3600 });

    for (let i = 0; i < 59; i += 1) await abrir(gerarCodigoCurto());
    expect((await abrir(bom)).destino, "o 60º ainda passa").toContain("/team/accept-invite/");

    const leiturasAntes = h.leituras;
    const barrado = await abrir(bom);
    expect(barrado.destino).toBeNull();
    expect(barrado.html).toContain("Muitas tentativas");
    expect(barrado.html).not.toContain("Convite inválido");
    // Barrado ANTES de olhar o código: nenhuma consulta ao banco.
    expect(h.leituras).toBe(leiturasAntes);

    // CONTROLE: outro IP segue entrando.
    h.ip = "198.51.100.250";
    expect((await abrir(bom)).destino).toContain("/team/accept-invite/");
  });

  it("instalação sem o service-role não tem link curto: a tela é a de convite inválido", async () => {
    cenario();
    const r = await emitirConvite(h.cliente as never, PEDIDO);
    h.serviceRole = false;
    expect((await abrir(codigoDe(r.link_curto))).html).toContain("Convite inválido ou expirado");
  });

  it("não tem metadado próprio: a prévia do WhatsApp mostra o título padrão da instalação", async () => {
    const pagina = await import("@/app/c/[codigo]/page");
    expect(pagina).not.toHaveProperty("metadata");
    expect(pagina).not.toHaveProperty("generateMetadata");
  });

  it("fala o idioma do navegador, e o lang do documento acompanha", async () => {
    cenario();
    h.aceitaIdioma = "es";
    const emEspanhol = await abrir("nao-e-um-codigo");
    expect(emEspanhol.html).toContain(traduzir("Convite inválido ou expirado", "es"));
    expect(traduzir("Convite inválido ou expirado", "es")).not.toBe("Convite inválido ou expirado");
    render(emEspanhol.elemento!);
    expect(document.documentElement.lang).toBe("es");
  });

  it("a rota é pública, num segmento só", () => {
    expect(isPublicPath("/c/abcd2345efgh")).toBe(true);
    expect(isPublicPath("/c/ABCD2345EFGH")).toBe(true);
    expect(isPublicPath("/c")).toBe(false);
    expect(isPublicPath("/c/")).toBe(false);
    expect(isPublicPath("/c/abcd2345efgh/outra")).toBe(false);
    expect(isPublicPath("/c/abc.def")).toBe(false);
    expect(isPublicPath("/cobranca")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("\"Copiar link do convite\": gera um link novo, e o anterior morre", () => {
  it("⭐ código novo; o do e-mail deixa de valer; a auditoria diz quem e qual convite, sem o código", async () => {
    const { convites } = cenario();
    const emitido = await emitirConvite(h.cliente as never, PEDIDO);
    h.auditorias.length = 0;

    const troca = await trocarLinkCurto(h.cliente as never, {
      organizationId: ORG,
      conviteId: emitido.convite.id,
      actorUserId: ADMIN,
      requestId: "req-9023-copia",
      via: "tela",
    });

    expect(troca.ok).toBe(true);
    const novo = (troca as { link_curto: string }).link_curto;
    expect(novo).not.toBe(emitido.link_curto);
    expect(await resolverLinkCurto(h.cliente as never, codigoDe(emitido.link_curto))).toBeNull();
    expect(await resolverLinkCurto(h.cliente as never, codigoDe(novo))).toMatchObject({ id: emitido.convite.id });
    expect(convites()[0]!.codigo_curto_hash).toBe(hashDoCodigoCurto(codigoDe(novo)));
    // Não muda o prazo nem manda e-mail.
    expect(convites()[0]!.expires_at).toBe(emitido.convite.expires_at);
    expect(h.emails).toHaveLength(1);

    expect(h.auditorias).toHaveLength(1);
    expect(h.auditorias[0]).toMatchObject({
      action: "member.invite_link_created",
      actorUserId: ADMIN,
      organizationId: ORG,
      resourceType: "membership",
      resourceId: emitido.convite.id,
      metadata: { role: "agent", via: "tela" },
    });
    const trilha = JSON.stringify(h.auditorias);
    expect(trilha).not.toContain(codigoDe(novo));
    expect(trilha).not.toContain(hashDoCodigoCurto(codigoDe(novo)));
  });

  it("recusa o que não está pendente, sem gravar nem auditar: aceito, revogado, vencido, de outra empresa", async () => {
    const { convites } = cenario();
    const emitido = await emitirConvite(h.cliente as never, PEDIDO);
    const linha = convites()[0]!;
    const hashAntes = linha.codigo_curto_hash;
    h.auditorias.length = 0;
    const trocar = (org = ORG) =>
      trocarLinkCurto(h.cliente as never, { organizationId: org, conviteId: emitido.convite.id, actorUserId: ADMIN, requestId: "r", via: "tela" });

    linha.accepted_at = new Date().toISOString();
    expect(await trocar()).toEqual({ ok: false, motivo: "aceito" });
    linha.accepted_at = null;
    linha.revoked_at = new Date().toISOString();
    expect(await trocar()).toEqual({ ok: false, motivo: "revogado" });
    linha.revoked_at = null;
    const prazo = linha.expires_at;
    linha.expires_at = new Date(Date.now() - 1000).toISOString();
    expect(await trocar()).toEqual({ ok: false, motivo: "expirado" });
    linha.expires_at = prazo;
    expect(await trocar(OUTRA_ORG)).toEqual({ ok: false, motivo: "nao_encontrado" });

    expect(linha.codigo_curto_hash).toBe(hashAntes);
    expect(h.auditorias).toEqual([]);
    // CONTROLE: pendente, troca.
    expect((await trocar()).ok).toBe(true);
  });

  describe("a rota POST /api/v1/team/invites/[id]/link-curto", () => {
    const pedir = (id: string) =>
      gerarLinkPelaRota(new Request(`${APP}/api/v1/team/invites/${id}/link-curto`, { method: "POST" }) as never, {
        params: Promise.resolve({ id }),
      });

    it("⭐ admin: 200 com o link novo, que resolve; o anterior não", async () => {
      cenario();
      const emitido = await emitirConvite(h.cliente as never, PEDIDO);
      const resposta = await pedir(emitido.convite.id);
      const corpo = (await resposta.json()) as { data: { link_curto: string; expires_at: string } };
      expect(resposta.status).toBe(200);
      expect(corpo.data.link_curto).toMatch(new RegExp(`^${APP}/c/`));
      expect(corpo.data.expires_at).toBe(emitido.convite.expires_at);
      expect(await resolverLinkCurto(h.cliente as never, codigoDe(corpo.data.link_curto))).toMatchObject({ id: emitido.convite.id });
      expect(await resolverLinkCurto(h.cliente as never, codigoDe(emitido.link_curto))).toBeNull();
      expect(vi.mocked(requireRole)).toHaveBeenLastCalledWith("admin", expect.objectContaining({ resource: "team" }));
    });

    it("a mesma permissão de reenviar e revogar: gerente é recusado, e o acompanhamento só-leitura também", async () => {
      const { convites } = cenario();
      const emitido = await emitirConvite(h.cliente as never, PEDIDO);
      const hashAntes = convites()[0]!.codigo_curto_hash;

      h.papel = "manager";
      expect((await pedir(emitido.convite.id)).status).toBe(403);
      h.papel = "admin";
      h.suporteSoLeitura = true;
      expect((await pedir(emitido.convite.id)).status).toBe(403);

      expect(convites()[0]!.codigo_curto_hash).toBe(hashAntes);
    });

    it("vencido é 409 com a saída (Reenviar); inexistente é 404; id torto é 400", async () => {
      const { convites } = cenario();
      const emitido = await emitirConvite(h.cliente as never, PEDIDO);
      convites()[0]!.expires_at = new Date(Date.now() - 1000).toISOString();
      const vencido = await pedir(emitido.convite.id);
      expect(vencido.status).toBe(409);
      expect(JSON.stringify(await vencido.json())).toContain("Reenviar");
      expect((await pedir("90239023-9999-4000-8000-000000000000")).status).toBe(404);
      expect((await pedir("nao-e-uuid")).status).toBe(400);
    });
  });
});

// ---------------------------------------------------------------------------

describe("as frases novas têm espanhol", () => {
  it.each([
    "Copiar link do convite",
    "Link novo copiado. O link anterior deste convite, inclusive o do e-mail, deixou de valer.",
    "O link novo foi gerado, mas não deu para copiar sozinho. Copie abaixo e mande para a pessoa. O link anterior deste convite, inclusive o do e-mail, deixou de valer.",
    "Não foi possível copiar. Selecione o link e copie à mão.",
    "Convite reenviado com um link novo. O link anterior deixou de valer.",
    "Link do convite",
  ])("%s", (frase) => {
    expect(traduzir(frase, "es")).not.toBe(frase);
  });
});
