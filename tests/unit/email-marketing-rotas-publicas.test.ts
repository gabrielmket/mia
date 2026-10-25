/**
 * FORK MIA (.89) — AS ROTAS PÚBLICAS DO E-MAIL MARKETING, pelo caminho inteiro
 * (rota → domínio → banco em memória).
 *
 *   descadastro de um clique  POST do botão do Gmail/Apple (RFC 8058) tira da lista
 *                             na hora, uma vez só; token ruim responde 200 sem
 *                             efeito; o GET NUNCA descadastra (leva à página)
 *   preferências              voltar a receber só pela própria pessoa, e nunca
 *                             depois de rejeição permanente; o e-mail de teste
 *                             não muda nada
 *   avisos da Amazon          assinatura do SNS forjada: 403 e nada muda;
 *                             rejeição permanente e reclamação entram na
 *                             supressão na hora; três temporárias seguidas, também
 *   demonstração              `mandar` não chama a Amazon na empresa de demonstração
 *
 * Nenhum dado de gente real: empresa fictícia, endereços `@exemplo.invalid`.
 */
import { createSign, generateKeyPairSync } from "node:crypto";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Ses from "@/lib/email/ses";

import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({
  cliente: null as unknown,
  TOPICO: "arn:aws:sns:sa-east-1:000000000000:avisos-de-email",
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
vi.mock("@/lib/auth/rate-limit", () => ({ authRateLimited: vi.fn(async () => false) }));
vi.mock("@/lib/email/ses", async (original) => {
  const o = await original<typeof Ses>();
  return {
    ...o,
    configuracaoDaAmazon: (ambiente?: Parameters<typeof o.configuracaoDaAmazon>[0]) =>
      ambiente
        ? o.configuracaoDaAmazon(ambiente)
        : {
            configurado: true,
            falta: [],
            regiao: "sa-east-1",
            conjuntoDeConfiguracao: "",
            topicoDosAvisos: estado.TOPICO,
          },
  };
});

const descadastro = await import("@/app/api/v1/webhooks/email-marketing/descadastro/[token]/route");
const preferencias =
  await import("@/app/api/v1/webhooks/email-marketing/preferencias/[token]/route");
const avisos = await import("@/app/api/v1/webhooks/email-marketing/amazon/route");
const imagem = await import("@/app/api/v1/webhooks/email-marketing/imagem/[org]/[arquivo]/route");
const { assinarToken } = await import("@/lib/email-marketing/token");
const { hashDoEmail } = await import("@/lib/email-marketing/endereco");
const { aplicarAviso } = await import("@/lib/email-marketing/eventos");
const { mandar } = await import("@/lib/email-marketing/envio");
const { textoAssinadoPeloSns, esquecerCertificados, lerMensagemDoSns } =
  await import("@/lib/email-marketing/avisos-da-amazon");
const { audit } = await import("@/lib/audit");

const ORG = "0a000000-0000-4000-8000-000000000001";
const CAMPANHA = "0c000000-0000-4000-8000-000000000001";
const DEST = "0d000000-0000-4000-8000-000000000001";
const CONTATO = "0e000000-0000-4000-8000-000000000001";
const EMAIL = "pessoa@exemplo.invalid";

function montar(
  opcoes: { supressao?: Linha[]; demonstracao?: boolean; destinatarios?: Linha[] } = {},
) {
  const banco = bancoEmMemoria(
    {
      organizations: [
        {
          id: ORG,
          display_name: "Empresa Exemplo",
          legal_name: "Empresa Exemplo LTDA",
          cnpj: null,
          timezone: "America/Sao_Paulo",
          privacy_policy_url: null,
          demonstracao: opcoes.demonstracao === true,
          status: "active",
          settings: {},
        },
      ],
      mia_email_campanhas: [{ id: CAMPANHA, organization_id: ORG, nome: "Novidades de novembro" }],
      mia_email_destinatarios: opcoes.destinatarios ?? [
        {
          id: DEST,
          organization_id: ORG,
          campanha_id: CAMPANHA,
          contact_id: CONTATO,
          email: EMAIL,
          email_hash: hashDoEmail(EMAIL),
          status: "entregue",
          ses_message_id: "ses-1",
          enviado_em: "2026-10-26T15:00:00Z",
          descadastrado_em: null,
        },
      ],
      contacts: [{ id: CONTATO, organization_id: ORG, email: EMAIL, consent: {} }],
      campaign_suppressions: opcoes.supressao ?? [],
    },
    {
      fn_mia_e_demonstracao: (args, db) => ({
        data: (db.organizations ?? []).find((o) => o.id === args.p_org)?.demonstracao === true,
        error: null,
      }),
      // O banco de verdade apaga só com a GUC do titular (9064); aqui, o efeito.
      fn_mia_email_voltar_a_receber: (args, db) => {
        const antes = (db.campaign_suppressions ?? []).length;
        db.campaign_suppressions = (db.campaign_suppressions ?? []).filter(
          (s) =>
            !(
              s.organization_id === args.p_org &&
              s.recipient_address_hash === args.p_hash &&
              s.motivo !== "rejeicao"
            ),
        );
        return { data: antes - db.campaign_suppressions.length, error: null };
      },
    },
  );
  estado.cliente = banco.cliente;
  return banco;
}

const params = (token: string) => ({ params: Promise.resolve({ token }) });
const supressoes = (b: ReturnType<typeof montar>) => b.tabela("campaign_suppressions");

beforeEach(() => {
  vi.mocked(audit).mockClear();
  vi.unstubAllGlobals();
  esquecerCertificados();
});

describe("descadastro de um clique (RFC 8058)", () => {
  const token = () => assinarToken({ k: "d", o: ORG, r: DEST });

  it("⭐ o POST do provedor tira da lista NA HORA, marca o envio e registra a recusa; o segundo POST não duplica", async () => {
    const b = montar();
    const r = await descadastro.POST(
      new NextRequest(`https://app.exemplo.invalid/x`, {
        method: "POST",
        body: "List-Unsubscribe=One-Click",
      }),
      params(token()),
    );
    expect(r.status).toBe(200);
    expect(supressoes(b)).toHaveLength(1);
    expect(supressoes(b)[0]).toMatchObject({
      organization_id: ORG,
      tipo_de_endereco: "email",
      motivo: "descadastro",
      recipient_address_hash: hashDoEmail(EMAIL),
    });
    expect(b.tabela("mia_email_destinatarios")[0]!.descadastrado_em).toBeTruthy();
    expect(b.tabela("mia_email_consentimentos")).toHaveLength(1);
    expect(b.tabela("mia_email_consentimentos")[0]).toMatchObject({
      tipo: "recusa",
      registrado_pelo: "pagina_de_preferencias",
    });

    const de_novo = await descadastro.POST(
      new NextRequest(`https://app.exemplo.invalid/x`, { method: "POST" }),
      params(token()),
    );
    expect(de_novo.status).toBe(200);
    expect(supressoes(b)).toHaveLength(1);
    expect(b.tabela("mia_email_consentimentos")).toHaveLength(1);
  });

  it("token adulterado: 200 sem efeito (o provedor não precisa saber)", async () => {
    const b = montar();
    const [corpo] = token().split(".");
    const r = await descadastro.POST(
      new NextRequest(`https://app.exemplo.invalid/x`, { method: "POST" }),
      params(`${corpo}.${"A".repeat(43)}`),
    );
    expect(r.status).toBe(200);
    expect(b.escritas).toEqual([]);
  });

  it("o GET NUNCA descadastra: filtro de segurança abre link sozinho, e ele só leva à página com ?sair=1", async () => {
    const b = montar();
    const r = await descadastro.GET(
      new NextRequest(`https://app.exemplo.invalid/x`),
      params(token()),
    );
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toMatch(/\/preferencias\/[^?]+\?sair=1$/);
    expect(b.escritas).toEqual([]);
  });

  it("o e-mail de TESTE não descadastra ninguém", async () => {
    const b = montar();
    const r = await descadastro.POST(
      new NextRequest(`https://app.exemplo.invalid/x`, { method: "POST" }),
      params(assinarToken({ k: "t", o: ORG, r: CAMPANHA })),
    );
    expect(r.status).toBe(200);
    expect(b.escritas).toEqual([]);
  });
});

describe("a página de preferências: voltar a receber é só da própria pessoa", () => {
  const pedir = (token: string, corpo: unknown) =>
    preferencias.POST(
      new NextRequest(`https://app.exemplo.invalid/x`, {
        method: "POST",
        body: JSON.stringify(corpo),
      }),
      params(token),
    );
  const token = assinarToken({ k: "d", o: ORG, r: DEST });
  const supressao = (motivo: string): Linha => ({
    id: "s1",
    organization_id: ORG,
    recipient_address_hash: hashDoEmail(EMAIL),
    tipo_de_endereco: "email",
    motivo,
    created_at: "2026-10-20T10:00:00Z",
    reason: "Página de preferências",
  });

  it("sair também do marketing pelo WhatsApp grava a recusa no consentimento do contato", async () => {
    const b = montar();
    const r = await pedir(token, { acao: "sair", tambem_whatsapp: true, motivo: "muitos" });
    expect(r.status).toBe(200);
    expect(supressoes(b)).toHaveLength(1);
    const consent = b.tabela("contacts")[0]!.consent as { marketing?: { declined_at?: string } };
    expect(consent.marketing?.declined_at).toBeTruthy();
  });

  it("voltar tira o veto de descadastro e grava um aceite novo, da própria pessoa", async () => {
    const b = montar({ supressao: [supressao("descadastro")] });
    const r = await pedir(token, { acao: "voltar" });
    expect(r.status).toBe(200);
    expect(supressoes(b)).toHaveLength(0);
    expect(b.tabela("mia_email_consentimentos").at(-1)).toMatchObject({
      tipo: "aceite",
      registrado_pelo: "pagina_de_preferencias",
    });
  });

  it("rejeição permanente não volta: o endereço não existe", async () => {
    const b = montar({ supressao: [supressao("rejeicao")] });
    const r = await pedir(token, { acao: "voltar" });
    expect(r.status).toBe(409);
    expect(supressoes(b)).toHaveLength(1);
  });

  it("anonimizado (o envio sem endereço legível) não volta: o veto sobrevive", async () => {
    const b = montar({
      supressao: [supressao("descadastro")],
      destinatarios: [
        {
          id: DEST,
          organization_id: ORG,
          campanha_id: CAMPANHA,
          contact_id: null,
          email: null,
          email_hash: hashDoEmail(EMAIL),
          status: "entregue",
        },
      ],
    });
    const r = await pedir(token, { acao: "voltar" });
    expect(r.status).toBe(409);
    expect(supressoes(b)).toHaveLength(1);
  });

  it("no e-mail de teste a página responde, e nada é gravado", async () => {
    const b = montar();
    const r = await pedir(assinarToken({ k: "t", o: ORG, r: CAMPANHA }), { acao: "sair" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: { teste: boolean } }).data.teste).toBe(true);
    expect(b.escritas).toEqual([]);
  });
});

describe("os avisos da Amazon pelo SNS", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();

  function aviso(evento: Record<string, unknown>, assinar = true) {
    const m = lerMensagemDoSns({
      Type: "Notification",
      MessageId: `aviso-${Math.random()}`,
      TopicArn: estado.TOPICO,
      Message: JSON.stringify(evento),
      Timestamp: new Date().toISOString(),
      SignatureVersion: "2",
      Signature: "Zm9yamFkbw==",
      SigningCertURL: "https://sns.sa-east-1.amazonaws.com/SimpleNotificationService-exemplo.pem",
    })!;
    if (!assinar) return m;
    const s = createSign("RSA-SHA256");
    s.update(textoAssinadoPeloSns(m), "utf8");
    return { ...m, Signature: s.sign(privateKey, "base64") };
  }
  const postar = (corpo: unknown) =>
    avisos.POST(
      new NextRequest("https://app.exemplo.invalid/x", {
        method: "POST",
        body: JSON.stringify(corpo),
      }),
    );

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(pem, { status: 200 })),
    );
  });

  const rejeicao = (tipo: "Permanent" | "Transient", id = "ses-1") => ({
    eventType: "Bounce",
    mail: { messageId: id },
    bounce: {
      bounceType: tipo,
      timestamp: new Date().toISOString(),
      bouncedRecipients: [{ emailAddress: EMAIL }],
    },
  });

  it("⭐ assinatura forjada: 403, auditado, e NADA muda", async () => {
    const b = montar();
    const r = await postar(aviso(rejeicao("Permanent"), false));
    expect(r.status).toBe(403);
    expect(b.escritas).toEqual([]);
    expect(vi.mocked(audit).mock.calls.map(([e]) => e.action)).toContain("webhook.hmac_invalid");
  });

  it("rejeição permanente: o envio vira rejeitado e o endereço entra na supressão na hora", async () => {
    const b = montar();
    const r = await postar(aviso(rejeicao("Permanent")));
    expect(r.status).toBe(200);
    expect(b.tabela("mia_email_destinatarios")[0]).toMatchObject({
      status: "rejeitado",
      rejeicao_tipo: "permanente",
    });
    expect(supressoes(b)[0]).toMatchObject({ motivo: "rejeicao", tipo_de_endereco: "email" });
  });

  it("reclamação (marcou como spam): supressão na hora, para sempre", async () => {
    const b = montar();
    const r = await postar(
      aviso({
        eventType: "Complaint",
        mail: { messageId: "ses-1" },
        complaint: { timestamp: new Date().toISOString() },
      }),
    );
    expect(r.status).toBe(200);
    expect(b.tabela("mia_email_destinatarios")[0]).toMatchObject({ status: "reclamacao" });
    expect(supressoes(b)[0]).toMatchObject({ motivo: "reclamacao" });
  });

  it("temporária: só vira permanente na terceira campanha SEGUIDA", async () => {
    const linha = (i: number, status: string, tipo: string | null): Linha => ({
      id: `0d000000-0000-4000-8000-00000000000${i}`,
      organization_id: ORG,
      campanha_id: CAMPANHA,
      contact_id: CONTATO,
      email: EMAIL,
      email_hash: hashDoEmail(EMAIL),
      status,
      rejeicao_tipo: tipo,
      ses_message_id: `ses-${i}`,
      enviado_em: `2026-10-0${i}T10:00:00Z`,
    });
    const b = montar({
      destinatarios: [
        linha(1, "rejeitado", "temporaria"),
        linha(2, "rejeitado", "temporaria"),
        linha(3, "enviado", null),
      ],
    });
    await aplicarAviso(
      b.cliente as never,
      {
        tipo: "rejeicao",
        messageId: "ses-3",
        ocorridoEm: "2026-10-03T10:05:00Z",
        rejeicao: "temporaria",
        enderecos: [],
        detalhe: {},
      },
      "a-3",
    );
    expect(supressoes(b)).toHaveLength(1);
    expect(supressoes(b)[0]!.motivo).toBe("rejeicao");

    const so_duas = montar({
      destinatarios: [
        linha(1, "entregue", null),
        linha(2, "rejeitado", "temporaria"),
        linha(3, "enviado", null),
      ],
    });
    await aplicarAviso(
      so_duas.cliente as never,
      {
        tipo: "rejeicao",
        messageId: "ses-3",
        ocorridoEm: "2026-10-03T10:05:00Z",
        rejeicao: "temporaria",
        enderecos: [],
        detalhe: {},
      },
      "a-4",
    );
    expect(supressoes(so_duas)).toHaveLength(0);
  });
});

