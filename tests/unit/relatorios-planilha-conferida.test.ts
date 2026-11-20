/**
 * MIA-106 · A PLANILHA (CSV) DO MONTADOR, CONFERIDA.
 *
 * ─── O que se trava, e por quê ──────────────────────────────────────────────
 *
 * 1. O ESCAPE de toda célula de texto: vírgula, ponto e vírgula, aspas, quebra
 *    de linha e a célula que viraria fórmula (`=`, `+`, `-`, `@`, tab). O
 *    telefone e a variação com sinal saem como estão.
 * 2. ⭐ O NÚMERO com o separador vírgula. `1500,5` sem aspas virava DUAS colunas
 *    e a planilha escorregava a partir dali (defeito achado na conferência; o
 *    ponto e vírgula, que é o padrão, não tinha o problema). Cada linha da
 *    planilha, lida por um leitor de CSV de verdade, tem de ter as colunas do
 *    cabeçalho.
 * 3. ⭐ O TOTAL da planilha é o da tela (`modelo.total.valor`, o mesmo que o
 *    rodapé da `Tabela` mostra), e não a soma das linhas: com etiquetas, o
 *    negócio com duas conta em cada uma e uma vez só no total.
 * 4. ⭐ A EMPRESA vem de quem exporta (`quem.organizationId`, do cookie
 *    validado): o motor, a lista e o registro da exportação recebem ela, e o
 *    registro das exportações só lê a dela.
 * 5. ⭐ O FUSO da planilha é o que o motor usou (`janela.fuso`), o mesmo que a
 *    tela lê: o negócio ganho às 23h30 de 30/09 em Manaus sai "30/09/2026" na
 *    planilha da academia de Manaus, ainda que a rota tenha lido outro fuso.
 *
 * Sabotagens que confirmam que a guarda vigia (medidas): tirar `numeroCsv` de
 * `csvDoRelatorio` deixa o caso 2 vermelho; voltar `ctx.fuso` para `p.fuso` em
 * `exportarPlanilha` deixa o caso 5 vermelho.
 *
 * Dados fictícios (Academia Alfa, Ana Exemplo).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined), isServiceRoleConfigured: () => false }));

import type { RespostaDoMotor } from "@/lib/paineis/motor";
import { modeloDoGrafico } from "@/lib/relatorios/apresentar";
import type { ConfigDoRelatorio } from "@/lib/relatorios/config";
import { celulaCsv, csvDaLista, csvDoRelatorio, numeroCsv, type Separador } from "@/lib/relatorios/csv";
import { colunasDaLista, type LinhaDaLista } from "@/lib/relatorios/lista";
import { exportarPlanilha, listarExportacoes, type QuemAge } from "@/lib/relatorios/servidor";

const t = (s: string) => s;
const f = { t, tag: "pt-BR", moeda: "BRL" };
const ORG = "a1fa0000-0000-4000-8000-00000000a1fa";
const OUTRA = "b0b00000-0000-4000-8000-00000000b0b0";

/** Um leitor de CSV (RFC 4180): aspas duplas envolvem, `""` é uma aspa. */
function lerCsv(texto: string, sep: Separador): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let celula = "";
  let aspas = false;
  const s = texto.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (aspas) {
      if (c === '"' && s[i + 1] === '"') {
        celula += '"';
        i++;
      } else if (c === '"') aspas = false;
      else celula += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      linha.push(celula);
      celula = "";
    } else if (c === "\r" && s[i + 1] === "\n") {
      linha.push(celula);
      linhas.push(linha);
      linha = [];
      celula = "";
      i++;
    } else celula += c;
  }
  if (celula || linha.length) {
    linha.push(celula);
    linhas.push(linha);
  }
  return linhas;
}

function resposta(parcial: Record<string, unknown>): RespostaDoMotor {
  return {
    fonte: "negocios",
    medidas: ["soma"],
    dim1: "origem",
    dim2: null,
    filtros: {},
    janela: { periodo: "30", de: "2026-09-16", ate: "2026-10-15", inicio: null, fim: null, fuso: "America/Sao_Paulo", hoje: "2026-10-15", futuro: false, dias: 30 },
    moeda: "BRL",
    valores: true,
    total: { n: 0, n_ok: 0, valores: {} },
    fora_da_moeda: 0,
    grupos: [],
    series: null,
    dobrados: [],
    funil: null,
    meta: null,
    anterior: null,
    ...parcial,
  } as unknown as RespostaDoMotor;
}

