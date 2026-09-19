import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * O QUE SE APAGA A PEDIDO DO TITULAR É O QUE SE ENTREGA A PEDIDO DELE.
 *
 * ═══ O defeito que este arquivo fecha ═══
 *
 * A migration 0184 declarou `calendar_appointments` dado pessoal e ligou o
 * trigger de REDAÇÃO. A mesma entrega escreveu
 * `tests/invariants/agenda-lgpd-alcanca.test.ts` — quatro casos, com controle
 * positivo — para provar que a redação alcança a tabela.
 *
 * E ninguém acrescentou a agenda ao EXPORT. O titular exercia o Art. 18 II e
 * recebia um relatório que não mencionava nenhuma consulta que ele marcou.
 *
 * A entrega construiu o gate de UMA metade da LGPD e nenhum da outra. Não foi
 * descuido de quem escreveu: `lib/lgpd/export-collector.ts` não tem lista
 * declarada em lugar nenhum — os blocos são escritos à mão, um a um, e
 * `workers/lgpd-export-worker.ts` se autodescreve como "8-table aggregator"
 * com contagem FIXA no comentário. Tabela nova simplesmente não aparece.
 *
 * ═══ Por que a lista é DERIVADA, e não escrita aqui ═══
 *
 * Uma lista fixa neste arquivo reproduziria o defeito num arquivo a mais: a
 * oitava tabela redigida entraria sem ninguém acrescentá-la aqui, e o teste
 * ficaria verde por não medir. As duas pontas saem da fonte:
 *
 *   redação → toda função do baseline cujo nome case /redact|redigir/, pelos
 *             alvos de `update <tabela> set` no corpo dela
 *   export  → os `.from("<tabela>")` de `lib/lgpd/export-collector.ts`
 *
 * ═══ O que este teste NÃO prova ═══
 *
 * Que o conteúdo exportado seja suficiente — só que a tabela é VISITADA.
 * E não olha o PDF: `activities` está no payload e não no relatório, o que é
 * legítimo (o worker sobe `data.json` E `report.pdf`, e o JSON leva tudo).
 */

const RAIZ = path.resolve(__dirname, "../..");
const BASELINE = fs.readFileSync(path.join(RAIZ, "supabase/baseline.sql"), "utf8");
const COLETOR = fs.readFileSync(path.join(RAIZ, "lib/lgpd/export-collector.ts"), "utf8");

/** Corpos de função cujo NOME anuncia redação — no dump vêm com identificador entre aspas. */
function corposDeRedacao(): string[] {
  const corpos: string[] = [];
  const abre =
    /create or replace function\s+"?public"?\.\s*"?([a-z_]*(?:redact|redigir)[a-z_]*)"?/gi;
  for (const m of BASELINE.matchAll(abre)) {
    const inicio = m.index ?? 0;
    // O corpo termina no primeiro `$$;` depois da abertura. Os dumps deste repo
    // usam `$$` e `$pub$`; ambos fecham com `$;`.
    const fim = BASELINE.indexOf("$;", inicio);
    corpos.push(BASELINE.slice(inicio, fim === -1 ? BASELINE.length : fim));
  }
  return corpos;
}

function tabelasRedigidas(): string[] {
  const alvos = new Set<string>();
  for (const corpo of corposDeRedacao()) {
    for (const m of corpo.matchAll(/\bupdate\s+(?:"?public"?\.)?"?([a-z_]+)"?\s+set\b/gi)) {
      const t = m[1];
      if (t !== undefined) alvos.add(t);
    }
  }
  return [...alvos].sort();
}

function tabelasExportadas(): string[] {
  return [...COLETOR.matchAll(/\.from\("([a-z_]+)"\)/g)]
    .map((m) => m[1])
    .filter((t): t is string => t !== undefined)
    .sort();
}

