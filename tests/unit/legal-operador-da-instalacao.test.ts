/**
 * O DOCUMENTO LEGAL NÃO PODE TROCAR DE NOME CONFORME QUEM O LÊ (item E7).
 *
 * ── O defeito ─────────────────────────────────────────────────────────────
 *
 * `/legal/privacy` afirma: "O controlador dos dados tratados aqui é <X> — quem
 * instalou e opera este sistema." E `<X>` saía da ORGANIZAÇÃO ATIVA DA SESSÃO.
 *
 * Num self-host está certo, e é o desenho original: uma instalação, um
 * operador, e a organização é ele. No modelo GERENCIADO — uma instalação da
 * Time Company com Academia Reativa, Body Fit e Ultra Sorriso dentro — abrir a
 * página com a Reativa selecionada fazia o documento declarar que a Academia
 * Reativa instalou o servidor e controla os dados de TODOS os tenants.
 *
 * E o nome MUDAVA conforme o leitor: o mesmo documento, na mesma URL, no mesmo
 * instante, nomeando controladores diferentes para pessoas diferentes.
 *
 * ── O que este arquivo mede ───────────────────────────────────────────────
 *
 * As quatro propriedades do interruptor (`operador_razao_social`):
 *
 *   1. declarado vence a sessão, e vence SEM sessão nenhuma;
 *   2. não declarado mantém o self-host exatamente como era;
 *   3. razão social em branco NÃO liga o modo gerenciado (senão o documento
 *      diria "o controlador é " e pararia);
 *   4. leitura que FALHA não vira "não há operador declarado" — isso devolveria
 *      a instalação gerenciada ao self-host em silêncio, e o documento voltaria
 *      a nomear o cliente.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const platformBranding = vi.hoisted(() => ({
  linha: null as Record<string, unknown> | null,
  erro: null as { message: string } | null,
}));

const sessao = vi.hoisted(() => ({
  usuario: null as { id: string } | null,
  org: null as { orgId: string } | null,
  organizacao: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: platformBranding.linha,
            error: platformBranding.erro,
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: sessao.organizacao, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: async () => sessao.usuario,
  resolveActiveOrg: async () => sessao.org,
}));

vi.mock("@/lib/branding", () => ({ branding: () => ({ name: "MIA" }) }));

vi.mock("@/lib/env", () => ({ env: { LGPD_DPO_EMAIL: "dpo@plataforma.test" } }));

import { nomeDoOperador, resolverOperador } from "@/lib/legal/operador";

/** A instalação gerenciada: a Time Company declarou que é ela quem opera. */
const DECLARADO = {
  operador_razao_social: "Time Company Marketing Digital LTDA",
  operador_cnpj: "12.345.678/0001-90",
  operador_dpo_email: "privacidade@timecompany.test",
  operador_politica_url: "https://timecompany.test/privacidade",
};

/** Um CLIENTE dentro dessa instalação. Nunca deve aparecer como controlador. */
const CLIENTE = {
  display_name: "Academia Reativa",
  legal_name: "Reativa Atividades Fisicas LTDA",
  cnpj: "98.765.432/0001-10",
  dpo_email: "contato@reativa.test",
  privacy_policy_url: null,
};

beforeEach(() => {
  platformBranding.linha = null;
  platformBranding.erro = null;
  sessao.usuario = null;
  sessao.org = null;
  sessao.organizacao = null;
});