describe("1. o escape de cada célula de texto", () => {
  it.each<[string, Separador, string]>([
    ["Academia Alfa, unidade Centro", ",", '"Academia Alfa, unidade Centro"'],
    ["Academia Alfa, unidade Centro", ";", "Academia Alfa, unidade Centro"],
    ["Plano; anual", ";", '"Plano; anual"'],
    ['Plano "Ouro"', ";", '"Plano ""Ouro"""'],
    ["Ana Exemplo\nrecepção", ";", '"Ana Exemplo\nrecepção"'],
    ["Ana Exemplo\r\nrecepção", ",", '"Ana Exemplo\r\nrecepção"'],
    ["=HYPERLINK(1)", ";", "'=HYPERLINK(1)"],
    ['=HYPERLINK("https://exemplo.invalid")', ";", `"'=HYPERLINK(""https://exemplo.invalid"")"`],
    ["=1+1, de novo", ",", `"'=1+1, de novo"`],
    ["@SOMA(A1:A9)", ";", "'@SOMA(A1:A9)"],
    ["+cmd|' /C calc'!A0", ";", "'+cmd|' /C calc'!A0"],
    ["-2+3+cmd|' /C calc'!A0", ";", "'-2+3+cmd|' /C calc'!A0"],
    ["\t=1", ";", "'\t=1"],
    ["+5500900000001", ";", "+5500900000001"],
    ["+12%", ";", "+12%"],
    ["-3,5 pontos", ";", "-3,5 pontos"],
  ])("%j com %j vira %j", (valor, sep, esperado) => {
    expect(celulaCsv(valor, sep)).toBe(esperado);
  });

  it("o leitor de CSV devolve o texto (com o apóstrofo da fórmula), numa coluna só", () => {
    for (const sep of [";", ","] as const) {
      for (const valor of ["Academia Alfa, Centro", 'Plano "Ouro"', "Ana Exemplo\r\nrecepção", "=1+1, de novo"]) {
        const linha = lerCsv(`${celulaCsv(valor, sep)}${sep}fim\r\n`, sep);
        expect(linha).toHaveLength(1);
        expect(linha[0]).toEqual([valor.startsWith("=") ? `'${valor}` : valor, "fim"]);
      }
    }
  });
});

describe("2. ⭐ o número não parte a coluna", () => {
  it("numeroCsv põe aspas só quando o número tem o separador", () => {
    expect(numeroCsv("1500,5", ",")).toBe('"1500,5"');
    expect(numeroCsv("1500,5", ";")).toBe("1500,5");
    expect(numeroCsv("12", ",")).toBe("12");
  });

  const m = modeloDoGrafico(
    resposta({
      dim1: "etiqueta",
      total: { n: 2, n_ok: 0, valores: { soma: 150050 } },
      grupos: [
        { chave: "Musculação, manhã", rotulo: null, ordem: null, sem: false, outros: false, n: 1, n_ok: 0, valores: { soma: 100025 } },
        { chave: "=HYPERLINK(1)", rotulo: null, ordem: null, sem: false, outros: false, n: 1, n_ok: 0, valores: { soma: 50025 } },
      ],
      anterior: { janela: { de: "2026-08-17", ate: "2026-09-15" }, total: { n: 1, n_ok: 0, valores: { soma: 100000 } }, grupos: {} },
    }),
    "soma",
    {},
  );

  it.each([";", ","] as const)("o relatório com %j: cada linha tem as colunas do cabeçalho e o valor volta inteiro", (sep) => {
    const { texto } = csvDoRelatorio(m, { sep, rotuloDaMedida: "Soma do valor", f });
    const linhas = lerCsv(texto, sep);
    expect(linhas[0]).toEqual(["Etiqueta", "Soma do valor (BRL)", "Período anterior (BRL)", "Variação"]);
    for (const l of linhas) expect(l).toHaveLength(4);
    expect(linhas[1]).toEqual(["Musculação, manhã", "1000,25", "", ""]);
    expect(linhas[2]).toEqual(["'=HYPERLINK(1)", "500,25", "", ""]);
    expect(linhas[3]).toEqual(["Total", "1500,5", "1000", "+50%"]);
  });

  it.each([";", ","] as const)("a lista com %j: o dinheiro e o nome com vírgula ficam cada um na sua coluna", (sep) => {
    const linha: LinhaDaLista = {
      registro: "r1",
      momento: "2026-10-05T13:00:00Z",
      dims: { situacao: "ganho", resp: "u1", origem: "meta_ads", produto: ["Plano anual"] },
      rotulos: { etapa: "Matrícula" },
      valor_cents: 450050,
      moeda: "BRL",
      sit: "ganho",
      x1: null,
      x2: null,
      ok: true,
      detalhe: { titulo: "Plano anual, 12x", contato_nome: "=Ana Exemplo", telefone: "+5500900000001", etapa: "Matrícula", link: "/app/leads/r1" },
    };
    const colunas = colunasDaLista("negocios", { valores: true, tela: false });
    const { texto } = csvDaLista(colunas, [linha], { sep, moeda: "BRL", ctx: { nomes: { u1: "Ana Exemplo" }, fuso: "America/Sao_Paulo", t } });
    const [cab, corpo, ...resto] = lerCsv(texto, sep);
    expect(resto).toEqual([]);
    expect(corpo).toHaveLength(cab!.length);
    expect(corpo).toContain("4500,5");
    expect(corpo).toContain("Plano anual, 12x");
    expect(corpo).toContain("'=Ana Exemplo");
    expect(corpo).toContain("+5500900000001");
  });
});

