import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AuthUser } from "@/lib/auth/types";

/**
 * PATCH /api/v1/ai/providers — o padrão da organização ganha superfície.
 *
 * O padrão (`organizations.settings.llm`) decide o modelo de TODO ponto que não
 * tem binding explícito — numa instalação recém-criada, 24 dos 25. Até aqui ele
 * só era escrito de raspão, pela primeira publicação de um agente
 * (`lib/ai/agents/first-publication.ts`), e não tinha tela nenhuma: violava o
 * invariante 6 do Sistema Vivo ("toda configuração tem superfície").
 *
 * O caso que este arquivo existe para vigiar é o segundo: `settings` é um jsonb
 * COMPARTILHADO — `branding`, `security` e o que mais vier moram nele. Escrever
 * `{ llm: ... }` por cima apaga a marca da instalação e a política de MFA em
 * silêncio, e o sintoma aparece dias depois, longe daqui.
 *
 * ═══ E O TERCEIRO CASO, QUE UM TESTE DE UNIDADE NÃO PODE VER SOZINHO ═══
 *
 * A RLS de `organizations` só deixa ESCREVER platform admin. Com o cliente de
 * sessão, o `update` casa ZERO linhas para o `admin` do próprio tenant — e o
 * PostgREST devolve **sucesso**, sem erro: a tela diria "salvo" e nada teria
 * sido gravado. Medido: `admin` da org → 0 linhas; cliente admin → 1.
 *
 * Nenhum mock enxerga isso, porque o stub abaixo sempre dá certo. Por isso o
 * `createClient` e o `createAdminClient` são dublês DIFERENTES aqui, e há um
 * caso que afirma qual dos dois escreveu — trocar de volta reprova, mesmo com
 * o comportamento visível idêntico. A varredura por classe vive em
 * `tests/unit/escrita-em-organizations-usa-cliente-admin.test.ts`.
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));

afterEach(() => {
  vi.unstubAllEnvs();
});

const ORG_ID = "22222222-2222-4222-8222-222222222222";

/** O que o `baseline.sql` semeia para openai — o catálogo "já existente". */
const CATALOGO_SEMEADO = ["gpt-5.4-mini"];
const USER_ID = "11111111-1111-4111-8111-111111111111";

/** O que já vive em `settings` e não pode sumir quando o padrão é gravado. */
const SETTINGS_EXISTENTES = {
  branding: { app_name: "THOTH CRM", accent_hex: "#506d48" },
  security: { mfa_required: false },
  llm: { provider: "anthropic", default_model: "claude-sonnet-5" },
};

interface EstadoDoBanco {
  atualizacao: Record<string, unknown> | null;
  /**
   * Os modelos que `ai_models` conhece para o provedor pedido. Lista VAZIA é
   * o estado de uma instalação em que a sincronização do catálogo nunca
   * rodou — que NÃO é a mesma coisa que "o catálogo existe e este modelo não
   * está nele", e é a diferença que a rota precisa enxergar.
   */
  catalogo: string[];
  /**
   * FORK MIA (9172): as credenciais da empresa que a trava "provedor sem
   * chave" enxerga (ativas e validadas). Lidas pelo cliente admin.
   */
  credenciais?: Array<{ provider: string; is_active: boolean; validated_at: string | null }>;
}

function stubDoBanco(estado: EstadoDoBanco) {
  return {
    from(tabela: string) {
      if (tabela === "organizations") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          update(payload: Record<string, unknown>) {
            estado.atualizacao = payload;
            return this;
          },
          maybeSingle() {
            return Promise.resolve({
              data: estado.atualizacao
                ? { settings: estado.atualizacao.settings }
                : { settings: SETTINGS_EXISTENTES },
              error: null,
            });
          },
        };
      }
      if (tabela === "ai_models") {
        // A tabela responde por FILTRO, como o PostgREST: com `model_id` no
        // `where`, só há resposta se aquele modelo estiver no catálogo; sem ele,
        // a resposta diz apenas se o provedor tem alguma linha. É essa diferença
        // que separa "modelo errado" (404) de "catálogo ainda não sincronizou"
        // (grava, com aviso).
        const filtros: Record<string, string> = {};
        return {
          select() {
            return this;
          },
          eq(coluna: string, valor: string) {
            filtros[coluna] = valor;
            return this;
          },
          limit() {
            return this;
          },
          maybeSingle() {
            const alvo = filtros.model_id;
            const achado =
              alvo === undefined ? estado.catalogo[0] : estado.catalogo.find((m) => m === alvo);
            return Promise.resolve({
              data: achado === undefined ? null : { model_id: achado },
              error: null,
            });
          },
        };
      }
      if (tabela === "ai_provider_credentials") {
        const lista = estado.credenciais ?? [];
        const cadeia = {
          select: () => cadeia,
          eq: () => cadeia,
          not: () => cadeia,
          then: (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) =>
            Promise.resolve({ data: lista, error: null }).then(ok, erro),
        };
        return cadeia;
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  };
}

