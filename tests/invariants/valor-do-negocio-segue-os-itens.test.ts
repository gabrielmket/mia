import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * 9167 · O VALOR DO NEGÓCIO COM ITEM SEGUE OS ITENS (FORK MIA, fusão v1.124;
 * docs/fork/produto-no-negocio.md, seção "As vendas registradas do upstream").
 *
 * As vendas registradas do upstream (9449/9450) e o nosso produto no negócio
 * (9160) escrevem a mesma coluna, `crm_leads.value_cents`. A regra da fusão é
 * "nada muda para quem já usa itens": com item do bloco o valor é o nosso e a
 * marca `valor_pelas_vendas` fica desligada; sem item, vale o upstream inteiro.
 * O arquivo do upstream (`valor-do-negocio-pelas-vendas.test.ts`) não cobre as
 * três peças da 9167. Medido aqui no Postgres de verdade:
 *  (a) item no bloco, depois venda: o valor fica, a marca não liga;
 *  (b) venda, depois o primeiro item: a marca desliga e a rota grava a soma;
 *  (c) item de proposta não é item do bloco: negócio só com proposta segue as vendas;
 *  (d) o último item sai e `fn_mia_valor_do_negocio_volta_as_vendas` devolve a
 *      soma das vendas (e com item ainda no bloco não faz nada);
 *  (e) a cura: negócio já marcado e com item volta ao valor digitado, e rodar a
 *      9167 de novo não casa nada;
 *  (f) reaplicar a 9450 inteira (a auto-cura dela roda toda vez que o
 *      `baseline.sql` é reaplicado) não troca o valor de negócio com item.
 *
 * Organização própria (namespace `e9167e90-`). Dado fictício.
 */

const ORG = "e9167e90-0000-4000-8000-00000000000a";
const FUNIL = "e9167e90-2222-4000-8000-00000000000a";
const ETAPA = "e9167e90-2222-4000-8000-0000000000aa";
const CONTATO = "e9167e90-4444-4000-8000-00000000000a";
const PROPOSTA = "e9167e90-6666-4000-8000-00000000000a";
const ITEM_ANTES = "e9167e90-3333-4000-8000-00000000000a";
const VENDA_ANTES = "e9167e90-3333-4000-8000-00000000000b";
const SO_PROPOSTA = "e9167e90-3333-4000-8000-00000000000c";
const ULTIMO_SAI = "e9167e90-3333-4000-8000-00000000000d";
const JA_MARCADO = "e9167e90-3333-4000-8000-00000000000e";

const MIGRATION_9167 = readFileSync(
  join(process.cwd(), "supabase/migrations-mia/20261123120000_9167_valor_do_negocio_segue_os_itens.sql"),
  "utf8",
);
const MIGRATION_9450 = readFileSync(
  join(process.cwd(), "supabase/migrations/20261121171747_9450_valor_do_negocio_pelas_vendas.sql"),
  "utf8",
);

/** value_cents | valor_pelas_vendas | valor_digitado_cents */
const estado = (lead: string) =>
  sql(`select coalesce(value_cents::text, 'null'), valor_pelas_vendas, coalesce(valor_digitado_cents::text, 'null')
         from crm_leads where id = '${lead}'`);

const vender = (lead: string, cents: number) =>
  `insert into vendas_registradas (organization_id, lead_id, contact_id, valor_cents, currency, data)
     values ('${ORG}', '${lead}', '${CONTATO}', ${cents}, 'BRL', current_date);`;

const item = (lead: string, cents: number) =>
  `insert into mia_itens_do_negocio (organization_id, lead_id, product_id, nome, preco_unitario_cents, quantidade, desconto_cents)
     values ('${ORG}', '${lead}', null, 'Item Exemplo', ${cents}, 1, 0);`;

/** O que a rota dos itens grava depois dos itens (lib/produto-no-negocio/servidor.ts). */
const rotaGrava = (lead: string, cents: number) =>
  `update crm_leads set value_cents = ${cents}, valor_a_mao = false where id = '${lead}';`;

const voltaAsVendas = (lead: string) => `select fn_mia_valor_do_negocio_volta_as_vendas('${ORG}', '${lead}');`;

/** O `where` da cura da 9167: quantos negócios ela casaria agora. */
const casadosPelaCura = () =>
  sql(`select count(*) from crm_leads l
        where l.valor_pelas_vendas is true
          and exists (select 1 from mia_itens_do_negocio i where i.lead_id = l.id)`);

beforeAll(() => {
  sql(`
    insert into organizations (id, slug, legal_name, display_name, currency)
      values ('${ORG}', 'valor-9167', 'Clínica Sorriso Exemplo', 'Clínica Sorriso Exemplo', 'BRL');
    insert into crm_pipelines (id, organization_id, name, slug) values ('${FUNIL}', '${ORG}', 'Funil', 'funil-9167');
    insert into crm_stages (id, organization_id, pipeline_id, name, slug, position)
      values ('${ETAPA}', '${ORG}', '${FUNIL}', 'Entrada', 'entrada', 1);
    insert into contacts (id, organization_id, name) values ('${CONTATO}', '${ORG}', 'Cliente sintético');
    insert into crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id, value_cents, currency, valor_a_mao) values
      ('${ITEM_ANTES}', '${ORG}', '${FUNIL}', '${ETAPA}', 'Item antes', '${CONTATO}', 300000, 'BRL', false),
      ('${VENDA_ANTES}', '${ORG}', '${FUNIL}', '${ETAPA}', 'Venda antes', '${CONTATO}', 50000, 'BRL', true),
      ('${SO_PROPOSTA}', '${ORG}', '${FUNIL}', '${ETAPA}', 'Só proposta', '${CONTATO}', 800000, 'BRL', false),
      ('${ULTIMO_SAI}', '${ORG}', '${FUNIL}', '${ETAPA}', 'Último sai', '${CONTATO}', 220000, 'BRL', true),
      ('${JA_MARCADO}', '${ORG}', '${FUNIL}', '${ETAPA}', 'Já marcado', '${CONTATO}', 450000, 'BRL', false);
    ${item(ITEM_ANTES, 300000)}
    ${item(ULTIMO_SAI, 220000)}
    ${item(JA_MARCADO, 450000)}
    insert into crm_proposals (id, organization_id, lead_id, contact_id, status, titulo, total_cents, moeda, numero, ano, sent_at)
      values ('${PROPOSTA}', '${ORG}', '${SO_PROPOSTA}', '${CONTATO}', 'enviada', 'Proposta Exemplo', 800000, 'BRL', 1, 2026, now());
    insert into crm_proposal_items (proposal_id, organization_id, descricao, quantidade, preco_unitario_cents, desconto_cents, position)
      values ('${PROPOSTA}', '${ORG}', 'Item da proposta', 1, 800000, 0, 1000);
  `);
});

