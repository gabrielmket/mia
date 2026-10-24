/**
 * FORK MIA (.89) — AS REGRAS PURAS DO DISPARO DE E-MAIL MARKETING
 * (docs/fork/email-marketing.md).
 *
 * Um bloco por regra do protótipo aprovado: quem fica de fora e por quê (os dez
 * motivos), o plano dia a dia com o aquecimento de 14 degraus, o ritmo e a
 * janela, a trava de saúde (4% de rejeição, 0,08% de reclamação, a partir de
 * 300 entregues), o token assinado dos links, os cabeçalhos do descadastro de
 * um clique (RFC 8058), o domínio (seis registros, provedor gratuito recusado),
 * a assinatura V4 da Amazon contra o vetor publicado e a assinatura do aviso do
 * SNS (forjado é recusado).
 *
 * Nenhum dado de gente real: endereços `@exemplo.invalid` e `example.com`.
 */
import { generateKeyPairSync, createSign } from "node:crypto";

import { describe, expect, it } from "vitest";

import { assinarV4 } from "@/lib/email/ses";
import {
  conferirAviso,
  esquecerCertificados,
  lerEventoDaSes,
  lerMensagemDoSns,
  textoAssinadoPeloSns,
  type MensagemDoSns,
} from "@/lib/email-marketing/avisos-da-amazon";
import { montarEmail } from "@/lib/email-marketing/blocos";
import { ehAgenteDeRobo } from "@/lib/email-marketing/cliques";
import {
  conferirRegistros,
  dominioVerificado,
  recusaDoDominio,
  registrosDoDominio,
  type ResolvedoresDeDns,
} from "@/lib/email-marketing/dominio";
import {
  classificar,
  contar,
  motivoDeExclusao,
  MOTIVOS_DE_EXCLUSAO,
  type ContatoParaEmail,
  type ContextoDaElegibilidade,
  type MotivoDaSupressao,
} from "@/lib/email-marketing/elegibilidade";
import { hashDoEmail } from "@/lib/email-marketing/endereco";
import { montarMime } from "@/lib/email-marketing/mime";
import { DEGRAUS_DO_AQUECIMENTO } from "@/lib/email-marketing/regras";
import {
  planejarEnvio,
  proximoDegrau,
  quantosPodemSair,
  ritmoEfetivo,
  tetoDoDegrau,
  travaDeSaude,
} from "@/lib/email-marketing/ritmo";
import { assinarToken, linksDoDestinatario, verificarToken } from "@/lib/email-marketing/token";

const ORG = "0a000000-0000-4000-8000-000000000001";
const OUTRA = "0a000000-0000-4000-8000-000000000002";
const DEST = "0d000000-0000-4000-8000-000000000001";
const FUSO = "America/Sao_Paulo";

// ─── quem fica de fora ──────────────────────────────────────────────────────

function contato(p: Partial<ContatoParaEmail> = {}): ContatoParaEmail {
  return {
    contactId: p.contactId ?? "c1",
    email: p.email === undefined ? "pessoa@exemplo.invalid" : p.email,
    bloqueado: false,
    pessoal: false,
    anonimizado: false,
    recusouMarketing: false,
    consentiuEmail: true,
    clienteRecente: false,
    ...p,
  };
}

function ctx(
  p: {
    base?: "consent" | "legitimate_interest";
    suprimidos?: Record<string, MotivoDaSupressao>;
    dominioRecebe?: boolean;
  } = {},
): ContextoDaElegibilidade {
  const mapa = new Map<string, MotivoDaSupressao>();
  for (const [email, motivo] of Object.entries(p.suprimidos ?? {}))
    mapa.set(hashDoEmail(email), motivo);
  return {
    base: p.base ?? "consent",
    suprimidos: mapa,
    hashDoEmail,
    temForma: (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e),
    dominioRecebe: () => p.dominioRecebe ?? true,
  };
}

