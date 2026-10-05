/**
 * FORK MIA — O PÚBLICO DO DISPARO VEM INTEIRO, OU O DISPARO NÃO NASCE.
 *
 * ## O defeito
 *
 * `quemEntraNaLista` pedia `.limit(50_000)` nas duas leituras. O PostgREST
 * corta em 1000 linhas sem avisar: quem montava uma lista de 2.500 contatos
 * criava um disparo para 1.000, e a tela dizia "1.000 destinatários" como se
 * fosse a lista inteira. Mensagem que não sai para quem a pessoa escolheu, sem
 * erro em lugar nenhum.
 *
 * ## O que cada caso prova
 *
 *  1. 2.500 contatos na lista (por tag, por etapa, e sem filtro): 2.500 no
 *     resultado, sem repetir ninguém;
 *  2. controle negativo: a leitura antiga, contra o mesmo servidor, traz 1000;
 *  3. acima do teto: RECUSA (`acimaDoTeto`), nunca uma lista cortada;
 *  4. etapa sem negócio aberto: ninguém, e nenhuma consulta de contatos.
 *
 *     npx vitest run --project produto lib/broadcast/quem-entra-na-lista.test.ts
 */
import { describe, expect, it } from "vitest";

import { peneirar, type ContatoParaDisparo } from "@/lib/broadcast/plano";
import {
  LISTA_ACIMA_DO_TETO,
  quemEntraNaLista,
  TETO_DA_LISTA_DO_DISPARO,
} from "@/lib/broadcast/quem-entra-na-lista";
import { postgrestComTeto, type Linha } from "@/tests/helpers/postgrest-com-teto";

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const ETAPA_ORCAMENTO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ETAPA_PROPOSTA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const idDoContato = (i: number, org = ORG) => `${org.slice(0, 8)}-contato-${String(i).padStart(6, "0")}`;

function contato(i: number, over: Linha = {}): Linha {
  return {
    id: idDoContato(i),
    organization_id: ORG,
    // Telefones fictícios e todos diferentes: a peneira não descarta nenhum.
    phone_number: `+55119${String(10_000_000 + i)}`,
    name: `Contato ${i}`,
    display_name: null,
    is_blocked: false,
    consent: null,
    tags: [],
    created_at: new Date(Date.parse("2026-01-01T12:00:00.000Z") + i * 1_000).toISOString(),
    ...over,
  };
}

function negocio(i: number, contactId: string, over: Linha = {}): Linha {
  return {
    id: `negocio-${String(i).padStart(6, "0")}`,
    organization_id: ORG,
    stage_id: ETAPA_ORCAMENTO,
    status: "open",
    contact_id: contactId,
    ...over,
  };
}

const ler = (banco: ReturnType<typeof postgrestComTeto>, filtro: { tags?: string[]; etapas?: string[] }) =>
  quemEntraNaLista(banco.cliente as never, ORG, { tags: filtro.tags ?? [], etapas: filtro.etapas ?? [] });

const ids = (contatos: unknown[]) => contatos.map((c) => (c as { id: string }).id);

