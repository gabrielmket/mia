import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * FORK MIA (9047) — O TEXTO DE ERRO DO TRAÇO DO TURNO SAI QUANDO A PESSOA É ANONIMIZADA.
 *
 * `agent_turn_traces` (0721 do upstream, #2869) guarda, por turno do agente, o
 * texto do erro (`error_message`) e as ferramentas chamadas com a mensagem de
 * erro de cada uma (`ferramentas[].erro`). Esse texto pode repetir o que a
 * pessoa disse, e nenhum caminho do upstream o alcança (a catraca
 * `lgpd-exporta-o-que-redige` acusou na fusão da .86). Quem alcança é o gatilho
 * da MIA (`fn_redigir_o_que_sobrou_do_contato_anonimizado`, 0266/9007/9047),
 * pendurado na virada de `contacts.is_anonymized`.
 *
 * A prova é pelo EFEITO e pela função REAL da cascata: o texto de erro sai do
 * turno e de cada ferramenta, o nome, o estado e a duração ficam (a trilha do
 * que o agente fez continua legível), e o traço de outra pessoa não é tocado.
 */

const ORG = "90479047-0000-4000-8000-000000000001";
const TITULAR = "90479047-3333-4000-8000-000000000001";
const VIZINHO = "90479047-3333-4000-8000-000000000002";
const JOB_TITULAR = "90479047-7777-4000-8000-000000000001";
const JOB_VIZINHO = "90479047-7777-4000-8000-000000000002";

const FERRAMENTAS = JSON.stringify([
  { nome: "crm_update_lead", estado: "falhou", erro: "telefone 5500000000101 inválido", duracao_ms: 12 },
  { nome: "crm_search_products", estado: "ok", erro: null, duracao_ms: 40 },
]);

function traco(job: string): { erro: string; ferramentas: unknown } {
  const linha = lastLine(
    sql(`select coalesce(error_message, '<nulo>') || '|' || ferramentas::text
           from public.agent_turn_traces
          where organization_id = '${ORG}' and job_id = '${job}';`),
  );
  const corte = linha.indexOf("|");
  return { erro: linha.slice(0, corte), ferramentas: JSON.parse(linha.slice(corte + 1)) };
}

beforeAll(() => {
  // Sem PII real: telefones e nomes sintéticos (LGPD).
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'mia-lgpd-traco', 'MIA LGPD Traço', 'MIA LGPD Traço');
    insert into public.contacts (id, organization_id, display_name, phone_number) values
      ('${TITULAR}', '${ORG}', 'Titular Sintético', '+5500000000101'),
      ('${VIZINHO}', '${ORG}', 'Vizinho Sintético', '+5500000000102');
    insert into public.agent_turn_traces (organization_id, job_id, contact_id, status, error_message, ferramentas) values
      ('${ORG}', '${JOB_TITULAR}', '${TITULAR}', 'failed', 'o cliente disse 5500000000101', '${FERRAMENTAS}'::jsonb),
      ('${ORG}', '${JOB_VIZINHO}', '${VIZINHO}', 'failed', 'o vizinho disse 5500000000102', '${FERRAMENTAS}'::jsonb);
  `);
});

describe("LGPD (9047): a virada de is_anonymized redige o traço do turno", () => {
  it("depois da virada: sai o texto de erro do turno e de cada ferramenta; nome, estado e duração ficam", () => {
    // CONTROLE: antes da virada o texto está lá.
    expect(traco(JOB_TITULAR).erro).toBe("o cliente disse 5500000000101");

    sql(`select public.fn_lgpd_cascade_redact_contact('${ORG}', '${TITULAR}', gen_random_uuid());`);

    const depois = traco(JOB_TITULAR);
    expect(depois.erro).toBe("<nulo>");
    expect(depois.ferramentas).toEqual([
      { nome: "crm_update_lead", estado: "falhou", erro: null, duracao_ms: 12 },
      { nome: "crm_search_products", estado: "ok", erro: null, duracao_ms: 40 },
    ]);
  });

  it("o traço de OUTRA pessoa da mesma empresa não é tocado", () => {
    const vizinho = traco(JOB_VIZINHO);
    expect(vizinho.erro).toBe("o vizinho disse 5500000000102");
    expect((vizinho.ferramentas as Array<{ erro: string | null }>)[0]?.erro).toBe("telefone 5500000000101 inválido");
  });
});
