/**
 * FORK MIA — obrigações: os modelos de tipo por segmento e as frases de tela.
 *
 * Duas regras que só se quebram em silêncio:
 *
 *  1. PRIVACIDADE. Atestado, laudo de saúde e exame são dado sensível e ficam
 *     fora dos modelos: nenhum segmento oferece um tipo desses pronto.
 *  2. ESPANHOL. Toda frase que a tela das obrigações mostra tem tradução, e o
 *     arquivo de frases do fork não repete chave que outro arquivo já traduz
 *     (o espalhamento vem por último e venceria a tradução de lá).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DICIONARIO } from "@/lib/i18n/dicionario";
import { DICIONARIO_CARTOES_MIA } from "@/lib/i18n/dicionario-cartoes-mia";
import { DICIONARIO_DA_AGENDA_MICROSOFT } from "@/lib/i18n/dicionario-mia-agenda-microsoft";
import { DICIONARIO_OBRIGACOES_MIA } from "@/lib/i18n/dicionario-obrigacoes-mia";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import {
  ehSegmentoDeObrigacao,
  ehTipoSensivel,
  MODELOS_DE_TIPO,
  modelosDoSegmento,
  ROTULO_DO_SEGMENTO_DE_OBRIGACAO,
  SEGMENTOS_DE_OBRIGACAO,
} from "@/lib/obrigacoes/catalogo";
import { EXPLICACAO_DOS_GATILHOS_DE_OBRIGACAO, ROTULOS_DOS_GATILHOS_DE_OBRIGACAO } from "@/lib/obrigacoes/gatilhos";
import { CONTADORES_DA_LISTA } from "@/lib/obrigacoes/lista";
import { ROTULO_DA_SITUACAO, ROTULOS_DOS_BOTOES } from "@/lib/obrigacoes/situacao";
import {
  chaveDoNome,
  ROTULO_CURTO_DE_QUEM_ENTREGA,
  ROTULO_DA_CATEGORIA,
  ROTULO_DA_RECORRENCIA,
  ROTULO_DE_LIGA_A,
  ROTULO_DE_QUEM_ENTREGA,
  TETO_DE_AVISOS,
} from "@/lib/obrigacoes/tipos";

describe("os modelos de tipo por segmento", () => {
  it("todo segmento tem modelos, e todo modelo é de um segmento conhecido", () => {
    for (const segmento of SEGMENTOS_DE_OBRIGACAO) {
      expect(modelosDoSegmento(segmento).length, segmento).toBeGreaterThan(0);
      expect(ROTULO_DO_SEGMENTO_DE_OBRIGACAO[segmento]).toBeTruthy();
    }
    for (const m of MODELOS_DE_TIPO) expect(ehSegmentoDeObrigacao(m.segmento)).toBe(true);
    expect(ehSegmentoDeObrigacao("saude")).toBe(false);
  });

  it("⭐ nenhum modelo é documento de saúde (dado sensível)", () => {
    const sensiveis = MODELOS_DE_TIPO.filter((m) => ehTipoSensivel(m.nome) || ehTipoSensivel(m.nome_curto));
    expect(sensiveis.map((m) => `${m.segmento}: ${m.nome}`)).toEqual([]);
  });

  it("o detector separa o laudo do carro do laudo médico", () => {
    for (const nome of ["Atestado médico", "Atestado de saúde ocupacional", "Laudo médico", "Laudo de saúde", "Exame de sangue", "Exames", "Prontuário", "Receita médica", "LAUDO PSICOLÓGICO"]) {
      expect(ehTipoSensivel(nome), nome).toBe(true);
    }
    for (const nome of ["Laudo de vistoria", "Alvará de funcionamento", "CNH", "Contrato social", "Reavaliação física", "Comprovante de renda"]) {
      expect(ehTipoSensivel(nome), nome).toBe(false);
    }
  });

  it("dentro de um segmento, nenhum nome se repete", () => {
    for (const segmento of SEGMENTOS_DE_OBRIGACAO) {
      const nomes = modelosDoSegmento(segmento).map((m) => chaveDoNome(m.nome));
      expect(new Set(nomes).size, segmento).toBe(nomes.length);
    }
  });

  it("cada modelo cabe nos limites do banco", () => {
    for (const m of MODELOS_DE_TIPO) {
      const onde = `${m.segmento}: ${m.nome}`;
      expect(m.nome.length, onde).toBeLessThanOrEqual(120);
      expect(m.avisos_dias.length, onde).toBeLessThanOrEqual(TETO_DE_AVISOS);
      expect([...m.avisos_dias].sort((a, b) => b - a), onde).toEqual(m.avisos_dias);
      expect(m.validade_meses, onde).toBeGreaterThanOrEqual(0);
      expect(m.dias_sem_resposta, onde).toBeGreaterThan(0);
      if (m.recorrencia === "n_meses") expect(m.recorrencia_meses, onde).toBeGreaterThan(0);
      else expect(m.recorrencia_meses, onde).toBeNull();
      // Atividade não tem validade nem arquivo: quem tem é documento.
      if (m.categoria === "atividade") {
        expect(m.validade_meses, onde).toBe(0);
        expect(m.pede_arquivo, onde).toBe(false);
      }
    }
  });

  it("o modelo de Serviços B2B traz as validades e os avisos aprovados", () => {
    const porNome = Object.fromEntries(modelosDoSegmento("servicos_b2b").map((m) => [m.nome, m]));
    expect(porNome["Alvará de funcionamento"]).toMatchObject({ nome_curto: "Alvará", recorrencia: "anual", validade_meses: 12, liga_a: "empresa", avisos_dias: [30, 15, 7] });
    expect(porNome["AVCB (vistoria dos bombeiros)"]).toMatchObject({ nome_curto: "AVCB", recorrencia: "n_meses", recorrencia_meses: 36, validade_meses: 36, avisos_dias: [60, 30, 15] });
    expect(porNome["Contrato social"]).toMatchObject({ recorrencia: "unica", validade_meses: 0, avisos_dias: [] });
    expect(porNome["Relatório mensal"]).toMatchObject({ categoria: "atividade", quem_entrega: "nos", recorrencia: "mensal", avisos_dias: [5, 2] });
    expect(porNome["Renovação anual do contrato"]).toMatchObject({ categoria: "atividade", recorrencia: "anual", avisos_dias: [45, 30, 15] });
  });
});

function arquivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return arquivos(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

/** As frases que a tela das obrigações mostra: as passadas a `t()`, as recusas e os rótulos de tabela. */
function frasesDaTela(): Set<string> {
  const frases = new Set<string>();
  const fontes = [
    ...arquivos("components/obrigacoes"),
    ...arquivos("app/app/obrigacoes"),
    ...arquivos("lib/obrigacoes"),
    ...arquivos("app/api/v1/obrigacoes"),
    "components/cartoes/LinhasDoCartao.tsx",
    "components/cartoes/aberto/Foco.tsx",
  ];
  const literal = '"((?:[^"\\\\]|\\\\.)*)"';
  const padroes = [
    new RegExp(`\\b(?:t|rota\\.t)\\(\\s*${literal}`, "g"),
    new RegExp(`ErroDeObrigacao\\(\\s*"[a-z_]+",\\s*${literal}`, "g"),
    new RegExp(`(?:mensagem|label|rotulo):\\s*${literal}`, "g"),
  ];
  for (const fonte of fontes) {
    const texto = readFileSync(fonte, "utf8");
    for (const padrao of padroes) {
      for (const m of texto.matchAll(padrao)) frases.add(JSON.parse(`"${m[1]}"`) as string);
    }
  }
  for (const tabela of [
    ROTULO_DA_SITUACAO,
    ROTULOS_DOS_BOTOES,
    ROTULO_DA_CATEGORIA,
    ROTULO_DE_QUEM_ENTREGA,
    ROTULO_CURTO_DE_QUEM_ENTREGA,
    ROTULO_DA_RECORRENCIA,
    ROTULO_DE_LIGA_A,
    ROTULO_DO_SEGMENTO_DE_OBRIGACAO,
    ROTULOS_DOS_GATILHOS_DE_OBRIGACAO,
    EXPLICACAO_DOS_GATILHOS_DE_OBRIGACAO,
  ]) {
    for (const frase of Object.values(tabela)) frases.add(frase);
  }
  for (const contador of CONTADORES_DA_LISTA) frases.add(contador.rotulo);
  return frases;
}

