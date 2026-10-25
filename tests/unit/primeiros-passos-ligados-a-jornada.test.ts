/**
 * FORK MIA (.91 sobre a .90) — OS PRIMEIROS PASSOS LIGADOS À JORNADA DE
 * ASSINATURA. Sem banco: um cliente de mentira que responde às consultas.
 *
 *   - a área "plano e cobrança" decide pela situação da tela da Time
 *     (`situacaoDaEmpresa`, .90): o teste com a assinatura já feita conta como
 *     assinado, o teste vencido sem pagamento pede "assinar", a empresa
 *     suspensa e a do prazo extra pedem "regularizar";
 *   - a origem da empresa (9071) é só do servidor: pela sessão a leitura é
 *     recusada e a área segue, com a origem `null`;
 *   - a Time vê o "o que falta" pela mesma fonte do Início (o retrato mais novo
 *     e o primeiro de cada empresa);
 *   - a empresa que entrou com o Facebook e espera a Time aparece para a Time e
 *     no recado do zap, e some quando o número dela está conectado.
 */
import { describe, expect, it } from "vitest";

import { planoECobranca } from "@/lib/mcp-plataforma/checklist/area-do-plano-e-cobranca";
import type { AreaAvaliada } from "@/lib/mcp-plataforma/checklist/avaliar";
import { rotuloDoCliente } from "@/lib/mcp-plataforma/checklist/rotulo-do-cliente";
import { lerEmpresasEsperandoONumero, lerRetratosDasEmpresas } from "@/lib/onboarding/primeiros-passos-para-a-time";
import { recadosPendentes } from "@/lib/planos-mia/recados";

type Linha = Record<string, unknown>;
type Tabelas = Record<string, Linha[] | { erro: string }>;

/** O valor de uma coluna, com o caminho de jsonb do PostgREST (`a->b->>c`). */
function valor(l: Linha, coluna: string): unknown {
  const partes = coluna.split(/->>?/);
  let v: unknown = l[partes[0]!];
  for (const p of partes.slice(1)) v = v && typeof v === "object" ? (v as Linha)[p] : undefined;
  return v;
}

/** Um cliente de mentira: select, eq, in, is, order, limit e maybeSingle. Sem rpc. */
function clienteDeMentira(tabelas: Tabelas) {
  return {
    from(tabela: string) {
      const fonte = tabelas[tabela] ?? [];
      let linhas: Linha[] = Array.isArray(fonte) ? [...fonte] : [];
      const erro = Array.isArray(fonte) ? null : { message: fonte.erro, code: "42501" };
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => ((linhas = linhas.filter((l) => valor(l, c) === v)), q),
        in: (c: string, vs: unknown[]) => ((linhas = linhas.filter((l) => vs.includes(valor(l, c)))), q),
        is: (c: string, v: unknown) => ((linhas = linhas.filter((l) => (valor(l, c) ?? null) === v)), q),
        order: (c: string, o: { ascending?: boolean } = {}) => (
          (linhas = [...linhas].sort((a, b) => String(valor(a, c)).localeCompare(String(valor(b, c))) * (o.ascending === false ? -1 : 1))), q
        ),
        limit: () => q,
        maybeSingle: async () => (erro ? { data: null, error: erro } : { data: linhas[0] ?? null, error: null }),
        then: (ok: (r: { data: Linha[] | null; error: typeof erro }) => unknown) =>
          Promise.resolve(erro ? { data: null, error: erro } : { data: linhas, error: null }).then(ok),
      };
      return q;
    },
  } as never;
}

const ORG = { id: "00000000-0000-4000-8000-0000000000a1", status: "active", demonstracao: false } as never;
const AGORA = Date.now();
const dia = (n: number) => new Date(AGORA + n * 86_400_000).toISOString();

