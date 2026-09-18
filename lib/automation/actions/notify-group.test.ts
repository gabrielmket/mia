import { describe, expect, it, vi } from "vitest";

const enviados = vi.hoisted(() => [] as Array<Record<string, unknown>>);
/**
 * Dublê SÓ do envio. O resto do módulo é o de verdade — `entregaEmGrupo`
 * inclusive, que é a pergunta que decide se este canal serve para grupo.
 *
 * Dublar a capability junto faria o teste provar a resposta que ele mesmo
 * escreveu: a matriz poderia dizer que a API oficial entrega em grupo e a prova
 * continuaria verde.
 */
vi.mock("@/lib/channels", async (real) => ({
  ...((await real()) as Record<string, unknown>),
  getAdapter: () => ({
    send: async (envelope: Record<string, unknown>) => {
      enviados.push(envelope);
      return { externalId: "msg-1" };
    },
  }),
}));

import { getAction } from "@/lib/automation/actions";
import "@/lib/automation/actions/notify-group";
import type { ActionCtx } from "@/lib/automation/types";
import {
  CHANNEL_PROVIDER_META,
  CHANNEL_PROVIDER_WAHA,
} from "@/lib/channels/capabilities";

/**
 * O AVISO INTERNO NÃO PODE SAIR PARA UM CLIENTE.
 *
 * Esta ação é a única do motor cujo destinatário é digitado à mão. Todas as
 * outras derivam o destino do contato do evento — e por isso nenhuma delas pode
 * errar a pessoa. Aqui o operador cola um id, e o erro fácil é colar o telefone
 * de alguém no lugar do grupo: o aviso leva nome do lead, horário e o resumo da
 * qualificação que a IA apurou, e isso chegando ao próprio cliente é o pior
 * desfecho possível desta funcionalidade — pior que o aviso não sair.
 *
 * O segundo caso mede a outra ponta: número da API oficial da Meta não envia
 * para grupo. Sem a recusa explícita, a regra ficaria salva e "ativa", o envio
 * morreria num 4xx lá embaixo, e o time concluiria que o produto não avisa.
 *
 *     npx vitest run lib/automation/actions/notify-group.test.ts
 */

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";
const CANAL = "bbbbbbbb-0000-4000-8000-00000000000b";
const GRUPO = "120363405136320907@g.us";

function ctxCom(sessao: Record<string, unknown> | null): ActionCtx {
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: sessao, error: null }) }),
        }),
      }),
    }),
  };
  return {
    admin: admin as unknown as ActionCtx["admin"],
    organizationId: ORG,
    ruleId: "rule-1",
    ruleName: "Reunião marcada → avisa o comercial",
    event: {} as ActionCtx["event"],
    context: { contact: { display_name: "Joana" } },
    requestId: "req-1",
  };
}

const wahaOk = { provider: CHANNEL_PROVIDER_WAHA, waha_session_name: "org_abc", meta_phone_number_id: null, zernio_account_id: null };

describe("o aviso no grupo", () => {
  it("sai pelo canal do QR Code, com o texto renderizado", async () => {
    enviados.length = 0;
    const r = await getAction("notify_group")!.execute(ctxCom(wahaOk), {
      channel_session_id: CANAL,
      chat_id: GRUPO,
      template: "Reunião marcada com {{contact.display_name}}",
    });

    expect(r.status, "o aviso não saiu: o time só descobre a reunião quando o cliente entra na sala").toBe("success");
    expect(enviados, "nada chegou ao transporte").toHaveLength(1);
    expect(enviados[0]!.to, "o aviso foi para outro destino que não o grupo configurado").toBe(GRUPO);
    expect(
      enviados[0]!.body,
      "o texto saiu cru, com as chaves duplas: o template não foi renderizado com o contexto do evento",
    ).toBe("Reunião marcada com Joana");
  });

  it("RECUSA um destino que não é grupo — o telefone colado no lugar do id", async () => {
    enviados.length = 0;
    const r = await getAction("notify_group")!.execute(ctxCom(wahaOk), {
      channel_session_id: CANAL,
      chat_id: "5531999999999@c.us",
      template: "Reunião marcada com {{contact.display_name}}",
    });

    expect(
      r.status,
      "o aviso INTERNO — com resumo da qualificação e valor — foi enviado a um número de pessoa: se for o do próprio lead, ele lê o que a IA apurou sobre ele",
    ).toBe("failed");
    expect(enviados, "o transporte foi acionado mesmo com o destino recusado").toHaveLength(0);
  });

  it("RECUSA canal da API oficial — a Meta não entrega em grupo", async () => {
    enviados.length = 0;
    const meta = { provider: CHANNEL_PROVIDER_META, waha_session_name: null, meta_phone_number_id: "123", zernio_account_id: null };
    const r = await getAction("notify_group")!.execute(ctxCom(meta), {
      channel_session_id: CANAL,
      chat_id: GRUPO,
      template: "oi",
    });

    expect(
      r.status,
      "a ação aceitou um canal que não envia para grupo: a regra fica salva e ativa, o envio morre lá embaixo e o time conclui que o produto não avisa",
    ).toBe("failed");
    expect(r.error, "o motivo tem que dizer QUAL é o problema — 4xx de provider não explica nada a quem configurou").toBe(
      "canal_sem_grupo",
    );
  });

  it("RECUSA canal de outra organização (ou inexistente) — a leitura é escopada", async () => {
    const r = await getAction("notify_group")!.execute(ctxCom(null), {
      channel_session_id: CANAL,
      chat_id: GRUPO,
      template: "oi",
    });
    expect(r.status).toBe("failed");
    expect(r.error).toBe("canal_nao_encontrado");
  });
});

