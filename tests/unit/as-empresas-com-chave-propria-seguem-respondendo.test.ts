/**
 * FORK MIA (MIA-262) — AS EMPRESAS COM CHAVE PRÓPRIA SEGUEM RESPONDENDO.
 *
 * A parte B da MIA-251 tira do cliente a tela e o campo da IA (provedor,
 * modelo, chave, consumo e custo), e não muda qual chave a IA usa. Em produção
 * há empresas com chave própria da OpenAI e da TypeSafe, versão publicada presa
 * à chave e o Jev ligado. Este arquivo fixa, com uma empresa de teste nesse
 * estado, que cada filtro novo deixa o caminho da chave como estava:
 *
 *  1. o resolvedor do turno continua escolhendo a credencial da empresa;
 *  2. a versão nova salva pelo admin da empresa (que não escolhe a IA) herda a
 *     chave própria da versão publicada, e não a da instalação;
 *  3. o rascunho existente não perde a chave: o patch do cliente só não a troca;
 *  4. a lista de chaves que o editor recebe sem rótulo e sem final ainda diz se a
 *     chave presa à versão vale (é o que libera o "Publicar");
 *  5. o Jev ligado com a chave TypeSafe validada não acende o aviso da plataforma.
 *
 * Nenhum dado real: a empresa e as chaves são fictícias.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/crypto/aes_gcm", () => ({
  byteaToBuffer: () => Buffer.from(""),
  decryptKey: () => "chave-propria-da-empresa",
}));

import { resolveOrgLlmConfig } from "@/lib/agent-engine/edge/llm/credentials";
import { credenciaisSemChave } from "@/lib/ai/custo-e-da-plataforma";
import { semCamposDaIa, travarIaDaVersaoNova } from "@/lib/ai/trava-da-ia";
import { contarJevSemChave } from "@/lib/ai/aviso-da-ia-das-empresas";

const ORG = "0e262000-0000-4000-8000-000000000001";
const AGENTE = "0e262000-0000-4000-8000-000000000002";
const VERSAO_NO_AR = "0e262000-0000-4000-8000-000000000003";
const CHAVE_OPENAI = "0e262000-0000-4000-8000-000000000004";

const DONO_DA_EMPRESA = { is_platform_admin: false, platform_admin_scope: null, support: null };
const AGENCIA_EM_SUPORTE = {
  is_platform_admin: false,
  platform_admin_scope: null,
  support: { status: "active", organization_id: ORG, access_mode: "full", agency_id: "agencia-1" },
} as never;

const VERSAO_PUBLICADA = {
  provider: "openai",
  model: "modelo-da-empresa",
  credential_id: CHAVE_OPENAI,
  operator_model: null,
  token_budget: 40_000,
  cost_budget_cents: 50,
};

/** O admin client falso: o agente aponta a versão no ar, presa à chave própria. */
function bancoDaEmpresa() {
  return {
    from(tabela: string) {
      const linha =
        tabela === "ai_agents"
          ? { published_version_id: VERSAO_NO_AR }
          : tabela === "ai_agent_versions"
            ? VERSAO_PUBLICADA
            : tabela === "organizations"
              ? { settings: { llm: { provider: "openai" } } }
              : null;
      const cadeia = {
        select: () => cadeia,
        eq: () => cadeia,
        order: () => cadeia,
        limit: () => cadeia,
        maybeSingle: async () => ({ data: linha, error: null }),
      };
      return cadeia;
    },
  } as never;
}

describe("uma empresa com chave própria, depois da MIA-262", () => {
  it("1. o turno continua usando a credencial da empresa", async () => {
    let consulta = 0;
    const pool = {
      query: async () => {
        consulta += 1;
        return consulta === 1
          ? { rows: [{ llm: { provider: "openai", default_model: "modelo-da-empresa" } }] }
          : { rows: [{ api_key_encrypted: "x", api_key_iv: "y", api_key_tag: "z" }] };
      },
    } as never;
    const ia = await resolveOrgLlmConfig(pool, { openaiApiKey: "chave-da-instalacao" }, ORG);
    expect(ia.origemDaChave).toBe("credencial_da_organizacao");
    expect(ia.apiKey).toBe("chave-propria-da-empresa");
  });

  it.each([
    ["o dono da empresa", DONO_DA_EMPRESA],
    ["a agência em suporte", AGENCIA_EM_SUPORTE],
  ])("2. a versão nova salva por %s herda a chave própria e os freios da publicada", async (_nome, user) => {
    // O editor do cliente manda o que tem; mesmo um corpo sem chave não a troca.
    const travada = await travarIaDaVersaoNova(
      bancoDaEmpresa(),
      { user, orgId: ORG, agenteDeReferencia: AGENTE },
      { system_prompt: "novo texto", provider: "openai", model: "outro", credential_id: null, operator_model: null, token_budget: 1, cost_budget_cents: 1 },
    );
    expect(travada.ok).toBe(true);
    if (!travada.ok) return;
    expect(travada.corpo).toMatchObject({
      system_prompt: "novo texto",
      provider: "openai",
      model: "modelo-da-empresa",
      credential_id: CHAVE_OPENAI,
      token_budget: 40_000,
      cost_budget_cents: 50,
    });
  });

  it("3. o rascunho existente: o patch do cliente não troca a chave nem os freios", () => {
    const patch = semCamposDaIa(DONO_DA_EMPRESA, {
      system_prompt: "ajuste",
      credential_id: null,
      token_budget: 1,
      cost_budget_cents: 1,
    });
    expect(patch).toEqual({ system_prompt: "ajuste" });
  });

  it("4. a lista de chaves sem rótulo e sem final ainda diz que a chave da versão vale", () => {
    const [chave] = credenciaisSemChave(
      [
        {
          id: CHAVE_OPENAI,
          provider: "openai",
          label: "Chave da loja",
          api_key_last4: "1234",
          models_available: ["modelo-da-empresa"],
          is_active: true,
          validated_at: "2026-09-20T12:00:00.000Z",
          validation_error: null,
        },
      ],
      false,
    );
    expect(chave).toMatchObject({
      id: CHAVE_OPENAI,
      provider: "openai",
      is_active: true,
      validated_at: "2026-09-20T12:00:00.000Z",
      label: "",
      api_key_last4: null,
      models_available: null,
    });
  });

  // A leitura do lote (Jev ligado + chave TypeSafe validada = `jevSemChave: false`)
  // está em `lib/ai/ia-da-empresa.test.ts`; aqui, o que a plataforma conta.
  it("5. o Jev ligado com a chave TypeSafe validada não acende o aviso da plataforma", () => {
    expect(contarJevSemChave([{ chave: "propria", operante: true, jevSemChave: false }])).toBe(0);
  });
});
