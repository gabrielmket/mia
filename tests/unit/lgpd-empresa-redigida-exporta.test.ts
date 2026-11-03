import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * FORK MIA (.99) · O QUE A EMPRESA REDIGIDA PERDE É O QUE A CÓPIA DOS DADOS DE
 * COBRANÇA ENTREGA.
 *
 * ═══ O buraco que este arquivo fecha ═══
 *
 * A .96 passou a guardar os dados fiscais de quem assina a MIA (`mia_dados_fiscais`,
 * 9120: na pessoa física, CPF, nome completo, endereço e WhatsApp), o retrato do
 * passo do pagamento (9121) e o cartão das mensalidades (9125). A anonimização da
 * empresa inteira (`organizations.status = 'redacted'`) os apaga, por três gatilhos
 * nossos. E a cópia do titular não os entregava: não havia leitura nenhuma deles para
 * a LGPD.
 *
 * A catraca do upstream (`lgpd-exporta-o-que-redige`) não viu, e não por descuido
 * dela: ela acha a limpeza pelo NOME da função (`redact|redigir|anonimiz|apagar`), e
 * os gatilhos do fork se chamam `fn_mia_*_empresa_redigida`. "Redigida" não casa com
 * "redigir". E ela confere a cópia do CONTATO; quem assina a MIA não é contato.
 *
 * ═══ Por que a lista é derivada ═══
 *
 * Pela mesma razão da catraca do upstream: uma lista escrita aqui envelheceria no
 * quarto gatilho. As duas pontas saem da fonte:
 *
 *   limpeza → toda função do `baseline-mia.sql` que reage à empresa redigida (o corpo
 *             testa `new.status = 'redacted'`) ou que diz isso no nome (`redigid`),
 *             pelos alvos de `delete from` e de `update ... set`
 *   cópia   → os `.from("<tabela>")` de `exportarDadosDeCobrancaDaEmpresa`, em
 *             `lib/lgpd/export-collector.ts`
 *
 * ═══ O que NÃO prova ═══
 *
 * Que o conteúdo baste: só que a tabela é visitada. O conteúdo (documento inteiro,
 * endereço, o final do cartão, e nada do Pix nem do boleto) é provado em
 * `tests/unit/lgpd-dados-de-cobranca-da-empresa.test.ts`.
 */

const RAIZ = path.resolve(__dirname, "../..");
const BASELINE_MIA = fs.readFileSync(path.join(RAIZ, "supabase/baseline-mia.sql"), "utf8");
const COLETOR = fs.readFileSync(path.join(RAIZ, "lib/lgpd/export-collector.ts"), "utf8");
const FUNCAO_DA_COPIA = "export async function exportarDadosDeCobrancaDaEmpresa";

/** Cada função do schema da MIA, com o nome e o corpo (até o `$$;` que a fecha). */
function funcoesDaMia(): Array<{ nome: string; corpo: string }> {
  const saida: Array<{ nome: string; corpo: string }> = [];
  for (const m of BASELINE_MIA.matchAll(/create or replace function\s+"?public"?\.\s*"?([a-z_0-9]+)"?/gi)) {
    const inicio = m.index ?? 0;
    const fim = BASELINE_MIA.indexOf("$;", inicio);
    saida.push({ nome: m[1] ?? "", corpo: BASELINE_MIA.slice(inicio, fim === -1 ? BASELINE_MIA.length : fim) });
  }
  return saida;
}

function limpezasDaEmpresaRedigida(): Array<{ nome: string; corpo: string }> {
  return funcoesDaMia().filter(
    (f) => /redigid/i.test(f.nome) || /\bnew\.status\s*=\s*'redacted'/i.test(f.corpo),
  );
}

/** As tabelas que a empresa redigida perde: `delete from <t>` ou `update <t> set`. */
function tabelasQueAEmpresaRedigidaPerde(): string[] {
  const alvos = new Set<string>();
  for (const f of limpezasDaEmpresaRedigida()) {
    for (const m of f.corpo.matchAll(
      /\b(?:update\s+(?:"?public"?\.)?"?([a-z_0-9]+)"?\s+set|delete\s+from\s+(?:"?public"?\.)?"?([a-z_0-9]+)"?)/gi,
    )) {
      const t = m[1] ?? m[2];
      if (t !== undefined) alvos.add(t);
    }
  }
  return [...alvos].sort();
}

/** As tabelas que a cópia dos dados de cobrança lê (só no corpo dela). */
function tabelasDaCopia(): string[] {
  const inicio = COLETOR.indexOf(FUNCAO_DA_COPIA);
  if (inicio === -1) return [];
  const proxima = COLETOR.indexOf("\nexport ", inicio + FUNCAO_DA_COPIA.length);
  const corpo = COLETOR.slice(inicio, proxima === -1 ? COLETOR.length : proxima);
  return [...new Set([...corpo.matchAll(/\.from\("([a-z_0-9]+)"\)/g)].map((m) => m[1] ?? ""))].sort();
}

describe("LGPD: a cópia dos dados de cobrança alcança tudo que a empresa redigida perde", () => {
  it("CONTROLE: a varredura acha os três gatilhos da .96 e as tabelas deles (senão mede o vazio)", () => {
    const nomes = limpezasDaEmpresaRedigida().map((f) => f.nome);
    expect(nomes).toEqual(
      expect.arrayContaining([
        "fn_mia_dados_fiscais_saem_com_a_empresa_redigida",
        "fn_mia_pagamento_inicial_sai_com_a_empresa_redigida",
        "fn_mia_cartao_das_mensalidades_sai_com_a_empresa_redigida",
      ]),
    );
    expect(tabelasQueAEmpresaRedigidaPerde()).toEqual(
      expect.arrayContaining(["mia_dados_fiscais", "mia_pagamento_inicial", "mia_cartao_das_mensalidades"]),
    );
  });

  it("CONTROLE: a cópia existe e a varredura dela acha leitura", () => {
    expect(COLETOR, `\`${FUNCAO_DA_COPIA}\` sumiu de lib/lgpd/export-collector.ts`).toContain(FUNCAO_DA_COPIA);
    expect(tabelasDaCopia()).toContain("mia_dados_fiscais");
  });

  it("⭐ toda tabela que a empresa redigida perde é lida pela cópia dos dados de cobrança", () => {
    const lidas = new Set(tabelasDaCopia());
    const faltando = tabelasQueAEmpresaRedigidaPerde().filter((t) => !lidas.has(t));
    expect(
      faltando,
      "Estas tabelas são apagadas quando a empresa é redigida (a anonimização da empresa " +
        "inteira) e NÃO são lidas quando o titular pede a cópia dos dados dele. O que se " +
        "apaga a pedido dele é o que se entrega a pedido dele: acrescente a leitura em " +
        "`exportarDadosDeCobrancaDaEmpresa` (lib/lgpd/export-collector.ts):\n" +
        faltando.map((t) => `  ${t}`).join("\n"),
    ).toEqual([]);
  });
});
