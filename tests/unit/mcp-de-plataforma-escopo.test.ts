/**
 * O ESCOPO DO TOKEN DE PLATAFORMA — a peça que decide o tamanho do estrago.
 *
 * ── Por que este arquivo é o mais importante do item E6 ───────────────────
 *
 * O MCP de organização erra DENTRO de um cliente: o token carrega um
 * `organizationId`, e a RLS está embaixo como última linha. O de plataforma não
 * tem organização e não tem RLS — o `service_role` atravessa tudo. A única
 * coisa entre um token vazado e a instalação inteira é a lista branca.
 *
 * Então ela é medida aqui, caso a caso, inclusive nos "não" que parecem óbvios
 * — principalmente neles, porque são os que alguém remove por engano achando
 * que são redundantes.
 */
import { describe, expect, it } from "vitest";

import {
  CHAVES_DE_OPERACAO,
  OPERACOES,
  operacaoPorChave,
  podeExecutar,
} from "@/lib/mcp-plataforma/operacoes";
import { FERRAMENTAS } from "@/lib/mcp-plataforma/ferramentas";
import { extrairBearer, hashDoToken, PREFIXO_DE_PLATAFORMA } from "@/lib/mcp-plataforma/auth";

describe("a lista branca de operações", () => {
  it("token sem operação nenhuma NÃO escreve nada", () => {
    // O default da coluna é `'{}'`. Um token criado sem pensar tem de ser
    // inofensivo — é a propriedade que torna a tela de criação segura mesmo
    // quando quem a usa está com pressa.
    for (const chave of CHAVES_DE_OPERACAO) {
      expect(podeExecutar([], chave), `token vazio executou ${chave}`).toBe(false);
    }
  });

  it("token com uma operação executa SÓ aquela", () => {
    const outras = CHAVES_DE_OPERACAO.filter((c) => c !== "liberar_modulo");
    expect(podeExecutar(["liberar_modulo"], "liberar_modulo")).toBe(true);
    for (const chave of outras) {
      expect(
        podeExecutar(["liberar_modulo"], chave),
        `quem pode liberar módulo executou ${chave}`,
      ).toBe(false);
    }
  });

  it("NÃO existe curinga — nem `*`, nem `all`, nem `admin`", () => {
    // Um caso especial de "tudo" seria o atalho que todo mundo usa no primeiro
    // token, e a partir dele a lista deixaria de significar coisa alguma.
    for (const curinga of ["*", "all", "admin", "full", "tudo"]) {
      for (const chave of CHAVES_DE_OPERACAO) {
        expect(
          podeExecutar([curinga], chave),
          `"${curinga}" funcionou como curinga para ${chave}`,
        ).toBe(false);
      }
    }
  });

  it("operação que o código não reconhece mais NÃO herda permissão", () => {
    // Um token gravado com uma chave renomeada ou removida não pode passar a
    // valer por dúvida: o silêncio tem de ser "não".
    expect(podeExecutar(["operacao_que_nao_existe"], "operacao_que_nao_existe")).toBe(false);
  });

  it("toda operação declara o RAIO, e o raio fala do estrago", () => {
    // O texto é lido por quem marca a caixinha. "Cria uma organização" descreve
    // a funcionalidade e não responde "e se este token vazar?".
    for (const op of OPERACOES) {
      expect(op.raio.length, `${op.chave} sem raio escrito`).toBeGreaterThan(40);
      expect(op.rotulo.length).toBeGreaterThan(3);
    }
  });
});

describe("as ferramentas e o escopo que cada uma exige", () => {
  it("toda ferramenta de ESCRITA nomeia uma operação que existe", () => {
    // Uma ferramenta apontando para uma chave inexistente seria recusada para
    // sempre — e o sintoma ("peça a operação X a um admin") mandaria alguém
    // procurar uma caixinha que não está na tela.
    const orfas = FERRAMENTAS.filter(
      (f) => f.operacao !== null && operacaoPorChave(f.operacao) === null,
    ).map((f) => f.name);
    expect(orfas, "ferramenta exigindo operação que não existe no catálogo").toEqual([]);
  });

  it("toda operação declarada é exigida por alguma ferramenta", () => {
    // O inverso: uma operação sem ferramenta é uma caixinha na tela que não
    // destrava nada — e quem a marca acha que concedeu algo.
    const usadas = new Set(FERRAMENTAS.map((f) => f.operacao).filter(Boolean));
    const semUso = CHAVES_DE_OPERACAO.filter((c) => !usadas.has(c));
    expect(semUso, "operação oferecida na tela que nenhuma ferramenta usa").toEqual([]);
  });

  it("nenhuma ferramenta de LEITURA escreve, pelo nome", () => {
    // Heurística, e de propósito: `operacao: null` é a decisão, e um verbo de
    // escrita no nome de uma ferramenta livre é o sinal de que alguém a
    // classificou errado.
    const suspeitas = FERRAMENTAS.filter((f) => f.operacao === null)
      .filter((f) => /criar|lancar|liberar|definir|apagar|remover|convidar/.test(f.name))
      .map((f) => f.name);
    expect(suspeitas, "ferramenta com nome de escrita passando como leitura livre").toEqual([]);
  });

  it("os nomes são únicos e carregam o prefixo da plataforma", () => {
    const nomes = FERRAMENTAS.map((f) => f.name);
    expect(new Set(nomes).size, "nome de ferramenta repetido").toBe(nomes.length);
    for (const n of nomes) {
      expect(n.startsWith("plataforma_"), `${n} sem o prefixo plataforma_`).toBe(true);
    }
  });
});

describe("o bearer de plataforma", () => {
  it("é um prefixo DIFERENTE do token de organização", () => {
    // Token de cliente colado aqui (ou o contrário) é recusado pela FORMA,
    // antes de qualquer consulta — e a mensagem diz qual é a porta certa.
    expect(PREFIXO_DE_PLATAFORMA).toBe("dskp_");
    expect(PREFIXO_DE_PLATAFORMA.startsWith("dsk_")).toBe(false);
  });

  it("extrai o token do cabeçalho, e recusa o que não é Bearer", () => {
    expect(extrairBearer("Bearer dskp_abc")).toBe("dskp_abc");
    expect(extrairBearer("bearer  dskp_abc  ")).toBe("dskp_abc");
    expect(extrairBearer(null)).toBeNull();
    expect(extrairBearer("Basic dskp_abc")).toBeNull();
    expect(extrairBearer("dskp_abc")).toBeNull();
  });

  it("o hash é hexadecimal com o prefixo que o Postgres espera para bytea", () => {
    const h = hashDoToken("dskp_exemplo");
    expect(h.startsWith("\\x")).toBe(true);
    // SHA-256 = 32 bytes = 64 caracteres hex, mais os dois do `\x`.
    expect(h).toHaveLength(66);
    expect(h.slice(2)).toMatch(/^[0-9a-f]+$/);
  });

  it("o hash é estável e não devolve o plaintext", () => {
    const h = hashDoToken("dskp_segredo");
    expect(hashDoToken("dskp_segredo")).toBe(h);
    expect(h).not.toContain("segredo");
    expect(hashDoToken("dskp_segred0")).not.toBe(h);
  });
});