function assinatura(a: Linha): Linha {
  return {
    organization_id: (ORG as { id: string }).id,
    plano_id: "plano-1",
    plano_agendado_id: null,
    estado: "trial",
    trial_ate: dia(10),
    vencida_desde: null,
    proximo_vencimento: null,
    prazo_extra_ate: null,
    cancela_no_fim: false,
    assinaturas_vivas: 0,
    ultimo_aviso: null,
    ultimo_aviso_em: null,
    provedor: null,
    provedor_assinatura_id: null,
    pagamento_inicial_pendente: false,
    link_de_pagamento: null,
    ...a,
  };
}

async function areaDoPlano(a: Linha | null, extra: { org?: Linha; origem?: Tabelas[string] } = {}) {
  const admin = clienteDeMentira({
    cobranca_assinaturas: a ? [a] : [],
    cobranca_planos: [{ id: "plano-1", nome: "Profissional" }],
    mia_origem_da_empresa: extra.origem ?? [{ organization_id: (ORG as { id: string }).id, origem: "cadastro" }],
  });
  const r = await planoECobranca.avaliar(
    { admin, autorUserId: "", tokenId: "", requestId: "", instalacao: { cobrancaLigada: true } } as never,
    { ...(ORG as Linha), ...(extra.org ?? {}) } as never,
  );
  return r.dados as Record<string, unknown>;
}

describe("a área do plano decide pela situação da .90", () => {
  it("o teste com a assinatura já feita no provedor conta como assinado", async () => {
    const d = await areaDoPlano(assinatura({ provedor: "asaas", provedor_assinatura_id: "sub_1" }));
    expect(d).toMatchObject({ situacao: "teste", assinou: true, plano: "Profissional", origem: "cadastro" });
  });

  it("o teste vencido sem pagamento pede assinar, não regularizar", async () => {
    const d = await areaDoPlano(assinatura({ trial_ate: dia(-1) }));
    expect(d).toMatchObject({ situacao: "atraso", assinou: false, ja_pagou: false });
  });

  it("o prazo extra e a empresa suspensa pedem regularizar", async () => {
    const prazo = await areaDoPlano(
      assinatura({ estado: "em_atraso", provedor: "asaas", provedor_assinatura_id: "sub_1", vencida_desde: dia(-5), prazo_extra_ate: dia(3) }),
    );
    expect(prazo).toMatchObject({ situacao: "prazo", assinou: false, ja_pagou: true });
    const suspensa = await areaDoPlano(assinatura({ estado: "ativa", provedor: "asaas", provedor_assinatura_id: "sub_1" }), {
      org: { status: "suspended" },
    });
    expect(suspensa.situacao).toBe("suspensa");
  });

  it("pela sessão a origem é recusada (só do servidor) e a área segue", async () => {
    const d = await areaDoPlano(assinatura({ estado: "ativa", provedor: "asaas", provedor_assinatura_id: "sub_1" }), {
      origem: { erro: "permission denied for table mia_origem_da_empresa" },
    });
    expect(d).toMatchObject({ situacao: "emdia", assinou: true, origem: null });
  });

  it("sem assinatura é isenta (a implantada pela Time), com a origem para o MCP", async () => {
    const d = await areaDoPlano(null, { origem: [{ organization_id: (ORG as { id: string }).id, origem: "implantacao" }] });
    expect(d).toMatchObject({ aplica: false, motivo: "isenta", origem: "implantacao" });
  });

  it("o rótulo: em dia é preenchido; o prazo extra é regularizar; o teste vencido é assinar", () => {
    const plano = (dados: Linha): AreaAvaliada[] => [
      { area: "plano_e_cobranca", titulo: "", situacao: "pronto", pronto: [], falta: [], so_pela_tela: [], dados },
    ];
    const item = (dados: Linha) => rotuloDoCliente(plano(dados), { papel: "admin" }).itens.find((i) => i.chave === "plano");
    expect(item({ aplica: true, situacao: "emdia", assinou: true, ja_pagou: true, plano: "Profissional" })?.coluna).toBe("preenchido");
    expect(item({ aplica: true, situacao: "prazo", assinou: false, ja_pagou: true })?.titulo.texto).toBe("Regularizar o pagamento");
    expect(item({ aplica: true, situacao: "atraso", assinou: false, ja_pagou: false, teste_ate: dia(-1) })?.titulo.texto).toBe("Assinar o plano");
    // a leitura de antes da fusão (sem `situacao`) segue valendo
    expect(item({ aplica: true, assinou: true, estado: "ativa" })?.coluna).toBe("preenchido");
  });
});