describe("a empresa de demonstração não manda nada", () => {
  it("⭐ `mandar` recusa antes de chamar a Amazon", async () => {
    const b = montar({ demonstracao: true });
    const rede = vi.fn(async () => new Response("{}", { status: 200 }));
    const r = await mandar(
      b.cliente as never,
      ORG,
      { de: "contato@exemplo.invalid", para: EMAIL, mime: "From: x", assunto: "x" } as never,
      { campanha: CAMPANHA },
      {
        fetch: rede as never,
        ambiente: {
          AWS_SES_ACCESS_KEY_ID: "k",
          AWS_SES_SECRET_ACCESS_KEY: "s",
          AWS_SES_REGION: "sa-east-1",
          AWS_SES_CONFIGURATION_SET: "c",
          AWS_SES_SNS_TOPIC_ARN: estado.TOPICO,
        },
      },
    );
    expect(r).toMatchObject({ ok: false, erro: "organizacao_de_demonstracao" });
    expect(rede).not.toHaveBeenCalled();
  });

  it("controle: na empresa de verdade a mesma chamada chega à Amazon", async () => {
    const b = montar();
    const rede = vi.fn(
      async () => new Response(JSON.stringify({ MessageId: "ses-novo" }), { status: 200 }),
    );
    const r = await mandar(
      b.cliente as never,
      ORG,
      { de: "contato@exemplo.invalid", para: EMAIL, mime: "From: x", assunto: "x" } as never,
      { campanha: CAMPANHA },
      {
        fetch: rede as never,
        ambiente: {
          AWS_SES_ACCESS_KEY_ID: "k",
          AWS_SES_SECRET_ACCESS_KEY: "s",
          AWS_SES_REGION: "sa-east-1",
          AWS_SES_CONFIGURATION_SET: "c",
          AWS_SES_SNS_TOPIC_ARN: estado.TOPICO,
        },
      },
    );
    expect(r).toMatchObject({ ok: true, messageId: "ses-novo" });
    expect(rede).toHaveBeenCalledTimes(1);
  });
});

