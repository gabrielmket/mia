/**
 * As DUAS pontas da LGPD sobre `contacts`, conferidas juntas.
 *
 * ── Por que este teste existe ──────────────────────────────────────────────
 *
 * `contacts.custom_fields` — o jsonb LIVRE, onde o operador escreve o que a
 * ficha não previu ("CPF do responsável", "endereço da obra", "nome da esposa")
 * — falhava nas duas ao mesmo tempo, e por anos:
 *
 *   · ACESSO: estava no `select` de `lib/lgpd/export-collector.ts` e era
 *     DESCARTADO no mapeamento. Selecionado por alguém que sabia ser dado
 *     pessoal, e perdido antes de chegar ao relatório do titular.
 *   · ESQUECIMENTO: `fn_lgpd_cascade_redact_contact` zerava nome, e-mail,
 *     telefone, CPF, consentimento, `source_metadata` e tags — e não tocava
 *     nele.
 *
 * Quem pedia acesso não via o campo; quem pedia exclusão ficava com ele no
 * banco. O mesmo silêncio servindo aos dois lados, e nenhuma das pontas
 * reclamando da outra. Corrigido na migration 0264.
 *
 * O defeito não foi descuido de uma pessoa: são TRÊS listas escritas à mão em
 * arquivos diferentes (o `create table`, o `select` do exportador, o `update`
 * da função) e nada as obrigava a concordar. `cargo`, `setor` e `empresa_id`
 * repetiram o passo semanas depois — a prova de que a armadilha continuava
 * armada.
 *
 * ── O que este teste faz ───────────────────────────────────────────────────
 *
 * Lê as colunas REAIS de `contacts` do baseline e exige que cada uma esteja
 * classificada na tabela abaixo. Coluna nova quebra o teste com o nome dela na
 * mensagem — a pergunta "isto é dado pessoal?" passa a ser obrigatória e
 * respondida POR ESCRITO, no momento em que a coluna nasce, que é o único
 * momento em que alguém ainda sabe a resposta.
 *
 * O teste NÃO tenta adivinhar se uma coluna é pessoal. Adivinhar erraria, e
 * erraria para o lado de deixar passar. Ele força a declaração e depois cobra
 * a coerência dela.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../..");
const BASELINE = fs.readFileSync(path.join(RAIZ, "supabase/baseline.sql"), "utf8");
const EXPORTADOR = fs.readFileSync(
  path.join(RAIZ, "lib/lgpd/export-collector.ts"),
  "utf8",
);

type Classificacao =
  /** Dado pessoal: tem de sair no relatório de acesso E ser apagado na exclusão. */
  | { tipo: "pessoal"; exportadaComo?: string }
  /** `generated always as`: limpa sozinha quando a coluna de origem é limpa. */
  | { tipo: "derivada"; de: string[] }
  /** Pessoal, mas quem apaga é o TypeScript (storage, não só a linha). */
  | { tipo: "pessoal_fora_do_sql"; onde: string }
  /** Não é sobre a pessoa. O `porque` é a parte que importa. */
  | { tipo: "nao_pessoal"; porque: string };

/**
 * A resposta escrita para cada coluna de `contacts`.
 *
 * Mexer aqui é mexer na política de privacidade do produto. Uma coluna que
 * chega sem classificação não passa; uma classificada errado passa, e é por
 * isso que o `porque` de cada `nao_pessoal` tem de ser uma frase que alguém
 * possa contestar — não "não é pessoal".
 */
