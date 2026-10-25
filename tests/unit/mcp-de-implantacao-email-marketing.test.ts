/**
 * FORK MIA (.89) — O DISPARO DE E-MAIL MARKETING AO ALCANCE DO MCP DE
 * PLATAFORMA (regra do dono do produto: toda função nova entra no MCP na mesma
 * versão). docs/fork/email-marketing.md e docs/fork/mcp-de-implantacao.md.
 *
 * A CONTAGEM da lista mora aqui desde a .89: 83 (as 69 da .86, as cinco do
 * assistente da .88 e as nove do e-mail). E a regra que não pode virar: o MCP NUNCA dispara. Ele monta o
 * rascunho e manda o teste, só para a equipe do cliente; quem envia é uma
 * pessoa da empresa, pela tela, com a declaração da base legal.
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia, e-mails `@exemplo.invalid`.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Ses from "@/lib/email/ses";
import { z } from "zod";

import {
  cenarioDaImplantacao,
  clienteMcp,
  ORG,
  TODAS_AS_OPERACOES,
  type OpcoesDoCenario,
} from "@/tests/helpers/implantacao-em-memoria";
import type { Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown, amazonLigada: true }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
vi.mock("@/lib/ai/embeddings/chave", () => ({ temChaveDeEmbedding: vi.fn(async () => true) }));
vi.mock("@/lib/email/ses", async (original) => {
  const o = await original<typeof Ses>();
  return {
    ...o,
    configuracaoDaAmazon: (ambiente?: Parameters<typeof o.configuracaoDaAmazon>[0]) =>
      ambiente
        ? o.configuracaoDaAmazon(ambiente)
        : estado.amazonLigada
          ? {
              configurado: true,
              falta: [],
              regiao: "sa-east-1",
              conjuntoDeConfiguracao: "conjunto",
              topicoDosAvisos: "arn:aws:sns:sa-east-1:000000000000:t",
            }
          : {
              configurado: false,
              falta: ["AWS_SES_ACCESS_KEY_ID"],
              regiao: "sa-east-1",
              conjuntoDeConfiguracao: "",
              topicoDosAvisos: "",
            },
    // Nada aqui fala com a Amazon de verdade: o envio é um dublê que conta.
    enviarPelaAmazon: vi.fn(async () => ({
      ok: true,
      dados: { messageId: `ses-${Math.random()}` },
    })),
  };
});

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { FERRAMENTAS } = await import("@/lib/mcp-plataforma/ferramentas");
const { OPERACOES } = await import("@/lib/mcp-plataforma/operacoes");
const { FERRAMENTAS_DE_EMAIL_MARKETING } =
  await import("@/lib/mcp-plataforma/ferramentas/email-marketing");
const ses = await import("@/lib/email/ses");

const ANA = { id: "0b000000-0000-4000-8000-0000000000a1", email: "ana@exemplo.invalid" };

async function preparar(opcoes: OpcoesDoCenario & { comModulo?: boolean } = {}) {
  const cenario = cenarioDaImplantacao(opcoes);
  cenario.usuarios.set(ANA.id, { email: ANA.email, nome: "ana" });
  cenario.banco.tabela("user_organizations").push({
    id: randomUUID(),
    organization_id: ORG,
    user_id: ANA.id,
    role: "manager",
    accepted_at: "2026-01-02T00:00:00Z",
    revoked_at: null,
    created_at: "2026-01-02T00:00:00Z",
  });
  if (opcoes.comModulo) {
    cenario.banco
      .tabela("organization_modules")
      .push({
        id: randomUUID(),
        organization_id: ORG,
        modulo: "email_marketing",
        revoked_at: null,
      });
  }
  estado.cliente = cenario.cliente;
  const mcp = await clienteMcp(criarServidorDePlataforma as never, TODAS_AS_OPERACOES);
  return { ...cenario, mcp, tabela: (nome: string) => cenario.banco.tabela(nome) as Linha[] };
}
type Cenario = Awaited<ReturnType<typeof preparar>>;

async function chamar(c: Cenario, nome: string, args: Record<string, unknown>) {
  return c.mcp.chamar(nome, { organization_id: ORG, ...args });
}

beforeEach(() => {
  estado.amazonLigada = true;
  vi.mocked(ses.enviarPelaAmazon).mockClear();
});

describe("a lista: 85 ferramentas, nove delas do e-mail", () => {
  it("85 = as 69 da .86 + as cinco do assistente (.88) + as nove do e-mail marketing (.89) + as duas das propostas do assistente (.91)", () => {
    expect(FERRAMENTAS).toHaveLength(85);
    expect(FERRAMENTAS_DE_EMAIL_MARKETING).toHaveLength(9);
    // FORK MIA (.91): + plataforma_ver_propostas_do_assistente e plataforma_decidir_proposta_do_assistente
    expect(FERRAMENTAS.filter((f) => /assistente|chamado/.test(f.name))).toHaveLength(7);
  });

  it("leitura livre, escrita nomeada: duas chaves novas, e nenhuma delas dispara", () => {
    const operacao = Object.fromEntries(
      FERRAMENTAS_DE_EMAIL_MARKETING.map((f) => [f.name, f.operacao]),
    );
    expect(operacao).toEqual({
      plataforma_ver_email_marketing: null,
      plataforma_verificar_dominio_de_email: "implantar_configuracao",
      plataforma_configurar_email_marketing: "implantar_configuracao",
      plataforma_garantir_segmentos: "implantar_configuracao",
      plataforma_garantir_modelos_de_email: "implantar_configuracao",
      plataforma_importar_consentimentos: "importar_consentimentos",
      plataforma_importar_supressao: "implantar_configuracao",
      plataforma_criar_campanha_de_email: "criar_campanha_de_email",
      plataforma_ver_campanhas_de_email: null,
    });
    for (const chave of ["importar_consentimentos", "criar_campanha_de_email"]) {
      const op = OPERACOES.find((o) => o.chave === chave);
      expect(op?.raio.length, chave).toBeGreaterThan(80);
    }
    expect(OPERACOES.find((o) => o.chave === "criar_campanha_de_email")?.raio).toContain(
      "Não dispara",
    );
  });

  it("toda ferramenta do e-mail tem exemplo que passa no próprio schema (as duas de importação inclusive)", () => {
    for (const f of FERRAMENTAS_DE_EMAIL_MARKETING) {
      const lido = z.strictObject(f.inputSchema).safeParse(f.exemplo);
      expect(
        lido.success,
        `${f.name}: ${lido.success ? "" : JSON.stringify(lido.error.issues)}`,
      ).toBe(true);
    }
  });
});

describe("⭐ o MCP NUNCA dispara", () => {
  const raiz = join(__dirname, "..", "..", "lib", "mcp-plataforma");
  const fontes = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? fontes(join(dir, e.name))
        : e.name.endsWith(".ts")
          ? [join(dir, e.name)]
          : [],
    );

  it("nenhum arquivo do MCP de plataforma importa a confirmação, o motor ou o controle da campanha", () => {
    const proibidos =
      /\b(confirmarCampanha|retomarCampanha|rodadaDoEmailMarketing|rodarUmaCampanha)\b/;
    const achados = fontes(raiz).filter((f) =>
      proibidos.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")),
    );
    expect(achados).toEqual([]);
  });

  it("nenhuma ferramenta se chama disparar, confirmar ou enviar campanha", () => {
    expect(
      FERRAMENTAS.map((f) => f.name).filter(
        (n) => /email|e_mail/.test(n) && /disparar|confirmar|enviar|retomar/.test(n),
      ),
    ).toEqual([]);
  });

  it("criar a campanha deixa um RASCUNHO, de origem mcp, e não põe ninguém na fila", async () => {
    const c = await preparar({ comModulo: true });
    const r = await chamar(c, "plataforma_criar_campanha_de_email", {
      nome: "Novidades de novembro",
      assunto: "Oi",
    });
    expect(r.erro, r.texto).toBe(false);
    expect(c.tabela("mia_email_campanhas")).toHaveLength(1);
    expect(c.tabela("mia_email_campanhas")[0]).toMatchObject({ status: "rascunho", origem: "mcp" });
    expect(c.tabela("mia_email_destinatarios")).toHaveLength(0);
    expect(r.texto).toContain("O MCP não dispara");
    expect(ses.enviarPelaAmazon).not.toHaveBeenCalled();
  });
});

describe("o teste pelo MCP vai só para a equipe", () => {
  it("endereço de fora da equipe: recusa ANTES de gravar, e nada sai", async () => {
    const c = await preparar({ comModulo: true });
    const r = await chamar(c, "plataforma_criar_campanha_de_email", {
      nome: "Novidades",
      teste_para: ["alguem@fora.invalid"],
    });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("só para e-mails da equipe");
    expect(c.tabela("mia_email_campanhas")).toHaveLength(0);
    expect(ses.enviarPelaAmazon).not.toHaveBeenCalled();
  });

  it("⭐ na empresa de demonstração, o teste é recusado e a Amazon não é chamada", async () => {
    const c = await preparar({ comModulo: true, demonstracao: true });
    const r = await chamar(c, "plataforma_criar_campanha_de_email", {
      nome: "Novidades",
      assunto: "Oi",
      teste_para: [ANA.email],
    });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("demonstração");
    expect(c.tabela("mia_email_testes")).toHaveLength(0);
    expect(ses.enviarPelaAmazon).not.toHaveBeenCalled();
  });

  it("sem o módulo contratado, o teste é recusado", async () => {
    const c = await preparar();
    const r = await chamar(c, "plataforma_criar_campanha_de_email", {
      nome: "Novidades",
      teste_para: [ANA.email],
    });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("não está contratado");
    expect(ses.enviarPelaAmazon).not.toHaveBeenCalled();
  });
});

describe("as escritas que montam", () => {
  it("configurar grava o rodapé e o remetente, e a segunda chamada igual não muda nada", async () => {
    const c = await preparar({ comModulo: true });
    const pedido = {
      configuracao: {
        rodape_razao_social: "Exemplo Comércio LTDA",
        rodape_cnpj: "00.000.000/0001-00",
        rodape_endereco: "Rua Exemplo, 100",
        rodape_motivo: "Você se cadastrou para receber novidades.",
        rodape_usar_privacidade_padrao: true,
        ritmo_por_hora: 200,
      },
      remetentes: [{ nome: "Equipe Exemplo", local: "contato", padrao: true }],
    };
    const r = await chamar(c, "plataforma_configurar_email_marketing", pedido);
    expect(r.erro, r.texto).toBe(false);
    expect(c.tabela("mia_email_config")[0]).toMatchObject({
      rodape_razao_social: "Exemplo Comércio LTDA",
      ritmo_por_hora: 200,
    });
    expect(c.tabela("mia_email_remetentes")).toHaveLength(1);
    const de_novo = await chamar(c, "plataforma_configurar_email_marketing", pedido);
    expect(de_novo.erro, de_novo.texto).toBe(false);
    expect(c.tabela("mia_email_remetentes")).toHaveLength(1);
    expect((de_novo.dados.remetentes as Array<{ desfecho: string }>)[0]!.desfecho).toBe(
      "ja_estava",
    );
  });

  it("importar supressão só acrescenta, e o repetido conta como já estava", async () => {
    const c = await preparar({ comModulo: true });
    const r = await chamar(c, "plataforma_importar_supressao", {
      enderecos: ["saiu@exemplo.invalid", "SAIU@exemplo.invalid", "nao-e-email"],
      de_onde: "Ferramenta anterior",
    });
    expect(r.erro, r.texto).toBe(false);
    expect(c.tabela("campaign_suppressions")).toHaveLength(1);
    expect(c.tabela("campaign_suppressions")[0]).toMatchObject({
      tipo_de_endereco: "email",
      motivo: "importada",
    });
  });

  it("definir preço por e-mail não mexe no preço por mensagem", async () => {
    const c = await preparar();
    c.tabela("tenant_broadcast_pricing").push({
      id: randomUUID(),
      organization_id: ORG,
      preco_por_mensagem_cents: 9,
      alerta_saldo_cents: 500,
    });
    const precos = await clienteMcp(criarServidorDePlataforma as never, ["definir_preco"]);
    const r = await precos.chamar("plataforma_definir_preco", {
      organization_id: ORG,
      preco_por_email_cents: 3,
    });
    expect(r.erro, r.texto).toBe(false);
    expect(c.tabela("tenant_broadcast_pricing")[0]).toMatchObject({
      preco_por_mensagem_cents: 9,
      alerta_saldo_cents: 500,
      preco_por_email_cents: 3,
    });
    expect(r.dados).not.toHaveProperty("preco_por_mensagem_cents");
  });

  it("liberar o módulo email_marketing é aceito (é módulo vendido)", async () => {
    const c = await preparar();
    const r = await chamar(c, "plataforma_liberar_modulo", {
      modulo: "email_marketing",
      liberar: true,
    });
    expect(r.erro, r.texto).toBe(false);
  });

  it("o checklist da implantação ganhou a área do e-mail, opcional sem o módulo", async () => {
    const c = await preparar();
    const r = await chamar(c, "plataforma_ver_implantacao", {});
    expect(r.erro, r.texto).toBe(false);
    expect(r.texto).toContain("E-mail marketing (opcional)");
  });

  it("organização que não existe: as nove recusam e dizem como achar o id", async () => {
    const c = await preparar();
    const inexistente = "0a000000-0000-4000-8000-00000000dead";
    for (const f of FERRAMENTAS_DE_EMAIL_MARKETING) {
      const r = await c.mcp.chamar(f.name, { ...f.exemplo, organization_id: inexistente });
      expect(r.erro, f.name).toBe(true);
      expect(r.texto, f.name).toContain(`Não existe organização com o id ${inexistente}`);
    }
  });
});