describe("as frases de tela das obrigações", () => {
  const frases = frasesDaTela();

  it("o instrumento está vivo: achou as frases antes de concluir qualquer coisa", () => {
    expect(frases.size).toBeGreaterThan(150);
    expect(frases.has("Documentos e obrigações")).toBe(true);
    expect(frases.has("Sim, marcar recebido")).toBe(true);
  });

  it("⭐ toda frase tem espanhol", () => {
    const semEspanhol = [...frases].filter((frase) => !DICIONARIO[frase]?.es).sort();
    expect(semEspanhol).toEqual([]);
  });

  it("o item de menu tem nome e descrição em espanhol", () => {
    const item = NAV_CATALOG.find((i) => i.href === "/app/obrigacoes");
    expect(item, "o catálogo de navegação perdeu /app/obrigacoes").toBeTruthy();
    expect(DICIONARIO[item!.label]?.es).toBeTruthy();
    expect(DICIONARIO[item!.description]?.es).toBeTruthy();
  });

  it("⭐ o arquivo do fork não repete chave que outro arquivo já traduz", () => {
    const fonte = readFileSync("lib/i18n/dicionario.ts", "utf8");
    const repetidas = Object.keys(DICIONARIO_OBRIGACOES_MIA).filter(
      (chave) =>
        chave in DICIONARIO_CARTOES_MIA ||
        chave in DICIONARIO_DA_AGENDA_MICROSOFT ||
        fonte.includes(`\n  ${JSON.stringify(chave)}: {`) ||
        fonte.includes(`\n  ${chave}: {`),
    );
    expect(repetidas).toEqual([]);
  });

  it("nenhuma frase usa travessão", () => {
    const comTravessao = Object.entries(DICIONARIO_OBRIGACOES_MIA)
      .filter(([pt, { es }]) => /[—–]/.test(pt) || /[—–]/.test(es))
      .map(([pt]) => pt);
    expect(comTravessao).toEqual([]);
  });

  it("nenhuma tradução ficou igual por esquecimento numa frase inteira", () => {
    // Palavra solta pode coincidir nos dois idiomas ("vencido", "Clínica");
    // frase com quatro palavras ou mais, não.
    const iguais = Object.entries(DICIONARIO_OBRIGACOES_MIA)
      .filter(([pt, { es }]) => pt === es && pt.trim().split(/\s+/).length >= 4)
      .map(([pt]) => pt);
    expect(iguais).toEqual([]);
  });
});