const CLASSIFICACAO: Record<string, Classificacao> = {
  // ── identificam a pessoa, direta ou indiretamente ────────────────────────
  name: { tipo: "pessoal" },
  display_name: { tipo: "pessoal" },
  email: { tipo: "pessoal" },
  phone_number: { tipo: "pessoal" },
  cpf_encrypted: { tipo: "pessoal" },
  // O relatório mostra `cpf_present: true/false`, e o hash chega ao titular por
  // esse mesmo caminho. Devolver o hash em si não acrescenta nada a quem já sabe
  // o próprio CPF, e acrescentaria a quem interceptasse o relatório.
  cpf_hash: { tipo: "pessoal", exportadaComo: "cpf_encrypted" },
  birthdate: { tipo: "pessoal" },
  consent: { tipo: "pessoal" },
  tags: { tipo: "pessoal" },
  // jsonb livre: guarda `waha_lid`, origem, o que a ingestão trouxer.
  source_metadata: { tipo: "pessoal" },
  // O campo que originou este teste.
  custom_fields: { tipo: "pessoal" },
  // Dado pessoal profissional (migration 0262).
  cargo: { tipo: "pessoal" },
  setor: { tipo: "pessoal" },
  // Vai ao relatório pelo NOME da empresa: um uuid não responde "a que empresa
  // vocês me vincularam" a ninguém.
  empresa_id: { tipo: "pessoal", exportadaComo: "crm_empresas(nome)" },

  // ── derivadas: limpam-se sozinhas quando a origem é limpa ────────────────
  email_normalized: { tipo: "derivada", de: ["email"] },
  wa_identity: { tipo: "derivada", de: ["phone_number", "source_metadata"] },
  wa_lid: { tipo: "derivada", de: ["source_metadata"] },

  // ── pessoais que o SQL não alcança ───────────────────────────────────────
  // A FOTO. Apagar a linha não apaga o arquivo no storage, e é o TypeScript que
  // enfileira a remoção do objeto antes de zerar o caminho.
  avatar_storage_path: { tipo: "pessoal_fora_do_sql", onde: "lib/lgpd/redact-cascade.ts" },

  // ── não são sobre a pessoa ───────────────────────────────────────────────
  id: {
    tipo: "nao_pessoal",
    porque: "chave da linha; vai ao relatório para o titular poder citar o pedido",
  },
  organization_id: {
    tipo: "nao_pessoal",
    porque: "diz de que tenant é a linha, não quem é a pessoa",
  },
  is_blocked: {
    tipo: "nao_pessoal",
    porque:
      "fato do ATENDIMENTO, não da pessoa; vai ao relatório porque o titular tem direito de saber que foi bloqueado",
  },
  blocked_reason: {
    tipo: "nao_pessoal",
    porque:
      "único valor jamais escrito é 'stop_keyword' (lib/channels/pos-entrada.ts) — vocabulário de máquina, não texto de operador",
  },
  blocked_at: { tipo: "nao_pessoal", porque: "carimbo de tempo do bloqueio" },
  is_anonymized: {
    tipo: "nao_pessoal",
    porque: "é o RESULTADO da exclusão; apagá-lo apagaria a prova de que ela aconteceu",
  },
  anonymized_at: { tipo: "nao_pessoal", porque: "quando a exclusão foi executada" },
  is_merged_into: {
    tipo: "nao_pessoal",
    porque:
      "aponta para o contato vencedor de uma fusão — e fusão significa que os dois eram a MESMA pessoa",
  },
  merged_at: { tipo: "nao_pessoal", porque: "carimbo de tempo da fusão" },
  source: {
    tipo: "nao_pessoal",
    porque: "vocabulário fechado de origem do cadastro ('manual', 'webhook', …)",
  },
  created_at: { tipo: "nao_pessoal", porque: "carimbo de tempo da linha" },
  updated_at: { tipo: "nao_pessoal", porque: "carimbo de tempo da linha" },
  created_by_user_id: {
    tipo: "nao_pessoal",
    porque: "é o OPERADOR que cadastrou, não o titular — apagá-lo apagaria dado de outra pessoa",
  },
  last_activity_at: {
    tipo: "nao_pessoal",
    porque: "quando houve a última troca; sustenta a métrica sem dizer de quem",
  },
  force_human: {
    tipo: "nao_pessoal",
    porque: "trava operacional do atendimento (a IA não assume), não atributo da pessoa",
  },
  locale: {
    tipo: "nao_pessoal",
    porque: "idioma em que se responde; não identifica e o relatório não melhora com ele",
  },
  phone_lookup_at: {
    tipo: "nao_pessoal",
    porque: "quando o número foi consultado na operadora do canal",
  },
  ai_authorized_at: {
    tipo: "nao_pessoal",
    porque:
      "quando a IA passou a poder atender; sem ele não se audita por que um robô respondeu a esta pessoa",
  },
  ai_authorized_reason: {
    tipo: "nao_pessoal",
    porque:
      "união FECHADA em lib/ai/elegibilidade/autorizacao.ts ('respondi:<id>', 'campanha:<id>', 'automacao:<id>', 'retomada_manual') — os ids são de campanha e automação, não da pessoa",
  },
  avatar_updated_at: {
    tipo: "nao_pessoal",
    porque:
      "quando a foto foi buscada pela última vez; o arquivo e o caminho são apagados, e a data sozinha não mostra rosto nenhum",
  },
};

