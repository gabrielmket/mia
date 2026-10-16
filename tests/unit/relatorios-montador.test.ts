/**
 * FORK MIA (.80, item 9) — o montador de relatórios do lado do TypeScript: as
 * regras do editor, o pedido ao motor, os rótulos, a planilha, os prontos e a
 * receita da implantação. A conta é do banco (provada em
 * `tests/invariants/montador-de-relatorios.test.ts`); aqui se prova que a tela,
 * as rotas e o MCP pedem a coisa certa e escrevem o resultado certo.
 */
import { describe, expect, it } from "vitest";

import { CATALOGO_DO_MOTOR, FONTES, PAINEIS_PRONTOS } from "@/lib/paineis/catalogo";
import type { RespostaDoMotor } from "@/lib/paineis/motor";
import { modeloDoGrafico, rotuloDaChave } from "@/lib/relatorios/apresentar";
import { DIMENSOES_DO_MONTADOR, FONTES_DO_MONTADOR, medidasDaFonte } from "@/lib/relatorios/catalogo";
import {
  configDoRelatorioSchema,
  configPadrao,
  identificaPessoa,
  motivoDaVisualizacao,
  normalizarConfig,
  pedidoDoRelatorio,
  type ConfigDoRelatorio,
} from "@/lib/relatorios/config";
import { BOM, celulaCsv, csvDaLista, csvDoRelatorio, nomeDoArquivo, numeroBr } from "@/lib/relatorios/csv";
import { colunasDaLista, type LinhaDaLista } from "@/lib/relatorios/lista";
import { RELATORIOS_PRONTOS } from "@/lib/relatorios/prontos";
import { RECEITAS, SEGMENTOS_DE_RELATORIO } from "@/lib/relatorios/segmentos";

const t = (s: string) => s;
const CTX = { valores: true, funilPadrao: { id: "f0000000-0000-4000-8000-000000000001", nome: "Vendas" } };

function cfg(parte: Partial<ConfigDoRelatorio> & Pick<ConfigDoRelatorio, "fonte">): ConfigDoRelatorio {
  return { ...configPadrao(parte.fonte), ...parte };
}

describe("o catálogo do montador sai do catálogo do motor", () => {
  it("as medidas de relatório são as do motor, menos as auxiliares", () => {
    for (const f of FONTES) {
      const m = medidasDaFonte(f);
      expect(m).not.toContain("chegaram");
      expect(m).not.toContain("sem_prob");
      expect(m.every((x) => (CATALOGO_DO_MOTOR[f].medidas as readonly string[]).includes(x))).toBe(true);
    }
  });

  it("todo agrupamento do motor tem rótulo, e o padrão de cada fonte é válido", () => {
    for (const f of FONTES) {
      for (const d of CATALOGO_DO_MOTOR[f].dims) expect(DIMENSOES_DO_MONTADOR[d], `${f}.${d}`).toBeDefined();
      expect(configDoRelatorioSchema.safeParse(configPadrao(f)).success, f).toBe(true);
      expect(FONTES_DO_MONTADOR[f].nome.length).toBeGreaterThan(0);
    }
  });
});

