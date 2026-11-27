import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";
import { assinar, chaveDeCobranca, corrida, criarOrg, criarPlano, erroDe, numero, uuid, valor } from "./cobranca-helpers";

/**
 * FORK MIA (MIA-250 D) — O TETO DE AGENTES DE IA DO PLANO, migration 9174
 * (desenho na MIA-258, seções 4, 5 e 11). O banco decide: o gatilho NOSSO
 * `trg_mia_trava_agentes_do_plano` em `ai_agents` levanta PT402 com
 * `limite_do_plano:agentes:<teto>` (a MESMA forma dos gatilhos de pessoas e
 * números do upstream, que `lib/planos-mia/limite-de-agentes.ts` traduz).
 *
 * Conta todo agente NÃO arquivado, de qualquer tipo e estado; desarquivar e
 * trocar de empresa contam; editar um agente que já estava fora do arquivo nunca
 * conta (a empresa acima do teto segue editando). Sem limite: cobrança
 * desligada, empresa sem assinatura (isenta), plano sem linha nossa ou sem teto.
 *
 * Empresas fictícias ("Academia Alfa"), nenhum dado de cliente real.
 */

const P = "c0b09174-0000-4000-8000";
const org = (n: number) => uuid(P, n);
const agente = (n: number) => uuid(P, 100 + n);
const PLANO_1 = uuid(P, 901);
const PLANO_2 = uuid(P, 902);
const PLANO_SEM_TETO = uuid(P, 903);
const PLANO_SEM_LINHA = uuid(P, 904);

/** INSERT de agente, SEM `;`. Rascunho (`is_active` false) conta igual. */
function insercaoDeAgente(id: string, organizacao: string, extra = ""): string {
  return `insert into public.ai_agents (id, organization_id, name, system_prompt${extra ? ", is_active" : ""})
    values ('${id}', '${organizacao}', 'Agente ${id.slice(-4)}', 'Você é a recepção da Academia Alfa.'${extra ? `, ${extra}` : ""})`;
}

function agentesNaoArquivados(organizacao: string): number {
  return numero(`select count(*) from public.ai_agents where organization_id = '${organizacao}' and archived_at is null;`);
}

function tetoNoPlano(plano: string, teto: number | null): void {
  sql(`insert into public.mia_plano_modulos (plano_id, max_agentes) values ('${plano}', ${teto === null ? "null" : teto})
         on conflict (plano_id) do update set max_agentes = excluded.max_agentes;`);
}

beforeAll(() => {
  criarPlano({ id: PLANO_1, nome: "Um agente" });
  criarPlano({ id: PLANO_2, nome: "Dois agentes" });
  criarPlano({ id: PLANO_SEM_TETO, nome: "Agentes sem teto" });
  criarPlano({ id: PLANO_SEM_LINHA, nome: "Sem linha nossa" });
  tetoNoPlano(PLANO_1, 1);
  tetoNoPlano(PLANO_2, 2);
  tetoNoPlano(PLANO_SEM_TETO, null);
  for (let n = 1; n <= 12; n++) criarOrg(org(n), `academia-alfa-9174-${n}`);
  chaveDeCobranca("ligado");
});