/** Nomes capturados pelo primeiro grupo de um regex, já sem os `undefined`. */
function capturas(texto: string, re: RegExp): string[] {
  return [...texto.matchAll(re)].map((m) => m[1]).filter((n): n is string => Boolean(n));
}

/** Colunas de `contacts` como o baseline as declara — criação e acréscimos. */
function colunasDeContacts(sql: string): Set<string> {
  const colunas = new Set<string>();

  const inicio = sql.indexOf('CREATE TABLE IF NOT EXISTS "public"."contacts" (');
  expect(inicio, "o `create table` de contacts sumiu do baseline").toBeGreaterThan(-1);
  const criacao = sql.slice(inicio, sql.indexOf("\n);", inicio));
  for (const nome of capturas(criacao, /^\s*"([a-z_]+)"\s/gm)) colunas.add(nome);

  const acrescimos = [
    ...capturas(sql, /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?public\.contacts\b([\s\S]*?);/gi),
    ...capturas(sql, /ALTER TABLE (?:ONLY )?"public"\."contacts"([\s\S]*?);/g),
  ];
  for (const bloco of acrescimos) {
    for (const nome of capturas(
      bloco,
      /add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_]+)"?/gi,
    )) {
      colunas.add(nome);
    }
  }

  return colunas;
}

/** O `update contacts set` da ÚLTIMA definição da função — a que vale. */
function colunasQueAAnonimizacaoLimpa(sql: string): Set<string> {
  const f = sql.lastIndexOf(
    'CREATE OR REPLACE FUNCTION "public"."fn_lgpd_cascade_redact_contact"',
  );
  expect(f, "a função de anonimização sumiu do baseline").toBeGreaterThan(-1);
  const corpo = sql.slice(f, sql.indexOf("\nend;\n$$;\n", f));
  const ini = corpo.indexOf("update contacts set");
  expect(ini, "o `update contacts set` sumiu da função").toBeGreaterThan(-1);
  const bloco = corpo.slice(ini, corpo.indexOf("  where id = p_contact_id", ini));

  return new Set(capturas(bloco, /^ {4}([a-z_]+)\s*=/gm));
}

/** A lista de colunas que o relatório de acesso pede ao banco. */
function selectDaExportacao(fonte: string): string {
  const m = fonte.match(/"id, name, display_name[^"]*"/);
  expect(m, "o `select` do exportador de contatos mudou de forma").not.toBeNull();
  return m![0];
}

const COLUNAS = colunasDeContacts(BASELINE);
const LIMPAS = colunasQueAAnonimizacaoLimpa(BASELINE);
const SELECT = selectDaExportacao(EXPORTADOR);