describe("o operador da instalação", () => {
  it("declarado VENCE a organização da sessão", async () => {
    platformBranding.linha = DECLARADO;
    sessao.usuario = { id: "u1" };
    sessao.org = { orgId: "org-reativa" };
    sessao.organizacao = CLIENTE;

    const op = await resolverOperador();

    expect(
      nomeDoOperador(op),
      "com um operador declarado, quem está logado não pode mudar quem responde",
    ).toBe("Time Company Marketing Digital LTDA");
    expect(op.cnpj).toBe("12.345.678/0001-90");
    expect(op.dpoEmail).toBe("privacidade@timecompany.test");
  });

  it("declarado vale também SEM sessão — é o leitor mais importante", async () => {
    // Quem colou o link e nunca teve conta é exatamente para quem a política
    // existe. Antes, esse leitor via "o operador desta instalação" e nada mais.
    platformBranding.linha = DECLARADO;

    const op = await resolverOperador();

    expect(nomeDoOperador(op)).toBe("Time Company Marketing Digital LTDA");
    expect(op.resolvido, "documento completo, não o fallback genérico").toBe(true);
  });

  it("o mesmo documento nomeia o MESMO operador para leitores diferentes", async () => {
    platformBranding.linha = DECLARADO;

    sessao.usuario = { id: "u1" };
    sessao.org = { orgId: "org-reativa" };
    sessao.organizacao = CLIENTE;
    const comCliente = nomeDoOperador(await resolverOperador());

    sessao.usuario = null;
    sessao.org = null;
    sessao.organizacao = null;
    const semNinguem = nomeDoOperador(await resolverOperador());

    expect(
      comCliente,
      "uma política de privacidade que muda de controlador conforme o leitor " +
        "não é uma política de privacidade",
    ).toBe(semNinguem);
  });

  it("SEM operador declarado, o self-host continua exatamente como era", async () => {
    // A garantia de compatibilidade: quem instalou de graça numa VPS não
    // preenche nada e nada muda para ele.
    platformBranding.linha = null;
    sessao.usuario = { id: "u1" };
    sessao.org = { orgId: "org-unica" };
    sessao.organizacao = CLIENTE;

    const op = await resolverOperador();

    expect(nomeDoOperador(op)).toBe("Reativa Atividades Fisicas LTDA");
    expect(op.dpoEmail).toBe("contato@reativa.test");
  });

  it("razão social em BRANCO não liga o modo gerenciado", async () => {
    // Senão o documento diria "O controlador dos dados tratados aqui é " e
    // pararia — pior que nomear o cliente errado, porque não nomeia ninguém.
    platformBranding.linha = { ...DECLARADO, operador_razao_social: "   " };
    sessao.usuario = { id: "u1" };
    sessao.org = { orgId: "org-unica" };
    sessao.organizacao = CLIENTE;

    const op = await resolverOperador();

    expect(nomeDoOperador(op)).toBe("Reativa Atividades Fisicas LTDA");
  });

  it("leitura que FALHA não devolve a instalação ao self-host", async () => {
    // O modo de falha que importa: um erro transitório no banco não pode fazer
    // o documento voltar a nomear o CLIENTE como controlador. O caminho seguro
    // é o texto genérico — íntegro, e sem acusar ninguém.
    platformBranding.erro = { message: "connection reset" };
    sessao.usuario = { id: "u1" };
    sessao.org = { orgId: "org-reativa" };
    sessao.organizacao = CLIENTE;

    const op = await resolverOperador();

    expect(nomeDoOperador(op)).toBe("o operador desta instalação");
    expect(op.resolvido).toBe(false);
    expect(
      op.razaoSocial,
      "não pode cair no cliente nem 'na dúvida' — a dúvida é o caso perigoso",
    ).toBeNull();
  });

  it("a política do operador passa pela guarda de URL, mesmo declarada", async () => {
    // `z.string().url()` aceita `javascript:` — e `/legal/privacy` faz
    // `redirect(op.politicaPropria)`. Um admin de plataforma não é ameaça aqui,
    // mas a guarda vale para o valor que já está gravado no banco, de qualquer
    // origem e de qualquer época.
    platformBranding.linha = {
      ...DECLARADO,
      operador_politica_url: "javascript:alert(1)",
    };

    const op = await resolverOperador();

    expect(op.politicaPropria).toBeNull();
    expect(nomeDoOperador(op), "o resto do documento segue íntegro").toBe(
      "Time Company Marketing Digital LTDA",
    );
  });

  it("sem encarregado declarado, cai no da instalação — nunca em branco", async () => {
    platformBranding.linha = { ...DECLARADO, operador_dpo_email: null };

    const op = await resolverOperador();

    expect(op.dpoEmail).toBe("dpo@plataforma.test");
  });
});