describe("9174 · o teto de agentes de IA do plano", () => {
  it("⭐ teto 2: o 2º agente entra e o 3º é PT402 com a mensagem que o app lê", () => {
    assinar(org(1), PLANO_2);
    sql(`${insercaoDeAgente(agente(1), org(1))};`);
    sql(`${insercaoDeAgente(agente(2), org(1), "false")};`);
    const e = erroDe(`${insercaoDeAgente(agente(3), org(1))};`);
    expect(e).toContain("PT402");
    expect(e).toContain("limite_do_plano:agentes:2");
    expect(e).toContain(`"recurso": "agentes"`);
    expect(e).toContain(`"limite": 2`);
    expect(e).toContain(`"em_uso": 2`);
    expect(agentesNaoArquivados(org(1))).toBe(2);
  });

  it("o arquivado não conta; desarquivar acima do teto é recusado", () => {
    assinar(org(2), PLANO_1);
    sql(`${insercaoDeAgente(agente(4), org(2))};`);
    sql(`update public.ai_agents set archived_at = now() where id = '${agente(4)}';`);
    sql(`${insercaoDeAgente(agente(5), org(2))};`);
    expect(erroDe(`update public.ai_agents set archived_at = null where id = '${agente(4)}';`)).toContain("PT402");
    expect(agentesNaoArquivados(org(2))).toBe(1);
  });

  it("⭐ empresa ACIMA do teto: renomear, editar, pausar e arquivar passam; criar não", () => {
    // Três agentes de antes do teto (a cobrança ligou sobre a empresa, ou o plano desceu).
    for (const n of [6, 7, 8]) sql(`${insercaoDeAgente(agente(n), org(3))};`);
    assinar(org(3), PLANO_1);
    expect(erroDe(`update public.ai_agents set name = 'Recepção nova' where id = '${agente(6)}';`)).toBe("");
    expect(erroDe(`update public.ai_agents set paused_at = now(), is_active = false where id = '${agente(7)}';`)).toBe("");
    // Regravar archived_at = null num agente que já está fora do arquivo não conta.
    expect(erroDe(`update public.ai_agents set archived_at = null where id = '${agente(8)}';`)).toBe("");
    expect(erroDe(`${insercaoDeAgente(agente(9), org(3))};`)).toContain("limite_do_plano:agentes:1");
    // Nada é arquivado sozinho: os três seguem.
    expect(agentesNaoArquivados(org(3))).toBe(3);
    sql(`update public.ai_agents set archived_at = now() where id in ('${agente(6)}', '${agente(7)}');`);
    expect(erroDe(`${insercaoDeAgente(agente(9), org(3))};`)).toContain("PT402");
    sql(`update public.ai_agents set archived_at = now() where id = '${agente(8)}';`);
    expect(erroDe(`${insercaoDeAgente(agente(9), org(3))};`)).toBe("");
  });

  it("mudar o agente de empresa conta no destino", () => {
    assinar(org(4), PLANO_1);
    sql(`${insercaoDeAgente(agente(10), org(4))};`);
    sql(`${insercaoDeAgente(agente(11), org(5))};`);
    expect(erroDe(`update public.ai_agents set organization_id = '${org(4)}' where id = '${agente(11)}';`)).toContain("PT402");
  });

  it("⭐ dois inserts ao mesmo tempo com uma vaga: exatamente um passa (trava 2283)", async () => {
    assinar(org(6), PLANO_1);
    const [primeira, segunda] = await corrida(insercaoDeAgente(agente(12), org(6)), insercaoDeAgente(agente(13), org(6)));
    expect(primeira.ok, primeira.saida).toBe(true);
    expect(segunda.ok, "o segundo entrou junto: a trava consultiva sumiu").toBe(false);
    expect(segunda.saida).toContain("PT402");
    expect(agentesNaoArquivados(org(6))).toBe(1);
    expect(sql(`select pg_get_functiondef('public.fn_mia_trava_agentes_do_plano()'::regprocedure);`)).toMatch(
      /hashtextextended\([^)]*,\s*2283\)/,
    );
  });

  it("⭐ sem limite: cobrança desligada ou ausente, empresa isenta, plano sem linha nossa, max_agentes nulo", () => {
    assinar(org(7), PLANO_1);
    sql(`${insercaoDeAgente(agente(14), org(7))};`);
    try {
      chaveDeCobranca("desligado");
      sql(`${insercaoDeAgente(agente(15), org(7))};`);
      chaveDeCobranca("ausente");
      sql(`${insercaoDeAgente(agente(16), org(7))};`);
    } finally {
      chaveDeCobranca("ligado");
    }
    expect(agentesNaoArquivados(org(7))).toBe(3);
    // Isenta: sem linha em cobranca_assinaturas.
    for (const n of [17, 18, 19]) sql(`${insercaoDeAgente(agente(n), org(8))};`);
    expect(agentesNaoArquivados(org(8))).toBe(3);
    assinar(org(9), PLANO_SEM_LINHA);
    for (const n of [20, 21]) sql(`${insercaoDeAgente(agente(n), org(9))};`);
    assinar(org(10), PLANO_SEM_TETO);
    for (const n of [22, 23]) sql(`${insercaoDeAgente(agente(n), org(10))};`);
    expect(agentesNaoArquivados(org(9)) + agentesNaoArquivados(org(10))).toBe(4);
    for (const o of [org(8), org(9), org(10)]) {
      expect(valor(`select coalesce(public.fn_mia_limite_de_agentes('${o}')::text, 'nulo');`), o).toBe("nulo");
    }
  });

  it("vale o plano_id da assinatura, nunca o agendado; e o teto muda na hora (plano assinado)", () => {
    sql(`insert into public.cobranca_assinaturas (organization_id, plano_id, plano_agendado_id)
           values ('${org(11)}', '${PLANO_SEM_TETO}', '${PLANO_1}')
           on conflict (organization_id) do update set plano_id = excluded.plano_id, plano_agendado_id = excluded.plano_agendado_id;`);
    expect(valor(`select coalesce(public.fn_mia_limite_de_agentes('${org(11)}')::text, 'nulo');`)).toBe("nulo");
    assinar(org(12), PLANO_2);
    expect(valor(`select public.fn_mia_limite_de_agentes('${org(12)}');`)).toBe("2");
    // A trava de assinantes da 9070 não pega o teto de agentes: muda com o plano assinado.
    expect(erroDe(`update public.mia_plano_modulos set max_agentes = 3 where plano_id = '${PLANO_2}';`)).toBe("");
    expect(valor(`select public.fn_mia_limite_de_agentes('${org(12)}');`)).toBe("3");
    sql(`update public.mia_plano_modulos set max_agentes = 2 where plano_id = '${PLANO_2}';`);
  });

  it("a coluna só aceita nulo ou 1 a 1000", () => {
    expect(erroDe(`update public.mia_plano_modulos set max_agentes = 0 where plano_id = '${PLANO_1}';`)).toContain("23514");
    expect(erroDe(`update public.mia_plano_modulos set max_agentes = 1001 where plano_id = '${PLANO_1}';`)).toContain("23514");
  });

  it("⭐ a sessão não pergunta nem desliga: EXECUTE só do servidor", () => {
    for (const papel of ["anon", "authenticated"]) {
      for (const fn of ["public.fn_mia_limite_de_agentes(uuid)", "public.fn_mia_trava_agentes_do_plano()"]) {
        expect(valor(`select has_function_privilege('${papel}', '${fn}', 'EXECUTE');`), `${papel} ${fn}`).toBe("f");
      }
    }
    expect(valor(`select has_function_privilege('service_role', 'public.fn_mia_limite_de_agentes(uuid)', 'EXECUTE');`)).toBe("t");
  });
});