function autorizadoComoAdmin() {
  const user: AuthUser = {
    id: USER_ID,
    email: "dono@example.com",
    full_name: null,
    avatar_url: null,
    // Fork MIA: trocar/apagar chave e mudar o padrão de IA são da plataforma
    // (lib/ai/trava-da-ia.ts). O admin daqui é também admin de plataforma — o
    // upstream o autoriza igual; o lado do cliente é cobrado em
    // tests/unit/trava-da-ia-portas.test.ts. Precedente: credenciais-aceita-a-chave-do-jev.
    is_platform_admin: true,
    idioma: "pt-BR" as const,
  } as AuthUser;
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user,
    org: { orgId: ORG_ID, role: "admin" },
  } as unknown as Awaited<ReturnType<typeof requireRole>>);
}

function requisicao(corpo: unknown) {
  return new NextRequest("http://localhost/api/v1/ai/providers", {
    method: "PATCH",
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  });
}

describe("PATCH /api/v1/ai/providers — padrão da organização", () => {
  let estado: EstadoDoBanco;
  let estadoDeSessao: EstadoDoBanco;

  beforeEach(() => {
    vi.clearAllMocks();
    // FORK MIA (9172): a instalação de teste tem as chaves da OpenAI e da
    // OpenRouter, e não a da Anthropic — o retrato da produção. Sem chave, o
    // PATCH recusa (casos no fim do arquivo).
    vi.stubEnv("OPENAI_API_KEY", "sk-teste-da-instalacao");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-teste-da-instalacao");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    estado = { atualizacao: null, catalogo: CATALOGO_SEMEADO };
    estadoDeSessao = { atualizacao: null, catalogo: CATALOGO_SEMEADO };
    vi.mocked(requireSupportWrite).mockResolvedValue(null);
    vi.mocked(createClient).mockResolvedValue(
      stubDoBanco(estadoDeSessao) as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    // Dublê SEPARADO de propósito: é `estado` (o do admin) que as asserções
    // leem, então uma escrita pelo cliente de sessão aparece como ausência.
    vi.mocked(createAdminClient).mockReturnValue(
      stubDoBanco(estado) as unknown as ReturnType<typeof createAdminClient>,
    );
    autorizadoComoAdmin();
  });

  it("grava o padrão SEM apagar as outras chaves de settings", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(requisicao({ provider: "openai", default_model: "gpt-5.4-mini" }));

    expect(res.status).toBe(200);

    const settings = (estado.atualizacao?.settings ?? {}) as Record<string, unknown>;
    // O que mudou:
    expect(settings.llm).toEqual({ provider: "openai", default_model: "gpt-5.4-mini" });
    // O que NÃO podia ser tocado:
    expect(settings.branding).toEqual(SETTINGS_EXISTENTES.branding);
    expect(settings.security).toEqual(SETTINGS_EXISTENTES.security);
    // FORK MIA (9172): salvar o padrão aqui é a escolha própria — a empresa
    // deixa de seguir a IA da plataforma, na MESMA escrita.
    expect(estado.atualizacao?.ia_segue_a_plataforma).toBe(false);
  });

  it("escreve pelo CLIENTE ADMIN, não pelo de sessão", async () => {
    // A RLS de `organizations` só deixa escrever platform admin: pelo cliente
    // de sessão isto casaria zero linhas e o PostgREST devolveria sucesso.
    const { PATCH } = await import("./route");
    await PATCH(requisicao({ provider: "openai", default_model: "gpt-5.4-mini" }));

    expect(estado.atualizacao, "o cliente admin não gravou").not.toBeNull();
    expect(
      estadoDeSessao.atualizacao,
      "o cliente de SESSÃO gravou — com a RLS real isto casaria zero linhas e " +
        "voltaria como sucesso, com a tela dizendo 'salvo'",
    ).toBeNull();
  });

  it("recusa provedor que esta instalação não suporta", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(requisicao({ provider: "foobar", default_model: "qualquer" }));

    expect(res.status).toBe(422);
    expect(estado.atualizacao).toBeNull();
  });

  it("recusa modelo que não está no catálogo do provedor", async () => {
    // `ai_models` é catálogo global e é lido pelo cliente de SESSÃO — só a
    // escrita em `organizations` precisa do admin. Por isso o catálogo vai no
    // dublê de sessão, e não no do admin.
    //
    // O catálogo EXISTE (é o do `baseline.sql`) e o modelo pedido não está nele:
    // é o erro de digitação, e continua sendo recusado.
    estadoDeSessao.catalogo = ["gpt-5.4-mini"];
    const { PATCH } = await import("./route");
    const res = await PATCH(requisicao({ provider: "openai", default_model: "modelo-que-nao-existe" }));

    expect(res.status).toBe(404);
    expect(estado.atualizacao).toBeNull();
  });

  it("grava — com aviso — quando o catálogo do provedor ainda não sincronizou", async () => {
    // O defeito da #765: numa VPS recém-instalada o `ai_models` não tem NENHUMA
    // linha do provedor escolhido (o cron de sincronização nunca rodou). A
    // conferência do par (provider, model_id) recusava todo modelo então —
    // inclusive o certo, digitado de dentro da tela, que é o único caminho
    // disponível com o combo vazio. Sem catálogo não há o que conferir: a
    // escrita passa, e o aviso é o que impede a tela de dizer "salvo" como se
    // alguém tivesse validado o identificador.
    estadoDeSessao.catalogo = [];
    const modelo = "meta-llama/llama-3.3-70b-instruct";
    const { PATCH } = await import("./route");
    const res = await PATCH(requisicao({ provider: "openrouter", default_model: modelo }));

    expect(res.status).toBe(200);

    const settings = (estado.atualizacao?.settings ?? {}) as Record<string, unknown>;
    expect(settings.llm).toEqual({ provider: "openrouter", default_model: modelo });

    const json = (await res.json()) as { data: { avisos: string[] } };
    expect(json.data.avisos).toHaveLength(1);
    expect(json.data.avisos[0]).toContain("openrouter");
    expect(json.data.avisos[0]).toContain(modelo);
  });

  it("não avisa quando o modelo está no catálogo do provedor", async () => {
    // O aviso não pode virar ruído na instalação sadia: com o catálogo
    // sincronizado, gravar um modelo conhecido não rende aviso nenhum.
    const { PATCH } = await import("./route");
    const res = await PATCH(requisicao({ provider: "openai", default_model: "gpt-5.4-mini" }));

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { avisos: string[] } };
    expect(json.data.avisos).toEqual([]);
  });

  it("exige papel admin — a troca do padrão muda todo ponto herdado", async () => {
    const { PATCH } = await import("./route");
    await PATCH(requisicao({ provider: "openai", default_model: "gpt-5.4-mini" }));

    expect(vi.mocked(requireRole)).toHaveBeenCalledWith(
      "admin",
      expect.objectContaining({ resource: "ai_providers" }),
    );
  });
});

