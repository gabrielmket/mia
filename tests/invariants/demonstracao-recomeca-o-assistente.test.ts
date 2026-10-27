import { beforeAll, describe, expect, it } from "vitest";

import { sqlDeRecomecarOAssistente } from "@/lib/demonstracao/semente/recomecar-o-assistente";

import { lastLine, sql } from "./gov-helpers";

/**
 * FORK MIA (.94) · "RECOMEÇAR" A DEMONSTRAÇÃO LIMPA O ASSISTENTE INTEIRO
 * (decisão 10), contra o Postgres de verdade, com o MESMO SQL que a semente roda:
 *
 *   - na empresa de DEMONSTRAÇÃO, as peças que nasceram de proposta aplicada
 *     saem (a etapa arquivada, a resposta, a tarefa, a etiqueta do vocabulário,
 *     a meta volta à de antes), e as propostas e o progresso das trilhas também;
 *   - a etapa renomeada volta ao nome de antes;
 *   - na empresa que NÃO é de demonstração, nada muda (a marca da trava da 9010);
 *   - rodar de novo não dá erro.
 *
 * Empresas fictícias (Empresa Modelo).
 */

const DEMO = "94109410-0000-4000-8000-00000000000d";
const REAL = "94109410-0000-4000-8000-00000000000e";
const PESSOA = "94109410-1111-4000-8000-0000000000a1";

function valor(consulta: string): string {
  return lastLine(sql(consulta));
}

/** Os ids fixos de cada empresa ("d" a de demonstração, "e" a outra). */
const ID = (grupo: string, sufixo: string) => `94109410-${grupo}-4000-8000-0000000000${sufixo}1`;