describe("a Time vê o \"o que falta\" pela fonte do Início", () => {
  it("o retrato mais novo e o primeiro de cada empresa", async () => {
    const admin = clienteDeMentira({
      mia_assistente_retratos: [
        { organization_id: "org-a", faltam: 5, total: 8, rodada_em: "2026-10-20T10:00:00Z" },
        { organization_id: "org-a", faltam: 2, total: 8, rodada_em: "2026-10-24T10:00:00Z" },
        { organization_id: "org-b", faltam: 6, total: 7, rodada_em: "2026-10-23T10:00:00Z" },
      ],
    });
    const m = await lerRetratosDasEmpresas(admin);
    expect(m.get("org-a")).toEqual({ faltam: 2, total: 8, ao_entrar: 5, em: "2026-10-24T10:00:00Z" });
    expect(m.get("org-b")).toEqual({ faltam: 6, total: 7, ao_entrar: 6, em: "2026-10-23T10:00:00Z" });
    expect((await lerRetratosDasEmpresas(admin, [])).size).toBe(0);
  });

  it("retrato ilegível não derruba a tela: mapa vazio", async () => {
    const m = await lerRetratosDasEmpresas(clienteDeMentira({ mia_assistente_retratos: { erro: "fora" } }));
    expect(m.size).toBe(0);
  });
});

describe("a empresa que espera a Time ligar o número", () => {
  const esperando = (id: string, nome: string, extra: Linha = {}) => ({
    id,
    display_name: nome,
    demonstracao: false,
    onboarding_state: { whatsapp: { status: "esperando_a_time", entrou_com_facebook_em: "2026-10-24T12:00:00Z" } },
    ...extra,
  });

  it("aparece até o número dela estar conectado; demonstração e quem não pediu ficam de fora", async () => {
    const admin = clienteDeMentira({
      organizations: [
        esperando("org-1", "Academia Alfa"),
        esperando("org-2", "Vita Odonto"),
        esperando("org-3", "Demonstração", { demonstracao: true }),
        { id: "org-4", display_name: "Construtora Delta", demonstracao: false, onboarding_state: { whatsapp: { skipped: true } } },
      ],
      channel_sessions: [
        { organization_id: "org-2", status: "WORKING", archived_at: null },
        { organization_id: "org-1", status: "FAILED", archived_at: null },
      ],
    });
    const lista = await lerEmpresasEsperandoONumero(admin);
    expect(lista).toEqual([{ organization_id: "org-1", nome: "Academia Alfa", desde: "2026-10-24T12:00:00Z" }]);
  });

  it("o recado do zap: um por empresa, com a chave própria, ao lado do número sem empresa", () => {
    const r = recadosPendentes({
      pedidos: [],
      numeros: [{ id: "num-1", conta: "Studio Gama" }],
      empresasEsperandoONumero: [{ organization_id: "org-1", nome: "Academia Alfa", desde: "2026-10-24T12:00:00Z" }],
      empresas: [],
      agora: new Date("2026-10-25T13:30:00Z"),
    });
    expect(r.map((x) => x.chave)).toEqual(["jornada:zap:numero:num-1", "jornada:zap:numero_da_empresa:org-1:2026-10-24"]);
    expect(r[1]!.texto).toContain("Academia Alfa entrou com o Facebook em 2026-10-24 e espera a Time");
  });

  it("sem a lista nova, os recados da .90 ficam como eram", () => {
    const r = recadosPendentes({ pedidos: [], numeros: [{ id: "num-1", conta: null }], empresas: [], agora: new Date() });
    expect(r.map((x) => x.chave)).toEqual(["jornada:zap:numero:num-1"]);
  });
});