describe("LGPD: acesso e esquecimento conferidos na mesma leitura", () => {
  it("a leitura do schema não saiu vazia nem quase", () => {
    // Sem este caso, uma mudança de formatação no baseline faria os regex acharem
    // três colunas e TODOS os outros casos passariam calados — o modo de falha
    // mais perigoso de um teste que lê arquivo.
    expect(
      COLUNAS.size,
      "achei colunas de menos em `contacts` — o parser quebrou, não a tabela encolheu",
    ).toBeGreaterThan(30);
    expect(LIMPAS.size, "o `update contacts set` foi lido vazio").toBeGreaterThan(10);
    expect(SELECT.length, "o `select` do exportador foi lido curto demais").toBeGreaterThan(200);
  });

  it("toda coluna de contacts está classificada", () => {
    const semResposta = [...COLUNAS].filter((c) => !CLASSIFICACAO[c]).sort();
    expect(
      semResposta,
      "coluna nova em `contacts` sem resposta para 'isto é dado pessoal?'. " +
        "Classifique em tests/unit/lgpd-as-duas-pontas.test.ts: `pessoal` (sai no " +
        "relatório de acesso e é apagada na exclusão), `derivada`, " +
        "`pessoal_fora_do_sql` ou `nao_pessoal` com o motivo POR ESCRITO",
    ).toEqual([]);
  });

  it("a classificação não descreve colunas que não existem", () => {
    // Coluna removida e classificação esquecida vira documentação mentindo sobre
    // o schema — e a próxima pessoa a lê como verdade.
    const fantasmas = Object.keys(CLASSIFICACAO)
      .filter((c) => !COLUNAS.has(c))
      .sort();
    expect(fantasmas, "classificação de coluna que não existe mais em `contacts`").toEqual([]);
  });

  it("todo dado pessoal é APAGADO pela anonimização", () => {
    const sobrevivem = [...COLUNAS]
      .filter((c) => CLASSIFICACAO[c]?.tipo === "pessoal" && !LIMPAS.has(c))
      .sort();
    expect(
      sobrevivem,
      "coluna declarada pessoal que `fn_lgpd_cascade_redact_contact` não toca: " +
        "o titular pediu para ser esquecido e o dado ficou no banco",
    ).toEqual([]);
  });

  it("todo dado pessoal CHEGA ao titular que pede acesso", () => {
    const invisiveis = [...COLUNAS]
      .filter((c) => {
        const cl = CLASSIFICACAO[c];
        if (cl?.tipo !== "pessoal") return false;
        return !SELECT.includes(cl.exportadaComo ?? c);
      })
      .sort();
    expect(
      invisiveis,
      "coluna declarada pessoal fora do `select` de lib/lgpd/export-collector.ts: " +
        "o relatório responde 'é tudo que temos sobre você' e a resposta é falsa",
    ).toEqual([]);
  });

  it("dado pessoal que sai no select também sai no objeto entregue", () => {
    // O defeito exato do `custom_fields`: selecionado e descartado no mapeamento.
    // O `select` custava a leitura no banco e o campo não chegava a lugar nenhum.
    const snapshot = EXPORTADOR.slice(
      EXPORTADOR.indexOf("export interface ContactSnapshot {"),
      EXPORTADOR.indexOf("}", EXPORTADOR.indexOf("export interface ContactSnapshot {")),
    );
    const perdidas = [...COLUNAS]
      .filter((c) => {
        const cl = CLASSIFICACAO[c];
        if (cl?.tipo !== "pessoal") return false;
        // `cpf_encrypted`/`cpf_hash` viram `cpf_present`; `empresa_id` vira
        // `empresa_nome`. O nome no relatório não precisa ser o nome da coluna.
        if (c.startsWith("cpf_")) return !snapshot.includes("cpf_present");
        if (c === "empresa_id") return !snapshot.includes("empresa_nome");
        return !snapshot.includes(`${c}:`);
      })
      .sort();
    expect(
      perdidas,
      "coluna pessoal pedida ao banco e ausente do `ContactSnapshot`: " +
        "paga-se a leitura e o titular não recebe o campo",
    ).toEqual([]);
  });

  it("coluna derivada é mesmo gerada, e a origem dela é apagada", () => {
    for (const [coluna, cl] of Object.entries(CLASSIFICACAO)) {
      if (cl.tipo !== "derivada") continue;
      expect(
        BASELINE.includes(`add column if not exists ${coluna} text\n  generated always as`) ||
          BASELINE.includes(`"${coluna}" "text" GENERATED ALWAYS AS`),
        `\`${coluna}\` foi classificada como derivada mas não é \`generated always as\` — ` +
          "se virou coluna comum, passou a guardar dado que ninguém apaga",
      ).toBe(true);

      for (const origem of cl.de) {
        expect(
          LIMPAS.has(origem),
          `\`${coluna}\` deriva de \`${origem}\`, e \`${origem}\` não é apagada — ` +
            "então a derivada sobrevive junto, que é o mesmo dado por outro nome",
        ).toBe(true);
      }
    }
  });

  it("pessoal fora do SQL é apagada no arquivo que a classificação aponta", () => {
    for (const [coluna, cl] of Object.entries(CLASSIFICACAO)) {
      if (cl.tipo !== "pessoal_fora_do_sql") continue;
      const fonte = fs.readFileSync(path.join(RAIZ, cl.onde), "utf8");
      expect(
        fonte.includes(coluna),
        `\`${coluna}\` diz ser apagada em ${cl.onde}, e o arquivo não menciona a coluna`,
      ).toBe(true);
    }
  });

  it("todo `nao_pessoal` tem um motivo contestável, não um rótulo", () => {
    const fracos = Object.entries(CLASSIFICACAO)
      .filter(([, cl]) => cl.tipo === "nao_pessoal" && cl.porque.trim().length < 25)
      .map(([c]) => c)
      .sort();
    expect(
      fracos,
      "motivo curto demais para alguém discordar dele — 'não é pessoal' não é motivo",
    ).toEqual([]);
  });
});