// FORK MIA (9172, MIA-217): a trava no servidor. Salvar o padrão num provedor
// sem chave utilizável (própria, ativa e validada, ou da instalação) deixaria a
// empresa sem IA — é exatamente o estado em que 14 empresas estavam.
describe("PATCH /api/v1/ai/providers — provedor sem chave é recusado", () => {
  let estado: EstadoDoBanco;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "sk-teste-da-instalacao");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    estado = { atualizacao: null, catalogo: ["claude-sonnet-5"], credenciais: [] };
    vi.mocked(requireSupportWrite).mockResolvedValue(null);
    vi.mocked(createClient).mockResolvedValue(
      stubDoBanco({ atualizacao: null, catalogo: ["claude-sonnet-5"] }) as unknown as Awaited<
        ReturnType<typeof createClient>
      >,
    );
    vi.mocked(createAdminClient).mockReturnValue(
      stubDoBanco(estado) as unknown as ReturnType<typeof createAdminClient>,
    );
    autorizadoComoAdmin();
  });

  it("sem chave da instalação e sem chave da empresa: 422 ia_sem_chave, e nada é gravado", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(requisicao({ provider: "anthropic", default_model: "claude-sonnet-5" }));

    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe("ia_sem_chave");
    expect(json.error.message).toContain("Anthropic (Claude) não tem chave nesta instalação");
    expect(json.error.message).toContain("deixe a empresa seguindo a IA da plataforma");
    expect(estado.atualizacao).toBeNull();
  });

  it("chave da empresa cadastrada mas NÃO validada não conta", async () => {
    estado.credenciais = [{ provider: "anthropic", is_active: true, validated_at: null }];
    const { PATCH } = await import("./route");
    const res = await PATCH(requisicao({ provider: "anthropic", default_model: "claude-sonnet-5" }));

    expect(res.status).toBe(422);
    expect(estado.atualizacao).toBeNull();
  });

  it("com a chave da empresa ativa e validada, grava e vira escolha própria", async () => {
    estado.credenciais = [{ provider: "anthropic", is_active: true, validated_at: "2026-11-01T00:00:00Z" }];
    const { PATCH } = await import("./route");
    const res = await PATCH(requisicao({ provider: "anthropic", default_model: "claude-sonnet-5" }));

    expect(res.status).toBe(200);
    expect(estado.atualizacao?.ia_segue_a_plataforma).toBe(false);
  });

  it("com a chave da instalação, grava sem a empresa ter chave própria", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-da-instalacao");
    const { PATCH } = await import("./route");
    const res = await PATCH(requisicao({ provider: "anthropic", default_model: "claude-sonnet-5" }));

    expect(res.status).toBe(200);
  });
});