/** Um funil, as peças e as propostas aplicadas que as criaram, numa empresa. */
function semear(org: string, sufixo: string): void {
  const funil = ID("5555", sufixo);
  const novo = ID("6666", sufixo);
  const renomeada = ID("7777", sufixo);
  const criada = ID("2222", sufixo);
  sql(`
    insert into public.crm_pipelines (id, organization_id, name, slug)
      values ('${funil}', '${org}', 'Funil da Empresa Modelo', 'funil-modelo-${sufixo}');
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
      ('${novo}', '${org}', '${funil}', 'Novo', 'novo-${sufixo}', 100),
      ('${renomeada}', '${org}', '${funil}', 'Em conversa', 'aguardando-${sufixo}', 200),
      ('${criada}', '${org}', '${funil}', 'Pediu orçamento', 'pediu-orcamento-${sufixo}', 300);
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title)
      values ('${ID("8888", sufixo)}', '${org}', '${funil}', '${criada}', 'Limpeza da sala comercial');
    insert into public.message_templates (id, organization_id, owner_user_id, title, body, shortcut)
      values ('${ID("3333", sufixo)}', '${org}', null, 'Endereço', 'Rua das Acácias, 120.', 'endereco');
    insert into public.crm_tasks (id, organization_id, title)
      values ('${ID("4444", sufixo)}', '${org}', 'Ligar para o Rogério sobre a limpeza');
    update public.organizations
       set settings = coalesce(settings, '{}'::jsonb) || '{"tags":[{"tag":"Indicação","cor":"#00655a"},"Convênio"]}'::jsonb
     where id = '${org}';
    insert into public.sales_targets (organization_id, periodo, metrica, alvo_cents)
      values ('${org}', '2026-11-01', 'receita_total', 18000000);
    insert into public.mia_assistente_trilhas (organization_id, user_id, trilha) values ('${org}', '${PESSOA}', 'numero');
    insert into public.mia_assistente_propostas (organization_id, tipo, titulo, chave, situacao, aprovada_em, aplicada_em, resultado) values
      ('${org}', 'etapa_criar', 'etapa', 'e', 'aplicada', now(), now(), '{"etapa_id":"${criada}"}'),
      ('${org}', 'etapa_renomear', 'renomear', 'r', 'aplicada', now(), now(),
        '{"etapa_id":"${renomeada}","de":"Aguardando pagamento","para":"Em conversa"}'),
      ('${org}', 'resposta', 'resposta', 's', 'aplicada', now(), now(), '{"resposta_id":"${ID("3333", sufixo)}"}'),
      ('${org}', 'tarefa', 'tarefa', 't', 'aplicada', now(), now(), '{"tarefa_id":"${ID("4444", sufixo)}"}'),
      ('${org}', 'etiqueta', 'etiqueta', 'g', 'aplicada', now(), now(), '{"etiqueta":"Indicação"}'),
      ('${org}', 'meta', 'meta', 'm', 'aplicada', now(), now(), '{"mes":"2026-11","valor_cents":18000000,"antes_cents":null}'),
      ('${org}', 'tarefa', 'pendente', 'p', 'pendente', null, null, null);
  `);
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${PESSOA}', 'recomecar-9410@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name, demonstracao) values
      ('${DEMO}', 'recomecar-9410-demo', 'Empresa Modelo · Demonstração', 'Empresa Modelo · Demonstração', true),
      ('${REAL}', 'recomecar-9410-real', 'Empresa Modelo', 'Empresa Modelo', false)
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${PESSOA}', '${DEMO}', 'admin', now()), ('${PESSOA}', '${REAL}', 'admin', now())
      on conflict do nothing;
  `);
  semear(DEMO, "d");
  semear(REAL, "e");
  sql(sqlDeRecomecarOAssistente(DEMO));
  sql(sqlDeRecomecarOAssistente(REAL));
});

describe("decisão 10 · recomeçar a demonstração desfaz as peças das propostas", () => {
  it("na demonstração: a etapa arquivada (o negócio dela vai para a primeira aberta), o nome de antes, a resposta e a tarefa fora, a etiqueta fora do vocabulário, a meta como antes", () => {
    expect(valor(`select is_archived::text from public.crm_stages where id = '${ID("2222", "d")}';`)).toBe("true");
    expect(valor(`select stage_id::text from public.crm_leads where id = '${ID("8888", "d")}';`)).toBe(ID("6666", "d"));
    expect(valor(`select name from public.crm_stages where id = '${ID("7777", "d")}';`)).toBe("Aguardando pagamento");
    expect(valor(`select count(*) from public.message_templates where organization_id = '${DEMO}';`)).toBe("0");
    expect(valor(`select count(*) from public.crm_tasks where organization_id = '${DEMO}';`)).toBe("0");
    expect(valor(`select (settings->'tags')::text from public.organizations where id = '${DEMO}';`)).toBe('["Convênio"]');
    expect(valor(`select count(*) from public.sales_targets where organization_id = '${DEMO}';`)).toBe("0");
  });

  it("na demonstração: as propostas (inclusive a pendente) e o progresso das trilhas saem", () => {
    expect(valor(`select count(*) from public.mia_assistente_propostas where organization_id = '${DEMO}';`)).toBe("0");
    expect(valor(`select count(*) from public.mia_assistente_trilhas where organization_id = '${DEMO}';`)).toBe("0");
  });

  it("⭐ fora da demonstração nada muda: a mesma marca da trava da 9010", () => {
    expect(valor(`select is_archived::text from public.crm_stages where id = '${ID("2222", "e")}';`)).toBe("false");
    expect(valor(`select stage_id::text from public.crm_leads where id = '${ID("8888", "e")}';`)).toBe(ID("2222", "e"));
    expect(valor(`select name from public.crm_stages where id = '${ID("7777", "e")}';`)).toBe("Em conversa");
    expect(valor(`select (settings->'tags')::text from public.organizations where id = '${REAL}';`)).toContain("Indicação");
    expect(valor(`select count(*) from public.message_templates where organization_id = '${REAL}';`)).toBe("1");
    expect(valor(`select count(*) from public.crm_tasks where organization_id = '${REAL}';`)).toBe("1");
    expect(valor(`select count(*) from public.sales_targets where organization_id = '${REAL}';`)).toBe("1");
    expect(valor(`select count(*) from public.mia_assistente_propostas where organization_id = '${REAL}';`)).toBe("7");
    expect(valor(`select count(*) from public.mia_assistente_trilhas where organization_id = '${REAL}';`)).toBe("1");
  });

  it("rodar de novo não dá erro", () => {
    expect(() => sql(sqlDeRecomecarOAssistente(DEMO))).not.toThrow();
  });
});