describe("elegibilidade: os DEZ motivos de ficar de fora, um a um", () => {
  it("são dez, na ordem da tela", () => {
    expect(MOTIVOS_DE_EXCLUSAO).toEqual([
      "descadastro",
      "reclamacao",
      "manual",
      "outros",
      "sem_email",
      "email_invalido",
      "rejeicao",
      "sem_consentimento",
      "nao_cliente",
      "duplicado",
    ]);
  });

  const E = "pessoa@exemplo.invalid";
  it.each([
    ["descadastro", contato(), ctx({ suprimidos: { [E]: "descadastro" } })],
    ["descadastro", contato(), ctx({ suprimidos: { [E]: "importada" } })],
    ["reclamacao", contato(), ctx({ suprimidos: { [E]: "reclamacao" } })],
    ["manual", contato(), ctx({ suprimidos: { [E]: "manual" } })],
    ["outros", contato({ bloqueado: true }), ctx()],
    ["outros", contato({ recusouMarketing: true }), ctx()],
    ["outros", contato({ pessoal: true }), ctx()],
    ["outros", contato({ anonimizado: true }), ctx()],
    ["sem_email", contato({ email: null }), ctx()],
    ["email_invalido", contato({ email: "sem-arroba" }), ctx()],
    ["email_invalido", contato(), ctx({ dominioRecebe: false })],
    ["rejeicao", contato(), ctx({ suprimidos: { [E]: "rejeicao" } })],
    ["sem_consentimento", contato({ consentiuEmail: false }), ctx()],
    ["nao_cliente", contato({ clienteRecente: false }), ctx({ base: "legitimate_interest" })],
  ] as const)("%s", (esperado, c, contexto) => {
    expect(motivoDeExclusao(c, contexto)).toBe(esperado);
  });

  it("o décimo, duplicado, depende da lista: o primeiro do endereço recebe, o segundo não", () => {
    const linhas = classificar(
      [
        contato({ contactId: "a", email: "Pessoa@Exemplo.invalid" }),
        contato({ contactId: "b", email: "pessoa@exemplo.invalid" }),
      ],
      {
        ...ctx(),
        hashDoEmail: (e) => hashDoEmail(e.toLowerCase()),
      },
    );
    expect(linhas.map((l) => l.motivo)).toEqual([null, "duplicado"]);
  });

  it("interesse legítimo não pede aceite, pede cliente dos últimos 24 meses", () => {
    expect(
      motivoDeExclusao(
        contato({ consentiuEmail: false, clienteRecente: true }),
        ctx({ base: "legitimate_interest" }),
      ),
    ).toBeNull();
  });

  it("a contagem soma por motivo e o que sobra recebe", () => {
    const linhas = classificar(
      [
        contato({ contactId: "1", email: "a@exemplo.invalid" }),
        contato({ contactId: "2", email: null }),
        contato({ contactId: "3", email: "c@exemplo.invalid", consentiuEmail: false }),
      ],
      ctx(),
    );
    const c = contar(linhas);
    expect(c).toMatchObject({ noRecorte: 3, recebem: 1 });
    expect(c.foraPorMotivo.sem_email).toBe(1);
    expect(c.foraPorMotivo.sem_consentimento).toBe(1);
    expect(Object.keys(c.foraPorMotivo)).toHaveLength(10);
  });
});

// ─── o plano, o aquecimento, o ritmo e a trava ──────────────────────────────