describe("LGPD: o export alcança tudo que a redação alcança", () => {
  it("CONTROLE: as duas varreduras acham tabela (senão o teste passa medindo o vazio)", () => {
    // Sem isto, um regex que deixe de casar devolve dois conjuntos vazios e a
    // asserção abaixo fica verde — o modo de falha que este repo já pagou várias
    // vezes. E o número tem de ser plausível: a redação move mais que 3 tabelas.
    expect(tabelasRedigidas().length).toBeGreaterThan(3);
    expect(tabelasExportadas().length).toBeGreaterThan(3);
  });

  it("CONTROLE: a varredura da redação enxerga a tabela que o trigger 0184 acrescentou", () => {
    // `calendar_appointments` não é redigida pelo cascade e sim por um trigger
    // separado (0184). Se a sonda só olhasse a função principal, ela sumiria — e
    // o teste passaria justamente sobre o caso que o motivou.
    expect(tabelasRedigidas()).toContain("calendar_appointments");
  });

  it("toda tabela que a redação apaga é visitada pelo export", () => {
    const exportadas = new Set(tabelasExportadas());
    const faltando = tabelasRedigidas().filter((t) => !exportadas.has(t));
    expect(
      faltando,
      "Estas tabelas são redigidas quando o titular pede anonimização e NÃO são " +
        "coletadas quando ele pede acesso (Art. 18 II). O que se apaga a pedido " +
        "dele é o que se entrega a pedido dele — acrescente o bloco em " +
        "`lib/lgpd/export-collector.ts`, espelhando o de `crm_lead_activities`:\n" +
        faltando.map((f) => `  ${f}`).join("\n"),
    ).toEqual([]);
  });
});

/**
 * ─── A DIREÇÃO QUE FALTAVA: quem TEM `contact_id` e ninguém redige ─────────
 *
 * O bloco acima mede redigido → exportado. Ele nunca perguntou o contrário: uma
 * tabela que guarda `contact_id` e que NENHUM caminho de anonimização alcança
 * não aparece em nenhuma das duas varreduras, e some das duas.
 *
 * Varrendo à mão em 19/09/2026, três estavam assim, todas com dado pessoal:
 *
 *   ai_agent_runs         `tool_calls` guarda os `args` de cada ferramenta, o
 *                         `result` de cada uma e até 4.000 caracteres da prosa
 *                         do modelo. Uma chamada de `crm_propose_contact_field`
 *                         grava `{campo:"email", valor:"joao@x.com"}` literal.
 *   demandas              `assunto` e `proximo_passo`: texto livre, escrito por
 *                         humano, sobre o problema de uma pessoa identificada.
 *   broadcast_recipients  `phone_e164`, COPIADO de propósito — e no WhatsApp o
 *                         telefone não é só identificador, é o endereço.
 *
 * Corrigidas pela migration 0266. Este bloco existe para que a quarta não
 * precise de outra varredura manual.
 */