/**
 * O CAMINHO PADRÃO: número da plataforma, grupo do cliente.
 *
 * É o que uma régua montada hoje usa — a ação salva só com o texto, sem canal
 * nem id de grupo. Se este caminho quebrar, o sintoma é o mesmo de "ninguém
 * qualificou lead hoje": silêncio. Por isso ele tem prova própria, e não só a
 * do caminho explícito que quase ninguém mais configura.
 */
function ctxDaPlataforma(sessao: Record<string, unknown> | null, settings: unknown): ActionCtx {
  const admin = {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: tabela === "channel_sessions" ? sessao : { settings },
            error: null,
          }),
          // O caminho EXPLÍCITO encadeia um segundo `eq` (o da organização).
          // Ele mora aqui para que uma configuração pela metade não caia em
          // `undefined is not a function` e passe por "falhou por outro motivo".
          eq: () => ({ maybeSingle: async () => ({ data: sessao, error: null }) }),
        }),
      }),
    }),
  };
  return {
    admin: admin as unknown as ActionCtx["admin"],
    organizationId: ORG,
    ruleId: "rule-1",
    ruleName: "Lead qualificado → avisa o grupo",
    event: {} as ActionCtx["event"],
    context: { contact: { display_name: "Joana" } },
    requestId: "req-1",
  };
}

describe("o aviso sem canal nem grupo na regra", () => {
  it("sai pelo número da plataforma, no grupo daquele cliente", async () => {
    enviados.length = 0;
    const r = await getAction("notify_group")!.execute(
      ctxDaPlataforma(wahaOk, { grupo_de_avisos: { id: GRUPO, nome: "Comercial" } }),
      { template: "Lead qualificado: {{contact.display_name}}" },
    );

    expect(r.status, "a régua montada pelo caminho padrão não avisa ninguém").toBe("success");
    expect(enviados[0]!.to, "o aviso não foi para o grupo configurado no painel").toBe(GRUPO);
    expect(enviados[0]!.body).toBe("Lead qualificado: Joana");
  });

  it("devolve o motivo CERTO quando o cliente não tem grupo", async () => {
    enviados.length = 0;
    const r = await getAction("notify_group")!.execute(ctxDaPlataforma(wahaOk, {}), {
      template: "oi",
    });

    expect(r.status).toBe("failed");
    expect(
      r.error,
      "um motivo genérico faria quem lê procurar defeito no número da plataforma — que está de pé, avisando todos os outros clientes",
    ).toBe("sem_grupo_no_cliente");
    expect(enviados, "mandou mesmo sem saber para onde").toHaveLength(0);
  });

  it("devolve o motivo CERTO quando não há número de avisos marcado", async () => {
    const r = await getAction("notify_group")!.execute(
      ctxDaPlataforma(null, { grupo_de_avisos: { id: GRUPO, nome: "Comercial" } }),
      { template: "oi" },
    );

    expect(r.status).toBe("failed");
    expect(r.error).toBe("sem_numero_de_avisos");
  });

  it("ainda RECUSA sem template — o aviso vazio é pior que aviso nenhum", async () => {
    const r = await getAction("notify_group")!.execute(ctxDaPlataforma(wahaOk, {}), {});
    expect(r.status).toBe("failed");
    expect(r.error).toBe("missing_config");
  });
});