describe("as regras do editor", () => {
  it("⭐ etapa depende do funil: sem filtro, o funil dos relatórios entra, e o editor avisa", () => {
    const { config, avisos } = normalizarConfig(cfg({ fonte: "negocios", dim1: "etapa" }), CTX);
    expect(config.filtros.funil).toBe(CTX.funilPadrao.id);
    expect(avisos[0]?.dado).toBe("Vendas");
  });

  it("motivo de perda só em negócio perdido; quem não vê valor volta para quantidade", () => {
    expect(normalizarConfig(cfg({ fonte: "negocios", dim1: "motivo" }), CTX).config.filtros.situacao).toBe("perdido");
    expect(normalizarConfig(cfg({ fonte: "negocios", medida: "soma" }), { ...CTX, valores: false }).config.medida).toBe("qtd");
  });

  it("⭐ a visualização que não combina diz por quê", () => {
    expect(motivoDaVisualizacao(cfg({ fonte: "negocios", dim1: "origem" }), "linha")).toMatch(/mês, semana ou dia/);
    expect(motivoDaVisualizacao(cfg({ fonte: "negocios", dim1: "mes" }), "linha")).toBeNull();
    expect(motivoDaVisualizacao(cfg({ fonte: "negocios", medida: "conv", dim1: "origem" }), "rosca")).toMatch(/não se repartem/);
    expect(motivoDaVisualizacao(cfg({ fonte: "negocios", dim1: "etiqueta" }), "rosca")).toMatch(/mais de um grupo/);
    expect(motivoDaVisualizacao(cfg({ fonte: "negocios", medida: "media", dim1: "etapa" }), "funil")).toMatch(/quantidade ou soma/);
    expect(motivoDaVisualizacao(cfg({ fonte: "conversas", dim1: "quem" }), "rosca")).toBeNull();
  });

  it("o contrato recusa filtro de outra fonte e lista no funil", () => {
    expect(configDoRelatorioSchema.safeParse(cfg({ fonte: "conversas", filtros: { produto: "x" } })).success).toBe(false);
    expect(configDoRelatorioSchema.safeParse(cfg({ fonte: "negocios", filtros: { funil: ["a", "b"] } })).success).toBe(false);
    expect(configDoRelatorioSchema.safeParse(cfg({ fonte: "negocios", filtros: { origem: ["meta_ads", "__sem"] } })).success).toBe(true);
  });
});

describe("o pedido ao motor", () => {
  const org = { organizationId: "00000000-0000-4000-8000-000000000001", valores: true };

  it("⭐ o funil desenhado pede 'chegaram' (com a soma quando soma), o número grande não agrupa", () => {
    expect(pedidoDoRelatorio(cfg({ fonte: "negocios", dim1: "etapa", visualizacao: "funil" }), org).medidas).toEqual(["chegaram"]);
    expect(pedidoDoRelatorio(cfg({ fonte: "negocios", medida: "soma", dim1: "etapa", visualizacao: "funil" }), org).medidas).toEqual(["chegaram", "soma"]);
    const numero = pedidoDoRelatorio(cfg({ fonte: "negocios", dim1: "mes", visualizacao: "numero", comparar: true }), org);
    expect([numero.dim1, numero.dim2, numero.comparar]).toEqual([null, null, true]);
  });

  it("a medida que já escolhe a situação não leva o filtro de situação; o período do painel troca o do relatório", () => {
    const p = pedidoDoRelatorio(cfg({ fonte: "negocios", medida: "conv", dim1: "origem", filtros: { situacao: "ganho", origem: ["meta_ads"] } }), {
      ...org,
      periodo: "90",
    });
    expect(p.filtros).toEqual({ origem: ["meta_ads"] });
    expect(p.periodo).toBe("90");
  });

  it("relatório que agrupa ou filtra por pessoa da equipe é identificado (fica fora do link do dono)", () => {
    expect(identificaPessoa(cfg({ fonte: "negocios", dim1: "resp" }))).toBe(true);
    expect(identificaPessoa(cfg({ fonte: "agenda", dim1: "situacao", filtros: { prof: "x" } }))).toBe(true);
    expect(identificaPessoa(cfg({ fonte: "negocios", dim1: "origem" }))).toBe(false);
  });
});