describe("a imagem da campanha: bucket privado, rota pública", () => {
  const ARQ = "0f000000-0000-4000-8000-000000000001.png";

  function comStorage(existe: boolean) {
    const baixados: Array<{ bucket: string; caminho: string }> = [];
    estado.cliente = {
      storage: {
        from: (bucket: string) => ({
          download: async (caminho: string) => {
            baixados.push({ bucket, caminho });
            return existe ? { data: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]), error: null } : { data: null, error: { message: "not found" } };
          },
        }),
      },
    };
    return baixados;
  }
  const pedir = (org: string, arquivo: string) =>
    imagem.GET(new NextRequest("https://app.exemplo.invalid/x"), { params: Promise.resolve({ org, arquivo }) });

  it("⭐ lê do bucket PRIVADO e devolve a imagem com cache longo", async () => {
    const baixados = comStorage(true);
    const r = await pedir(ORG, ARQ);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toContain("max-age=31536000");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(baixados).toEqual([{ bucket: "email-marketing-imagens", caminho: `${ORG}/${ARQ}` }]);
  });

  it("caminho fora da forma (outra pasta, outra extensão, sem uuid) é 404 sem ir ao storage", async () => {
    const baixados = comStorage(true);
    for (const [org, arquivo] of [
      [ORG, "../segredo.png"],
      [ORG, "0f000000-0000-4000-8000-000000000001.svg"],
      [ORG, "logo.png"],
      ["nao-e-uuid", ARQ],
    ] as const) {
      expect((await pedir(org, arquivo)).status, `${org}/${arquivo}`).toBe(404);
    }
    expect(baixados).toEqual([]);
  });

  it("arquivo que não existe: 404, sem cache", async () => {
    comStorage(false);
    const r = await pedir(ORG, ARQ);
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});