describe("quem entra na lista do disparo", () => {
  it("sem filtro, 2.500 contatos: entram os 2.500, e só os desta organização", async () => {
    const banco = postgrestComTeto({
      contacts: [
        ...Array.from({ length: 2_500 }, (_, i) => contato(i)),
        ...Array.from({ length: 400 }, (_, i) =>
          contato(i, { id: idDoContato(i, OUTRA_ORG), organization_id: OUTRA_ORG }),
        ),
      ],
    });

    const lista = await ler(banco, {});

    expect(lista.ok).toBe(true);
    if (!lista.ok) return;
    expect(lista.contatos).toHaveLength(2_500);
    expect(new Set(ids(lista.contatos)).size).toBe(2_500);
    // E a peneira manda para os 2.500: é este o número que a tela mostra.
    expect(peneirar(lista.contatos as ContatoParaDisparo[], () => ({})).enviar).toHaveLength(2_500);
    expect(banco.pedidosEm("contacts")).toBe(3);
  });

  it("por tag, 2.500 com a tag entre 4.000 contatos: entram os 2.500", async () => {
    const banco = postgrestComTeto({
      contacts: Array.from({ length: 4_000 }, (_, i) => contato(i, { tags: i % 8 < 5 ? ["revenda"] : ["outra"] })),
    });

    const lista = await ler(banco, { tags: ["revenda"] });

    expect(lista.ok).toBe(true);
    if (!lista.ok) return;
    expect(lista.contatos).toHaveLength(2_500);
  });

  it("por etapa, 2.500 contatos com negócio aberto: entram os 2.500, uma vez cada", async () => {
    const banco = postgrestComTeto({
      contacts: Array.from({ length: 4_000 }, (_, i) => contato(i)),
      crm_leads: [
        // 2.500 contatos com negócio aberto na etapa; os 500 primeiros têm DOIS.
        ...Array.from({ length: 2_500 }, (_, i) => negocio(i, idDoContato(i))),
        ...Array.from({ length: 500 }, (_, i) => negocio(10_000 + i, idDoContato(i))),
        // Ganho e perdido continuam na etapa e NÃO entram.
        ...Array.from({ length: 300 }, (_, i) => negocio(20_000 + i, idDoContato(3_000 + i), { status: "won" })),
        // Aberto em OUTRA etapa não entra.
        ...Array.from({ length: 300 }, (_, i) =>
          negocio(30_000 + i, idDoContato(3_400 + i), { stage_id: ETAPA_PROPOSTA }),
        ),
      ],
    });

    const lista = await ler(banco, { etapas: [ETAPA_ORCAMENTO] });

    expect(lista.ok).toBe(true);
    if (!lista.ok) return;
    expect(lista.contatos).toHaveLength(2_500);
    expect(new Set(ids(lista.contatos)).size).toBe(2_500);
    // Os contatos vêm em lotes de 100 ids: nenhum `.in()` com milhares de uuids,
    // que é o que estourava o cabeçalho da resposta.
    expect(banco.pedidosEm("contacts")).toBe(25);
    expect(banco.pedidos.filter((p) => p.tabela === "contacts").every((p) => p.devolvidas <= 100)).toBe(true);
  });

  it("tag E etapa se somam como E: só quem tem a tag entre os da etapa", async () => {
    const banco = postgrestComTeto({
      contacts: Array.from({ length: 3_000 }, (_, i) => contato(i, { tags: i % 2 === 0 ? ["vip"] : [] })),
      crm_leads: Array.from({ length: 2_400 }, (_, i) => negocio(i, idDoContato(i))),
    });

    const lista = await ler(banco, { tags: ["vip"], etapas: [ETAPA_ORCAMENTO] });

    expect(lista.ok).toBe(true);
    if (!lista.ok) return;
    expect(lista.contatos).toHaveLength(1_200);
  });

  it("controle negativo: as leituras antigas (.limit(50_000)) traziam 1000 contatos de 2.500", async () => {
    const banco = postgrestComTeto({
      contacts: Array.from({ length: 2_500 }, (_, i) => contato(i)),
      crm_leads: Array.from({ length: 2_500 }, (_, i) => negocio(i, idDoContato(i))),
    });

    const contatosAntigos = await banco.cliente
      .from("contacts")
      .select("id, phone_number, name, display_name, is_blocked, consent")
      .eq("organization_id", ORG)
      .limit(50_000);
    const negociosAntigos = await banco.cliente
      .from("crm_leads")
      .select("contact_id")
      .eq("organization_id", ORG)
      .in("stage_id", [ETAPA_ORCAMENTO])
      .eq("status", "open")
      .not("contact_id", "is", null)
      .limit(50_000);

    // Sem erro nenhum nos dois: 1.500 pessoas a menos, e a tela diria "1.000 destinatários".
    expect(contatosAntigos.error).toBeNull();
    expect(contatosAntigos.data).toHaveLength(1_000);
    expect(negociosAntigos.error).toBeNull();
    expect(negociosAntigos.data).toHaveLength(1_000);
  });

  it("acima do teto, sem filtro: RECUSA, e não devolve lista cortada", async () => {
    const banco = postgrestComTeto({
      contacts: Array.from({ length: TETO_DA_LISTA_DO_DISPARO + 1 }, (_, i) => contato(i)),
    });

    const lista = await ler(banco, {});

    expect(lista).toEqual({ ok: false, erro: LISTA_ACIMA_DO_TETO, acimaDoTeto: true });
  });

  it("exatamente no teto: a lista inteira entra", async () => {
    const banco = postgrestComTeto({
      contacts: Array.from({ length: TETO_DA_LISTA_DO_DISPARO }, (_, i) => contato(i)),
    });

    const lista = await ler(banco, {});

    expect(lista.ok).toBe(true);
    if (!lista.ok) return;
    expect(lista.contatos).toHaveLength(TETO_DA_LISTA_DO_DISPARO);
  });

  it("acima do teto, por etapa: RECUSA antes de ler um contato sequer", async () => {
    const banco = postgrestComTeto({
      contacts: [contato(0)],
      crm_leads: Array.from({ length: TETO_DA_LISTA_DO_DISPARO + 1 }, (_, i) => negocio(i, idDoContato(0))),
    });

    const lista = await ler(banco, { etapas: [ETAPA_ORCAMENTO] });

    expect(lista).toEqual({ ok: false, erro: LISTA_ACIMA_DO_TETO, acimaDoTeto: true });
    expect(banco.pedidosEm("contacts")).toBe(0);
  });

  it("etapa sem negócio aberto: ninguém, e nenhuma consulta de contatos (campanha para ninguém não vira para todos)", async () => {
    const banco = postgrestComTeto({
      contacts: Array.from({ length: 50 }, (_, i) => contato(i)),
      crm_leads: [negocio(0, idDoContato(0), { status: "lost" })],
    });

    const lista = await ler(banco, { etapas: [ETAPA_ORCAMENTO] });

    expect(lista).toEqual({ ok: true, contatos: [] });
    expect(banco.pedidosEm("contacts")).toBe(0);
  });

  it("leitura que falha no meio: erro, e não a lista pela metade", async () => {
    let idas = 0;
    const banco = postgrestComTeto(
      { contacts: Array.from({ length: 2_500 }, (_, i) => contato(i)) },
      {
        falhaEm: (_n, tabela) => {
          if (tabela !== "contacts") return null;
          idas += 1;
          return idas === 2 ? "canceling statement due to statement timeout" : null;
        },
      },
    );

    const lista = await ler(banco, {});

    expect(lista).toEqual({ ok: false, erro: "canceling statement due to statement timeout" });
  });
});