describe("plano dia a dia com o aquecimento do domínio", () => {
  const base = {
    fuso: FUSO,
    ritmoPorHora: 300,
    janelaInicio: 8,
    janelaFim: 19,
    cotaDaConta: 50_000,
  };

  it("os 14 degraus do protótipo, e depois deles vale a cota da conta", () => {
    expect(DEGRAUS_DO_AQUECIMENTO).toEqual([
      200, 400, 700, 1000, 1500, 2000, 3000, 4000, 5000, 6500, 8000, 10000, 15000, 20000,
    ]);
    expect(tetoDoDegrau(0, 50_000)).toBe(200);
    expect(tetoDoDegrau(14, 50_000)).toBe(50_000);
    expect(tetoDoDegrau(0, 100)).toBe(100);
  });

  it("domínio novo: 200 no primeiro dia, 400 no segundo, e o resto no terceiro", () => {
    // Segunda, 26/10/2026, 8h em São Paulo.
    const plano = planejarEnvio({
      ...base,
      total: 1000,
      inicio: new Date("2026-10-26T11:00:00Z"),
      soDiasUteis: false,
      degrau: 0,
    });
    expect(plano.map((d) => d.quantidade)).toEqual([200, 400, 400]);
    expect(plano.map((d) => d.porQuePara)).toEqual(["aquecimento", "aquecimento", "fim"]);
    expect(plano.map((d) => d.data)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28"]);
  });

  it("só dias úteis: sexta, pula o fim de semana, segunda e terça", () => {
    const plano = planejarEnvio({
      ...base,
      total: 1000,
      inicio: new Date("2026-10-30T11:00:00Z"),
      soDiasUteis: true,
      degrau: 0,
    });
    expect(plano.map((d) => d.data)).toEqual(["2026-10-30", "2026-11-02", "2026-11-03"]);
  });

  it("aquecido, quem limita é o ritmo dentro da janela", () => {
    const plano = planejarEnvio({
      ...base,
      total: 5000,
      inicio: new Date("2026-10-26T11:00:00Z"),
      soDiasUteis: false,
      degrau: 14,
    });
    expect(plano[0]).toMatchObject({ quantidade: 3300, porQuePara: "ritmo" });
    expect(plano[1]).toMatchObject({ quantidade: 1700, porQuePara: "fim" });
  });

  it("o degrau só sobe com o dia anterior saudável (rejeição < 2% e reclamação < 0,1%)", () => {
    expect(
      proximoDegrau(3, { enviados: 1000, entregues: 990, rejeicoes: 10, reclamacoes: 0 }),
    ).toBe(4);
    expect(
      proximoDegrau(3, { enviados: 1000, entregues: 980, rejeicoes: 20, reclamacoes: 0 }),
    ).toBe(3);
    expect(
      proximoDegrau(3, { enviados: 1000, entregues: 1000, rejeicoes: 0, reclamacoes: 1 }),
    ).toBe(3);
    expect(proximoDegrau(3, { enviados: 0, entregues: 0, rejeicoes: 0, reclamacoes: 0 })).toBe(3);
  });

  it("o ritmo da campanha nunca passa o da configuração", () => {
    expect(ritmoEfetivo(300, 1000)).toBe(300);
    expect(ritmoEfetivo(300, 100)).toBe(100);
    expect(ritmoEfetivo(300, null)).toBe(300);
  });

  it("a rodada espera fora dos dias úteis e fora da janela, e não vira rajada", () => {
    const r = {
      fuso: FUSO,
      ritmoPorHora: 300,
      janelaInicio: 8,
      janelaFim: 19,
      enviadosHojePelaCampanha: 0,
      comecaEm: null,
      restaNoTetoDoDominio: 10_000,
      tetoDaRodada: 120,
    };
    expect(
      quantosPodemSair({ ...r, agora: new Date("2026-10-31T15:00:00Z"), soDiasUteis: true }).espera,
    ).toBe("fora_dos_dias_uteis");
    expect(
      quantosPodemSair({ ...r, agora: new Date("2026-10-26T09:30:00Z"), soDiasUteis: false })
        .espera,
    ).toBe("fora_da_janela");
    expect(
      quantosPodemSair({ ...r, agora: new Date("2026-10-26T15:00:00Z"), soDiasUteis: false })
        .quantos,
    ).toBe(120);
    expect(
      quantosPodemSair({
        ...r,
        agora: new Date("2026-10-26T15:00:00Z"),
        soDiasUteis: false,
        restaNoTetoDoDominio: 0,
      }).espera,
    ).toBe("teto_do_dia");
  });
});

describe("a trava de saúde", () => {
  it("abaixo de 300 entregues não trava, nem com taxa alta", () => {
    expect(
      travaDeSaude({ enviados: 299, entregues: 299, rejeicoes: 60, reclamacoes: 5 }),
    ).toBeNull();
  });
  it("4% de rejeição trava; 3,9% não", () => {
    expect(
      travaDeSaude({ enviados: 1000, entregues: 960, rejeicoes: 40, reclamacoes: 0 }),
    ).toMatchObject({ motivo: "rejeicao", limitePct: 4 });
    expect(
      travaDeSaude({ enviados: 1000, entregues: 961, rejeicoes: 39, reclamacoes: 0 }),
    ).toBeNull();
  });
  it("0,08% de reclamação trava (1 em 1000 entregues já passa)", () => {
    expect(
      travaDeSaude({ enviados: 1000, entregues: 1000, rejeicoes: 0, reclamacoes: 1 }),
    ).toMatchObject({ motivo: "reclamacao", limitePct: 0.08 });
    expect(
      travaDeSaude({ enviados: 2000, entregues: 2000, rejeicoes: 0, reclamacoes: 1 }),
    ).toBeNull();
  });
});

// ─── o token dos links ──────────────────────────────────────────────────────

describe("o token assinado (formato do convite)", () => {
  it("vai e volta, e a assinatura não aceita um byte trocado", () => {
    const t = assinarToken({ k: "d", o: ORG, r: DEST });
    expect(verificarToken(t)).toEqual({ k: "d", o: ORG, r: DEST });
    const [corpo, sig] = t.split(".");
    const outroCorpo = Buffer.from(JSON.stringify({ k: "d", o: OUTRA, r: DEST })).toString(
      "base64url",
    );
    expect(verificarToken(`${outroCorpo}.${sig}`)).toBeNull();
    expect(verificarToken(`${corpo}.${sig!.slice(0, -1)}A`)).toBeNull();
    expect(verificarToken("nada")).toBeNull();
  });

  it("o clique leva o link, o descadastro não", () => {
    expect(verificarToken(assinarToken({ k: "c", o: ORG, r: DEST }))).toBeNull();
    const links = linksDoDestinatario("https://app.exemplo.invalid/", { o: ORG, r: DEST });
    expect(links.descadastroDeUmClique).toMatch(
      /^https:\/\/app\.exemplo\.invalid\/api\/v1\/webhooks\/email-marketing\/descadastro\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/,
    );
    expect(links.descadastroPelaPagina.endsWith("?sair=1")).toBe(true);
    expect(verificarToken(links.token)?.k).toBe("d");
    // O e-mail de teste nasce com o tipo "t": os links abrem e nada muda.
    expect(
      verificarToken(
        linksDoDestinatario("https://app.exemplo.invalid", { o: ORG, r: DEST, teste: true }).token,
      )?.k,
    ).toBe("t");
  });
});

// ─── o descadastro de um clique e o conteúdo ────────────────────────────────

describe("o e-mail que sai", () => {
  it("leva List-Unsubscribe com o endereço https e o List-Unsubscribe-Post de um clique (RFC 8058)", () => {
    const mime = montarMime({
      de: { nome: "Equipe Exemplo", endereco: "contato@exemplo.invalid" },
      para: "pessoa@exemplo.invalid",
      assunto: "Novidades de novembro",
      html: "<p>oi</p>",
      texto: "oi",
      descadastro:
        "https://app.exemplo.invalid/api/v1/webhooks/email-marketing/descadastro/abc.def",
    });
    expect(mime).toContain(
      "List-Unsubscribe: <https://app.exemplo.invalid/api/v1/webhooks/email-marketing/descadastro/abc.def>",
    );
    expect(mime).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  });

  it("o teste sai com [TESTE] no assunto, e o rodapé com os links de descadastro e preferências", () => {
    const m = montarEmail({
      campanha: {
        assunto: "Oi, {{primeiro_nome}}",
        preCabecalho: "",
        blocos: [{ id: "x", tipo: "texto", texto: "Olá" }],
        reservas: { primeiro_nome: "cliente" },
      },
      valores: { nome: null, empresa: null, responsavel: null, campos: null },
      nomeDaEmpresa: "Empresa Exemplo",
      cor: { fundo: "#111827", frente: "#ffffff" },
      rodape: {
        razaoSocial: "Exemplo LTDA",
        cnpj: "00.000.000/0001-00",
        endereco: "Rua Exemplo, 1",
        motivo: "Você se cadastrou.",
        privacidadeUrl: "https://exemplo.invalid/privacidade",
      },
      links: {
        descadastro: "https://app.exemplo.invalid/d",
        preferencias: "https://app.exemplo.invalid/p",
        pixel: null,
      },
      quando: { agora: new Date("2026-10-26T15:00:00Z"), fuso: FUSO },
      teste: true,
    });
    expect(m.assunto).toBe("[TESTE] Oi, cliente");
    expect(m.html).toContain("https://app.exemplo.invalid/d");
    expect(m.html).toContain("https://app.exemplo.invalid/p");
    expect(m.texto).toContain("https://app.exemplo.invalid/d");
  });

  it("o robô de segurança é reconhecido pelo agente", () => {
    expect(ehAgenteDeRobo("Mozilla/5.0 (compatible; Barracuda Sentinel)")).toBe(true);
    expect(ehAgenteDeRobo("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(false);
  });
});

// ─── o domínio ──────────────────────────────────────────────────────────────

describe("o domínio: seis registros, e provedor gratuito não serve", () => {
  it("recusa gmail.com e afins, e aceita o domínio da empresa", () => {
    expect(recusaDoDominio("gmail.com")).toBeTruthy();
    expect(recusaDoDominio("hotmail.com")).toBeTruthy();
    expect(recusaDoDominio("nao é dominio")).toBeTruthy();
    expect(recusaDoDominio("exemplo.com.br")).toBeNull();
  });

  const entrada = {
    dominio: "exemplo.com.br",
    dkimTokens: ["tok1", "tok2", "tok3"],
    subdominioDeRetorno: "envio",
    regiao: "sa-east-1",
  };

  it("são seis: três DKIM, o MX e o SPF do retorno, e o DMARC", () => {
    const r = registrosDoDominio(entrada);
    expect(r.map((x) => x.id)).toEqual(["dkim1", "dkim2", "dkim3", "mx", "spf", "dmarc"]);
    expect(r.find((x) => x.id === "dkim1")).toMatchObject({
      tipo: "CNAME",
      nome: "tok1._domainkey.exemplo.com.br",
    });
    expect(r.find((x) => x.id === "mx")).toMatchObject({
      tipo: "MX",
      nome: "envio.exemplo.com.br",
    });
    expect(r.find((x) => x.id === "dmarc")).toMatchObject({
      tipo: "TXT",
      nome: "_dmarc.exemplo.com.br",
    });
  });

  it("verificado só com os seis; com cinco, trava", async () => {
    const tudo: ResolvedoresDeDns = {
      resolveCname: async (n) => [`${n.split(".")[0]}.dkim.amazonses.com`],
      resolveMx: async () => [{ exchange: "feedback-smtp.sa-east-1.amazonses.com", priority: 10 }],
      resolveTxt: async (n) =>
        n.startsWith("_dmarc") ? [["v=DMARC1; p=none"]] : [["v=spf1 include:amazonses.com ~all"]],
    };
    const seis = await conferirRegistros(entrada, tudo);
    expect(dominioVerificado(seis)).toBe(true);
    const semDmarc = await conferirRegistros(entrada, {
      ...tudo,
      resolveTxt: async (n) =>
        n.startsWith("_dmarc") ? [] : [["v=spf1 include:amazonses.com ~all"]],
    });
    expect(dominioVerificado(semDmarc)).toBe(false);
    expect(semDmarc.dmarc).toBe(false);
  });
});

// ─── a Amazon: a assinatura V4 e o aviso do SNS ─────────────────────────────

describe("a assinatura V4, contra o vetor publicado pela Amazon (get-vanilla)", () => {
  it("bate byte a byte", () => {
    const cab = assinarV4(
      { metodo: "GET", host: "example.amazonaws.com", caminho: "/" },
      {
        chave: "AKIDEXAMPLE",
        segredo: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
        regiao: "us-east-1",
        servico: "service",
      },
      new Date("2015-08-30T12:36:00Z"),
    );
    expect(cab.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, " +
        "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });
});

describe("o aviso do SNS: sem a assinatura certa, nada entra", () => {
  const TOPICO = "arn:aws:sns:sa-east-1:000000000000:avisos-de-email";
  const CERT = "https://sns.sa-east-1.amazonaws.com/SimpleNotificationService-exemplo.pem";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const baixar = async () => pem;

  function aviso(p: Partial<MensagemDoSns> = {}): MensagemDoSns {
    const m = lerMensagemDoSns({
      Type: "Notification",
      MessageId: "m-1",
      TopicArn: TOPICO,
      Message: JSON.stringify({
        eventType: "Delivery",
        mail: { messageId: "ses-1" },
        delivery: { timestamp: "2026-10-26T15:00:00Z" },
      }),
      Timestamp: "2026-10-26T15:00:00.000Z",
      SignatureVersion: "2",
      Signature: "x",
      SigningCertURL: CERT,
      ...p,
    })!;
    const assinador = createSign("RSA-SHA256");
    assinador.update(textoAssinadoPeloSns(m), "utf8");
    return {
      ...m,
      Signature: assinador.sign(privateKey, "base64"),
      ...("Signature" in p ? { Signature: p.Signature! } : {}),
    };
  }
  const agora = new Date("2026-10-26T15:01:00Z");

  it("assinado, do tópico certo e recente: passa, e o evento é lido", async () => {
    esquecerCertificados();
    const m = aviso();
    expect(await conferirAviso(m, { topicoEsperado: TOPICO, agora, baixar })).toBeNull();
    expect(lerEventoDaSes(m.Message)).toMatchObject({ tipo: "entrega", messageId: "ses-1" });
  });

  it("assinatura forjada, tópico estranho, certificado fora da Amazon, aviso velho e tópico não configurado: recusa", async () => {
    esquecerCertificados();
    expect(
      await conferirAviso(
        { ...aviso(), Message: '{"eventType":"Bounce"}' },
        { topicoEsperado: TOPICO, agora, baixar },
      ),
    ).toBe("assinatura_invalida");
    expect(
      await conferirAviso(aviso({ Signature: "Zm9yamFkbw==" }), {
        topicoEsperado: TOPICO,
        agora,
        baixar,
      }),
    ).toBe("assinatura_invalida");
    expect(
      await conferirAviso(aviso({ TopicArn: "arn:aws:sns:sa-east-1:999999999999:outro" }), {
        topicoEsperado: TOPICO,
        agora,
        baixar,
      }),
    ).toBe("topico_estranho");
    expect(
      await conferirAviso(
        aviso({ SigningCertURL: "https://sns.sa-east-1.amazonaws.com.atacante.invalid/x.pem" }),
        { topicoEsperado: TOPICO, agora, baixar },
      ),
    ).toBe("certificado_fora_da_amazon");
    expect(
      await conferirAviso(aviso({ Timestamp: "2026-10-20T15:00:00.000Z" }), {
        topicoEsperado: TOPICO,
        agora,
        baixar,
      }),
    ).toBe("aviso_velho");
    expect(await conferirAviso(aviso(), { topicoEsperado: "", agora, baixar })).toBe(
      "sem_topico_configurado",
    );
  });
});