describe("3. ⭐ o total da planilha é o da tela", () => {
  it("com etiquetas, o total é o do motor (um negócio uma vez), não a soma das linhas", () => {
    const m = modeloDoGrafico(
      resposta({
        medidas: ["qtd"],
        dim1: "etiqueta",
        total: { n: 3, n_ok: 0, valores: { qtd: 3 } },
        grupos: [
          { chave: "Musculação", rotulo: null, ordem: null, sem: false, outros: false, n: 2, n_ok: 0, valores: { qtd: 2 } },
          { chave: "Natação", rotulo: null, ordem: null, sem: false, outros: false, n: 2, n_ok: 0, valores: { qtd: 2 } },
        ],
      }),
      "qtd",
      {},
    );
    const linhas = lerCsv(csvDoRelatorio(m, { sep: ";", rotuloDaMedida: "Quantidade", f }).texto, ";");
    // O rodapé da `Tabela` (components/relatorios/Grafico.tsx) mostra `modelo.total.valor`.
    expect(m.total.valor).toBe(3);
    expect(linhas.at(-1)).toEqual(["Total", "3"]);
  });

  it("com séries, a coluna do total é a do motor e cada série soma as suas linhas", () => {
    const m = modeloDoGrafico(
      resposta({
        medidas: ["qtd"],
        dim1: "origem",
        dim2: "situacao",
        total: { n: 5, n_ok: 0, valores: { qtd: 5 } },
        series: [
          { chave: "ganho", rotulo: null, sem: false, outros: false, n: 3 },
          { chave: "perdido", rotulo: null, sem: false, outros: false, n: 2 },
        ],
        grupos: [
          { chave: "meta_ads", rotulo: null, ordem: null, sem: false, outros: false, n: 3, n_ok: 0, valores: { qtd: 3 }, series: { ganho: { n: 2, valores: { qtd: 2 } }, perdido: { n: 1, valores: { qtd: 1 } } } },
          { chave: "indicacao", rotulo: null, ordem: null, sem: false, outros: false, n: 2, n_ok: 0, valores: { qtd: 2 }, series: { ganho: { n: 1, valores: { qtd: 1 } }, perdido: { n: 1, valores: { qtd: 1 } } } },
        ],
      }),
      "qtd",
      {},
    );
    const linhas = lerCsv(csvDoRelatorio(m, { sep: ",", rotuloDaMedida: "Quantidade", f }).texto, ",");
    expect(linhas.at(-1)).toEqual(["Total", "3", "2", "5"]);
  });
});

// ─── 4 e 5: a exportação inteira, com um banco falso que registra o que pede ──

interface Chamadas {
  rpc: Array<{ nome: string; args: Record<string, unknown> }>;
  inserts: Array<{ tabela: string; linha: Record<string, unknown> }>;
  filtros: Array<{ tabela: string; coluna: string; valor: unknown }>;
}

function bancoFalso(respostas: Record<string, unknown>): { db: SupabaseClient; chamadas: Chamadas } {
  const chamadas: Chamadas = { rpc: [], inserts: [], filtros: [] };
  const db = {
    rpc: async (nome: string, args: Record<string, unknown>) => {
      chamadas.rpc.push({ nome, args });
      return { data: respostas[nome] ?? null, error: null };
    },
    from: (tabela: string) => {
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq: (coluna: string, valor: unknown) => {
          chamadas.filtros.push({ tabela, coluna, valor });
          return q;
        },
        insert: async (linha: Record<string, unknown>) => {
          chamadas.inserts.push({ tabela, linha });
          return { error: null };
        },
        then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(ok, falha),
      });
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, chamadas };
}