describe("9167 · o valor do negócio com item segue os itens", () => {
  it("(a) item no bloco, depois venda: o valor fica e a marca das vendas não liga", () => {
    sql(vender(ITEM_ANTES, 10000));
    expect(estado(ITEM_ANTES)).toBe("300000|f|null");
    // A segunda venda passa pelo gatilho do upstream de novo, e o valor segue o nosso.
    sql(vender(ITEM_ANTES, 5000));
    expect(estado(ITEM_ANTES)).toBe("300000|f|null");
    // A venda continua registrada (é ela que o painel de vendas do upstream conta).
    expect(sql(`select sum(valor_cents) from vendas_registradas where lead_id = '${ITEM_ANTES}'`)).toBe("15000");
  });

  it("(b) venda, depois o primeiro item: a marca desliga e a rota grava a soma dos itens", () => {
    sql(vender(VENDA_ANTES, 20000));
    expect(estado(VENDA_ANTES)).toBe("20000|t|50000"); // sem item: o upstream inteiro (controle)

    sql(item(VENDA_ANTES, 140000));
    expect(sql(`select valor_pelas_vendas, coalesce(valor_digitado_cents::text, 'null') from crm_leads where id = '${VENDA_ANTES}'`)).toBe(
      "f|null",
    );
    sql(rotaGrava(VENDA_ANTES, 140000));
    expect(estado(VENDA_ANTES)).toBe("140000|f|null");
  });

  it("(c) item de proposta não é item do bloco: o negócio só com proposta segue as vendas", () => {
    sql(vender(SO_PROPOSTA, 30000));
    expect(estado(SO_PROPOSTA)).toBe("30000|t|800000");
  });

  it("(d) o último item sai e a função devolve a soma das vendas; com item, não faz nada", () => {
    sql(vender(ULTIMO_SAI, 15000));
    expect(estado(ULTIMO_SAI)).toBe("220000|f|null");

    // Ainda com item: a função não mexe.
    sql(voltaAsVendas(ULTIMO_SAI));
    expect(estado(ULTIMO_SAI)).toBe("220000|f|null");

    // O último item sai. A rota manda o mesmo Valor à mão (o patch fica vazio,
    // revisão do #129) e chama a função mesmo assim.
    sql(`delete from mia_itens_do_negocio where lead_id = '${ULTIMO_SAI}';`);
    expect(estado(ULTIMO_SAI)).toBe("220000|f|null");
    sql(voltaAsVendas(ULTIMO_SAI));
    expect(estado(ULTIMO_SAI)).toBe("15000|t|220000");

    // E daí em diante é o upstream: a última venda sai, o valor digitado volta.
    sql(`delete from vendas_registradas where lead_id = '${ULTIMO_SAI}';`);
    expect(estado(ULTIMO_SAI)).toBe("220000|f|null");
  });

  it("(e) a cura: negócio já marcado e com item volta ao valor digitado, e rodar de novo não casa nada", () => {
    // O estado de antes da 9167: negócio com item que o gatilho do upstream já
    // trocou pela soma das vendas. Montado sem gatilhos, porque com a 9167
    // aplicada esse estado não se forma por caminho nenhum.
    sql(`
      set session_replication_role = replica;
      ${vender(JA_MARCADO, 9900)}
      update crm_leads set value_cents = 9900, valor_pelas_vendas = true, valor_digitado_cents = 450000
       where id = '${JA_MARCADO}';
      set session_replication_role = origin;
    `);
    expect(estado(JA_MARCADO)).toBe("9900|t|450000");
    expect(casadosPelaCura()).toBe("1");

    sql(MIGRATION_9167);
    expect(estado(JA_MARCADO)).toBe("450000|f|null");
    expect(casadosPelaCura()).toBe("0");

    sql(MIGRATION_9167);
    expect(estado(JA_MARCADO)).toBe("450000|f|null");
    expect(estado(ITEM_ANTES)).toBe("300000|f|null");
    expect(estado(VENDA_ANTES)).toBe("140000|f|null");
    expect(estado(SO_PROPOSTA)).toBe("30000|t|800000"); // sem item: a cura não toca
  });

  it("(f) reaplicar a 9450 (auto-cura dela) não troca o valor de negócio com item", () => {
    sql(MIGRATION_9450);
    expect(estado(ITEM_ANTES)).toBe("300000|f|null");
    expect(estado(VENDA_ANTES)).toBe("140000|f|null");
    expect(estado(JA_MARCADO)).toBe("450000|f|null");
    // Controle: sem item, a auto-cura dele segue valendo.
    expect(estado(SO_PROPOSTA)).toBe("30000|t|800000");
    expect(casadosPelaCura()).toBe("0");
  });
});