describe("os rótulos e o modelo do gráfico", () => {
  it("Sem, Outros, pessoa, agente e tempo", () => {
    expect(rotuloDaChave("negocios", "produto", "__sem", null, {})).toEqual({ texto: "Sem produto", traduzir: true });
    expect(rotuloDaChave("negocios", "origem", "__outros", null, {}).texto).toBe("Outros");
    expect(rotuloDaChave("negocios", "resp", "u1", null, { u1: "Ana" })).toEqual({ texto: "Ana", traduzir: false });
    expect(rotuloDaChave("conversas", "resp", "ia:x", "Íris", {})).toEqual({ texto: "Íris", traduzir: false });
    expect(rotuloDaChave("negocios", "mes", "2026-10", null, {}).texto).toBe("out/26");
    expect(rotuloDaChave("negocios", "semana", "2026-10-05", null, {}).texto).toBe("sem. 05/10");
  });

  it("⭐ o anterior casa pela POSIÇÃO no tempo, e a meta de cada grupo vem do banco", () => {
    const r = {
      fonte: "negocios",
      medidas: ["soma"],
      dim1: "mes",
      dim2: null,
      filtros: {},
      janela: { periodo: "90", de: "2026-08-01", ate: "2026-10-15", inicio: null, fim: null, fuso: "America/Sao_Paulo", hoje: "2026-10-15", futuro: false, dias: 76 },
      moeda: "BRL",
      valores: true,
      total: { n: 3, n_ok: 0, valores: { soma: 300 } },
      fora_da_moeda: 0,
      grupos: [
        { chave: "2026-09", rotulo: null, ordem: null, sem: false, outros: false, n: 1, n_ok: 0, valores: { soma: 100 }, meta_cents: 500 },
        { chave: "2026-10", rotulo: null, ordem: null, sem: false, outros: false, n: 2, n_ok: 0, valores: { soma: 200 }, meta_cents: null },
      ],
      series: null,
      dobrados: [],
      funil: null,
      meta: null,
      anterior: {
        janela: { de: "2026-06-01", ate: "2026-07-31" },
        total: { n: 1, n_ok: 0, valores: { soma: 50 } },
        grupos: { "2026-06": { n: 1, valores: { soma: 30 } }, "2026-07": { n: 1, valores: { soma: 20 } } },
      },
    } as unknown as RespostaDoMotor;
    const m = modeloDoGrafico(r, "soma", {});
    expect(m.grupos.map((g) => [g.valor, g.anterior, g.meta])).toEqual([
      [100, 30, 500],
      [200, 20, null],
    ]);
    expect(m.anterior?.valor).toBe(50);
  });
});