const CONFIG: ConfigDoRelatorio = {
  fonte: "negocios",
  medida: "soma",
  dim1: "origem",
  dim2: null,
  filtros: {},
  periodo: "30",
  de: null,
  ate: null,
  comparar: false,
  visualizacao: "barras",
} as unknown as ConfigDoRelatorio;

const QUEM: QuemAge = { organizationId: ORG, userId: "a1fa0000-1111-4000-8000-0000000000a1", requestId: "req-mia-106", via: "tela" };

function pedido(tipo: "relatorio" | "lista") {
  return {
    tipo,
    nome: "Matrículas do mês",
    relatorioId: null,
    pronto: null,
    config: CONFIG,
    valores: true,
    funilPadrao: null,
    sep: ";" as const,
    empresa: "Academia Alfa",
    // O que a rota leu em `organizations.timezone`: de propósito, OUTRO fuso.
    fuso: "America/Sao_Paulo",
    f,
  };
}

// 01/10/2026 03:30 UTC = 30/09 23:30 em Manaus (UTC-4) = 01/10 00:30 em São Paulo.
const MOMENTO = "2026-10-01T03:30:00Z";

const LISTA = {
  fonte: "negocios",
  janela: { de: "2026-09-01", ate: "2026-09-30", fuso: "America/Manaus" },
  moeda: "BRL",
  valores: true,
  medidas: ["soma"],
  n: 1,
  total: { n: 1, n_ok: 1, valores: { soma: 19990 } },
  limite: 20000,
  deslocamento: 0,
  linhas: [
    {
      registro: "a1fa0000-5555-4000-8000-000000000001",
      momento: MOMENTO,
      dims: { situacao: "ganho", origem: "indicacao" },
      rotulos: { etapa: "Matrícula" },
      valor_cents: 19990,
      moeda: "BRL",
      sit: "ganho",
      x1: null,
      x2: null,
      ok: true,
      detalhe: { titulo: "Plano mensal", contato_nome: "Ana Exemplo", telefone: "+5500900000001", etapa: "Matrícula" },
    },
  ],
};

describe("4. ⭐ a empresa é a de quem exporta", () => {
  it("o motor, a lista e o registro da exportação recebem a empresa da sessão", async () => {
    for (const tipo of ["relatorio", "lista"] as const) {
      const { db, chamadas } = bancoFalso({
        fn_mia_relatorio: resposta({ total: { n: 1, n_ok: 0, valores: { soma: 19990 } } }),
        fn_mia_relatorio_lista: LISTA,
      });
      await exportarPlanilha(db, null, QUEM, pedido(tipo));
      expect(chamadas.rpc.length, tipo).toBeGreaterThan(0);
      for (const c of chamadas.rpc) expect(c.args.p_org, `${tipo}: ${c.nome}`).toBe(ORG);
      expect(chamadas.inserts).toEqual([
        { tabela: "mia_relatorios_exportacoes", linha: expect.objectContaining({ organization_id: ORG, user_id: QUEM.userId, tipo }) },
      ]);
    }
  });

  it("o registro das exportações só lê a empresa pedida", async () => {
    const { db, chamadas } = bancoFalso({});
    await listarExportacoes(db, ORG);
    expect(chamadas.filtros).toEqual([{ tabela: "mia_relatorios_exportacoes", coluna: "organization_id", valor: ORG }]);
    expect(chamadas.filtros.some((x) => x.valor === OUTRA)).toBe(false);
  });
});

describe("5. ⭐ o fuso da planilha é o da tela (o do motor)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a data da lista e o dia do nome do arquivo saem no fuso que o motor usou", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(MOMENTO));
    const { db } = bancoFalso({ fn_mia_relatorio_lista: LISTA });
    const planilha = await exportarPlanilha(db, null, QUEM, pedido("lista"));
    expect(planilha.texto).toContain("Ganhou em 30/09/2026");
    expect(planilha.texto).not.toContain("01/10/2026");
    expect(planilha.arquivo).toBe("academia-alfa_matriculas-do-mes_2026-09-30.csv");
  });

  it("o relatório também nomeia o arquivo pelo dia do fuso do motor", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(MOMENTO));
    const r = resposta({ total: { n: 1, n_ok: 0, valores: { soma: 19990 } } }) as unknown as { janela: Record<string, unknown> };
    r.janela = { ...r.janela, fuso: "America/Manaus" };
    const { db } = bancoFalso({ fn_mia_relatorio: r });
    const planilha = await exportarPlanilha(db, null, QUEM, pedido("relatorio"));
    expect(planilha.arquivo).toBe("academia-alfa_matriculas-do-mes_2026-09-30.csv");
  });
});
