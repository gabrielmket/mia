import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * O TELEFONE COPIADO NO DISPARO SAI QUANDO A PESSOA É ANONIMIZADA.
 *
 * `broadcast_recipients.phone_e164` é COPIADO do contato de propósito (o
 * relatório de um disparo que já aconteceu não pode virar lista sem
 * destinatário) — e por isso a anonimização do contato não o alcança sozinha.
 * Quem o alcança é o gatilho da MIA (migration 0266 da MIA,
 * `fn_redigir_o_que_sobrou_do_contato_anonimizado`), pendurado na virada de
 * `contacts.is_anonymized`: a porta por onde passam a cascata canônica e o botão
 * da ficha.
 *
 * Os invariantes do upstream que cobram "toda tabela com dado de pessoa é
 * redigida" leem o CORPO de funções (`lgpd-cascata-alcanca-quem-guarda-pessoa`,
 * `lgpd-redact-unificado-alcanca-pelo-catalogo`). Este arquivo é a prova pelo
 * EFEITO que as entradas de lá citam: a linha fica, o telefone e os valores
 * por pessoa não — e a linha de outra pessoa não é tocada.
 */

const ORG = "90010266-0000-4000-8000-000000000001";
const TITULAR = "90010266-3333-4000-8000-000000000001";
const VIZINHO = "90010266-3333-4000-8000-000000000002";
const CAMPANHA = "90010266-5555-4000-8000-000000000001";
const ROTULO = "Contato anonimizado";

function destinatario(contato: string): { telefone: string; valores: string } {
  const [telefone, valores] = lastLine(
    sql(`select phone_e164 || '|' || valores::text from public.broadcast_recipients
          where organization_id = '${ORG}' and contact_id = '${contato}';`),
  ).split("|");
  return { telefone: telefone ?? "", valores: valores ?? "" };
}

beforeAll(() => {
  // Sem PII real: telefones e nomes sintéticos (LGPD).
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'mia-lgpd-disparo', 'MIA LGPD Disparo', 'MIA LGPD Disparo');
    insert into public.contacts (id, organization_id, display_name, phone_number) values
      ('${TITULAR}', '${ORG}', 'Titular Sintético', '+5500000000101'),
      ('${VIZINHO}', '${ORG}', 'Vizinho Sintético', '+5500000000102');
    insert into public.broadcasts (id, organization_id, nome, template_name, template_language)
      values ('${CAMPANHA}', '${ORG}', 'campanha lgpd', 'tpl_lgpd', 'pt_BR');
    insert into public.broadcast_recipients (organization_id, broadcast_id, contact_id, phone_e164, valores) values
      ('${ORG}', '${CAMPANHA}', '${TITULAR}', '+5500000000101', '{"1":"Titular"}'),
      ('${ORG}', '${CAMPANHA}', '${VIZINHO}', '+5500000000102', '{"1":"Vizinho"}');
  `);
});

describe("LGPD: a virada de is_anonymized redige o destinatário do disparo", () => {
  it("depois da virada: telefone vira o rótulo, valores zerados, a linha continua contável", () => {
    // CONTROLE: antes da virada o telefone e os valores estão lá — sem isto, o
    // rótulo abaixo poderia ser da semente e não do gatilho.
    expect(destinatario(TITULAR)).toEqual({ telefone: "+5500000000101", valores: '{"1": "Titular"}' });

    // A FUNÇÃO REAL da cascata, não um `update is_anonymized` à mão — o mesmo
    // cuidado de lgpd-tarefa-do-contato-anonimizado: é por ela que a
    // anonimização passa, e o gatilho da MIA dispara DENTRO da transação dela.
    sql(`select public.fn_lgpd_cascade_redact_contact('${ORG}', '${TITULAR}', gen_random_uuid());`);

    expect(destinatario(TITULAR)).toEqual({ telefone: ROTULO, valores: "{}" });
    expect(
      Number(lastLine(sql(`select count(*) from public.broadcast_recipients where broadcast_id = '${CAMPANHA}';`))),
      "a linha do destinatário tem de continuar existindo: o relatório e o débito apontam para ela",
    ).toBe(2);
  });

  it("a linha de OUTRA pessoa da mesma campanha não é tocada", () => {
    expect(destinatario(VIZINHO)).toEqual({ telefone: "+5500000000102", valores: '{"1": "Vizinho"}' });
  });
});