describe("a planilha", () => {
  it("vírgula decimal sem milhar, e o texto que viraria fórmula ganha apóstrofo", () => {
    expect(numeroBr(1234.5)).toBe("1234,5");
    expect(celulaCsv("=HYPERLINK(1)", ";")).toBe("'=HYPERLINK(1)");
    expect(celulaCsv("a;b", ";")).toBe('"a;b"');
    expect(nomeDoArquivo({ empresa: "Clínica Exemplo", relatorio: "Por que perdemos", grupo: "Preço", hoje: "2026-10-15" })).toBe(
      "clinica-exemplo_por-que-perdemos_lista-preco_2026-10-15.csv",
    );
  });

  it("⭐ a do relatório: BOM, uma linha por grupo, reais (não centavos), o anterior e a variação, e o total", () => {
    const m = modeloDoGrafico(
      {
        fonte: "negocios",
        medidas: ["soma"],
        dim1: "origem",
        dim2: null,
        filtros: {},
        janela: { periodo: "30", de: "2026-09-16", ate: "2026-10-15", inicio: null, fim: null, fuso: "America/Sao_Paulo", hoje: "2026-10-15", futuro: false, dias: 30 },
        moeda: "BRL",
        valores: true,
        total: { n: 2, n_ok: 0, valores: { soma: 150050 } },
        fora_da_moeda: 0,
        grupos: [{ chave: "meta_ads", rotulo: null, ordem: null, sem: false, outros: false, n: 2, n_ok: 0, valores: { soma: 150050 } }],
        series: null,
        dobrados: [],
        funil: null,
        meta: null,
        anterior: { janela: { de: "2026-08-17", ate: "2026-09-15" }, total: { n: 1, n_ok: 0, valores: { soma: 100000 } }, grupos: { meta_ads: { n: 1, valores: { soma: 100000 } } } },
      } as unknown as RespostaDoMotor,
      "soma",
      {},
    );
    const { texto, linhas } = csvDoRelatorio(m, { sep: ";", rotuloDaMedida: "Soma do valor", f: { t, tag: "pt-BR", moeda: "BRL" } });
    expect(texto.startsWith(BOM)).toBe(true);
    const l = texto.slice(1).trim().split("\r\n");
    expect(l[0]).toBe("Origem;Soma do valor (BRL);Período anterior (BRL);Variação");
    expect(l[1]).toBe("Anúncio da Meta;1500,5;1000;+50%");
    expect(l[2]).toBe("Total;1500,5;1000;+50%");
    expect(linhas).toBe(2);
  });

  it("⭐ a da lista: data dd/mm/aaaa, telefone só na planilha, e sem valor para quem não vê", () => {
    const linha: LinhaDaLista = {
      registro: "r1",
      momento: "2026-10-05T13:00:00Z",
      dims: { situacao: "ganho", resp: "u1", origem: "meta_ads", produto: ["Implante"] },
      rotulos: { etapa: "Fechou" },
      valor_cents: 450000,
      moeda: "BRL",
      sit: "ganho",
      x1: null,
      x2: null,
      ok: true,
      detalhe: { titulo: "N1", contato_nome: "Contato Um", contato_apelido: "Apelido do WhatsApp", telefone: "+5500900000001", etapa: "Fechou", link: "/app/leads/r1" },
    };
    const ctx = { nomes: { u1: "Ana" }, fuso: "America/Sao_Paulo", t };
    const comValor = csvDaLista(colunasDaLista("negocios", { valores: true, tela: false }), [linha], { sep: ";", moeda: "BRL", ctx }).texto;
    expect(comValor).toContain("Telefone");
    expect(comValor).toContain("N1;Contato Um;+5500900000001;Implante;Fechou;Ganhos;4500;Ana;Anúncio da Meta;Ganhou em 05/10/2026");
    const semValor = csvDaLista(colunasDaLista("negocios", { valores: false, tela: false }), [linha], { sep: ";", moeda: "BRL", ctx }).texto;
    expect(semValor).not.toContain("4500");
    expect(colunasDaLista("negocios", { valores: true, tela: true }).map((c) => c.titulo)).not.toContain("Telefone");
  });
});

describe("os prontos e a receita da implantação", () => {
  it("os doze prontos, com a chave dos painéis e configuração que o contrato aceita", () => {
    expect(RELATORIOS_PRONTOS.map((p) => p.chave)).toEqual([...PAINEIS_PRONTOS]);
    for (const p of RELATORIOS_PRONTOS) expect(configDoRelatorioSchema.safeParse(p.config).success, p.chave).toBe(true);
  });

  it("⭐ cada segmento: relatórios válidos, chave no formato do banco, e o painel só aponta para o que existe", () => {
    for (const s of SEGMENTOS_DE_RELATORIO) {
      const r = RECEITAS[s];
      const chaves = new Set(r.relatorios.map((x) => x.chave));
      for (const x of r.relatorios) {
        expect(configDoRelatorioSchema.safeParse(x.config).success, `${s}:${x.chave}`).toBe(true);
        expect(x.chave).toMatch(/^[a-z0-9][a-z0-9:_-]{0,79}$/);
      }
      expect(r.painel.chave).toMatch(/^[a-z0-9][a-z0-9:_-]{0,79}$/);
      for (const i of r.painel.itens) {
        if (i.relatorio) expect(chaves.has(i.relatorio), `${s}: ${i.relatorio}`).toBe(true);
        else expect(PAINEIS_PRONTOS).toContain(i.pronto);
      }
      expect(r.link.paineis.every((p) => (PAINEIS_PRONTOS as readonly string[]).includes(p))).toBe(true);
    }
  });
});