describe("LGPD: nenhuma tabela com contact_id fica fora da anonimização", () => {
  /**
   * Tabelas que guardam `contact_id` e que NÃO devem ser redigidas.
   *
   * Cada uma custa uma frase. A lista é curta de propósito: ela é a única porta
   * de saída deste gate, e uma porta de saída sem motivo escrito é como a
   * primeira lista à mão começou.
   *
   * `contacts` não entra aqui: a tabela do titular tem `id`, não `contact_id`,
   * então nunca aparece nesta varredura. Ela é medida coluna a coluna por
   * `tests/unit/lgpd-as-duas-pontas.test.ts`.
   */
  const NAO_SE_REDIGE: Record<string, string> = {
    lgpd_requests:
      "É o REGISTRO do pedido — a prova de que o direito foi exercido, e o que " +
      "responde ao prazo legal. Apagá-la apagaria o recibo da própria exclusão.",
  };

  /** Tabelas do baseline que têm uma coluna `contact_id`. */
  function tabelasComContactId(): string[] {
    const alvos = new Set<string>();

    for (const m of BASELINE.matchAll(
      /CREATE TABLE IF NOT EXISTS "public"\."([a-z_]+)" \(([\s\S]*?)\n\);/g,
    )) {
      if (m[1] && m[2] && /"contact_id"/.test(m[2])) alvos.add(m[1]);
    }
    for (const m of BASELINE.matchAll(
      /create table if not exists public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/gi,
    )) {
      if (m[1] && m[2] && /\bcontact_id\b/.test(m[2])) alvos.add(m[1]);
    }
    for (const m of BASELINE.matchAll(
      /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?public\.([a-z_]+)\b([\s\S]*?);/gi,
    )) {
      if (
        m[1] &&
        m[2] &&
        /add\s+column\s+(?:if\s+not\s+exists\s+)?contact_id\b/i.test(m[2])
      ) {
        alvos.add(m[1]);
      }
    }

    return [...alvos].sort();
  }

  /**
   * Tudo que QUALQUER caminho de anonimização escreve.
   *
   * Mais largo que `tabelasRedigidas()` de propósito: aquele deriva do NOME da
   * função (`redact`/`redigir`), e há funções legítimas que não seguem o padrão
   * — `fn_apaga_propostas_de_contato_anonimizado` é uma. Aqui a fonte é o
   * GATILHO: toda função pendurada em `is_anonymized` de `contacts`, venha o
   * nome que vier, mais as duas funções de anonimização e o TypeScript.
   */
  function tabelasAlcancadas(): Set<string> {
    const alvos = new Set<string>();

    const corpoDe = (nome: string): string => {
      const i = Math.max(
        BASELINE.lastIndexOf(`create or replace function public.${nome}(`),
        BASELINE.lastIndexOf(`CREATE OR REPLACE FUNCTION "public"."${nome}"`),
      );
      if (i < 0) return "";
      const fim = BASELINE.indexOf("$;", i);
      return fim < 0 ? "" : BASELINE.slice(i, fim);
    };

    const colher = (corpo: string) => {
      for (const u of corpo.matchAll(
        /(?:update|delete\s+from)\s+(?:public\.)?"?([a-z_]+)"?/gi,
      )) {
        if (u[1]) alvos.add(u[1]);
      }
    };

    for (const m of BASELINE.matchAll(
      /create trigger\s+[a-z_]+[\s\S]{0,200}?on public\.contacts[\s\S]{0,300}?execute function public\.([a-z_]+)\(\)/gi,
    )) {
      if (m[1]) colher(corpoDe(m[1]));
    }
    colher(corpoDe("fn_lgpd_cascade_redact_contact"));
    colher(corpoDe("fn_lgpd_anonymize_contact"));

    for (const arq of ["lib/lgpd/redact-cascade.ts", "lib/lgpd/cascata.ts"]) {
      const caminho = path.join(RAIZ, arq);
      if (!fs.existsSync(caminho)) continue;
      const src = fs.readFileSync(caminho, "utf8");
      for (const m of src.matchAll(/\.from\("([a-z_]+)"\)/g)) {
        if (m[1]) alvos.add(m[1]);
      }
    }

    return alvos;
  }

  it("CONTROLE: a varredura acha tabela com contact_id, e acha caminho", () => {
    // O modo de falha caro: um regex que deixa de casar devolve conjunto vazio,
    // a subtração dá vazio, e o gate fica verde exatamente quando parou de medir.
    expect(tabelasComContactId().length).toBeGreaterThan(10);
    expect(tabelasAlcancadas().size).toBeGreaterThan(8);
  });

  it("CONTROLE: enxerga as três que a 0266 acrescentou", () => {
    // Se a sonda deixar de ver o gatilho da 0266, estas três voltam a aparecer
    // como descobertas — e a mensagem mandaria alguém consertar o que já está
    // consertado. É o controle positivo do controle positivo.
    const alcancadas = tabelasAlcancadas();
    for (const t of ["ai_agent_runs", "demandas", "broadcast_recipients"]) {
      expect(alcancadas.has(t), `a sonda perdeu \`${t}\``).toBe(true);
    }
  });

  it("toda tabela com contact_id é redigida — ou tem exceção com motivo", () => {
    const alcancadas = tabelasAlcancadas();
    const descobertas = tabelasComContactId().filter(
      (t) => !alcancadas.has(t) && !NAO_SE_REDIGE[t],
    );
    expect(
      descobertas,
      "Estas tabelas guardam `contact_id` e NENHUM caminho de anonimização as " +
        "alcança: a pessoa pede para ser esquecida e o dado fica. Pendure um " +
        "`update` no gatilho `trg_redigir_o_que_sobrou_ao_anonimizar` (é onde " +
        "moram as três da 0266) — ou declare a exceção em `NAO_SE_REDIGE` com " +
        "o motivo por escrito:\n" +
        descobertas.map((d) => `  ${d}`).join("\n"),
    ).toEqual([]);
  });

  it("a lista de exceções não descreve tabela que não existe", () => {
    const comContato = new Set(tabelasComContactId());
    const fantasmas = Object.keys(NAO_SE_REDIGE)
      .filter((t) => !comContato.has(t))
      .sort();
    expect(fantasmas, "exceção declarada para tabela sem `contact_id`").toEqual([]);
  });
});
