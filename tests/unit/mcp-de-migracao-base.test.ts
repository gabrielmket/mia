/**
 * O MCP DE MIGRAÇÃO no catálogo do MCP de plataforma: os três pontos de
 * encaixe, as duas operações, as descrições e as peças de base.
 *
 * Este arquivo é a catraca do ENCAIXE: se a junção com as ferramentas de
 * implantação perder a linha que liga a importação ao catálogo, ou a que tira
 * a lista de pessoas da auditoria, é aqui que fica vermelho.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { canalDoNegocio } from "@/lib/cartoes/canal";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { FERRAMENTAS, FERRAMENTA_POR_NOME } from "@/lib/mcp-plataforma/ferramentas";
import {
  AREAS_DE_IMPORTACAO,
  FERRAMENTAS_DE_IMPORTACAO,
  OPERACOES_DE_IMPORTACAO,
  argumentosParaAuditoria,
} from "@/lib/mcp-plataforma/importacao";
import { redigirLote } from "@/lib/mcp-plataforma/importacao/auditoria";
import {
  Coletor,
  NADA_FOI_ENVIADO,
  PREFIXO_DA_ORIGEM,
  dataDeOrigem,
  explicarProblemaDoSchema,
  lerEmPaginas,
  origemDaImportacao,
  sourceDaImportacao,
} from "@/lib/mcp-plataforma/importacao/base";
import { EXEMPLO_DE_CONTATO, lerContato } from "@/lib/mcp-plataforma/importacao/contatos";
import { EXEMPLO_DE_EMPRESA } from "@/lib/mcp-plataforma/importacao/empresas";
import { EXEMPLO_DE_NEGOCIO, lerNegocio } from "@/lib/mcp-plataforma/importacao/negocios";
import type { FerramentaDeImportacao } from "@/lib/mcp-plataforma/importacao/tipos";
import { CHAVES_DE_OPERACAO, OPERACOES, operacaoPorChave, podeExecutar } from "@/lib/mcp-plataforma/operacoes";
import { empresaCreateSchema } from "@/lib/schemas/empresas";

const ler = (caminho: string) => readFileSync(join(process.cwd(), caminho), "utf8");

const NOMES = [
  "plataforma_ver_importacao",
  "plataforma_importar_empresas",
  "plataforma_importar_contatos",
  "plataforma_importar_negocios",
  "plataforma_importar_conhecimento",
  "plataforma_importar_fotos_de_produto",
  "plataforma_importar_modelo_de_proposta",
];

describe("os três pontos de encaixe", () => {
  it("as sete ferramentas de importação estão no catálogo do MCP de plataforma, com estes nomes", () => {
    expect(FERRAMENTAS_DE_IMPORTACAO.map((f) => f.name)).toEqual(NOMES);
    for (const nome of NOMES) {
      expect(FERRAMENTA_POR_NOME.get(nome), `${nome} não está em FERRAMENTAS`).toBeDefined();
    }
    // Nome único no catálogo inteiro, e não só entre as de importação.
    const todos = FERRAMENTAS.map((f) => f.name);
    expect(new Set(todos).size).toBe(todos.length);
  });

  it("o catálogo e as operações ligam a importação por UMA linha cada", () => {
    const ferramentas = ler("lib/mcp-plataforma/ferramentas.ts");
    const operacoes = ler("lib/mcp-plataforma/operacoes.ts");
    expect(ferramentas.match(/\.\.\.FERRAMENTAS_DE_IMPORTACAO/g)).toHaveLength(1);
    expect(operacoes.match(/\.\.\.OPERACOES_DE_IMPORTACAO/g)).toHaveLength(1);
  });

  it("as duas operações aparecem na tela dos tokens, porque ela lista a partir de OPERACOES", () => {
    for (const op of OPERACOES_DE_IMPORTACAO) {
      expect(OPERACOES.some((o) => o.chave === op.chave), `${op.chave} não está em OPERACOES`).toBe(true);
      expect(CHAVES_DE_OPERACAO).toContain(op.chave);
    }
    // A tela não tem lista própria: se passasse a ter, as duas sumiriam dela em silêncio.
    const tela = ler("app/admin/(protected)/tokens-de-plataforma/page.tsx");
    expect(tela).toContain("operacoes={OPERACOES.map(");
    // E a emissão do token valida contra a mesma lista.
    expect(ler("app/actions/plataforma/tokens.ts")).toContain("CHAVES_DE_OPERACAO.includes(o)");
  });

  it("as áreas para o checklist da implantação saem da mesma pasta", () => {
    expect(AREAS_DE_IMPORTACAO.length).toBe(6);
    for (const area of AREAS_DE_IMPORTACAO) expect(typeof area.situacao).toBe("function");
  });

  it("o servidor grava os argumentos REDIGIDOS, nunca os crus", () => {
    const servidor = ler("lib/mcp-plataforma/servidor.ts");
    expect(servidor, "o servidor deixou de redigir os argumentos das ferramentas de importação").toContain(
      "argumentos: argumentosParaAuditoria(ferramenta, args)",
    );
    expect(servidor).not.toMatch(/argumentos:\s*args\s*,/);
  });

  it("a ação de auditoria da importação existe no vocabulário", () => {
    expect(AUDIT_ACTIONS as readonly string[]).toContain("plataforma.importacao");
  });
});

describe("as duas operações: importar base e importar materiais", () => {
  it("importar_base cobre contatos, empresas e negócios; importar_materiais cobre os materiais; ver é leitura", () => {
    const operacaoDe = Object.fromEntries(FERRAMENTAS_DE_IMPORTACAO.map((f) => [f.name, f.operacao]));
    expect(operacaoDe).toEqual({
      plataforma_ver_importacao: null,
      plataforma_importar_empresas: "importar_base",
      plataforma_importar_contatos: "importar_base",
      plataforma_importar_negocios: "importar_base",
      plataforma_importar_conhecimento: "importar_materiais",
      plataforma_importar_fotos_de_produto: "importar_materiais",
      plataforma_importar_modelo_de_proposta: "importar_materiais",
    });
  });

  it("quem tem uma não executa a outra, e token sem operação não importa nada", () => {
    expect(podeExecutar(["importar_base"], "importar_base")).toBe(true);
    expect(podeExecutar(["importar_base"], "importar_materiais")).toBe(false);
    expect(podeExecutar(["importar_materiais"], "importar_base")).toBe(false);
    expect(podeExecutar([], "importar_base")).toBe(false);
    expect(podeExecutar(["criar_cliente", "lancar_credito"], "importar_base")).toBe(false);
  });

  it("o raio de cada uma fala do ESTRAGO, para quem marca a caixinha", () => {
    const base = operacaoPorChave("importar_base")!;
    const materiais = operacaoPorChave("importar_materiais")!;
    expect(base.raio).toMatch(/QUALQUER cliente/);
    expect(base.raio).toMatch(/mistura\s+pessoas/);
    expect(base.raio).toMatch(/desfazer/);
    expect(materiais.raio).toMatch(/agente de IA/);
    expect(materiais.raio).toMatch(/crédito de IA/);
    for (const op of [base, materiais]) expect(op.raio.length).toBeGreaterThan(120);
  });
});

describe("as descrições são escritas para um modelo que nunca viu o sistema", () => {
  const escritas = FERRAMENTAS_DE_IMPORTACAO.filter((f) => f.operacao !== null);

  it("toda escrita diz o que NÃO faz, e que nada é enviado", () => {
    for (const f of escritas) {
      expect(f.description, `${f.name} não diz o que NÃO faz`).toContain("O que NÃO faz");
      expect(f.description, `${f.name} não diz que não envia`).toMatch(/não envia/i);
    }
  });

  it("as três da base dizem a ordem da migração e o teto por chamada", () => {
    for (const nome of ["plataforma_importar_empresas", "plataforma_importar_contatos", "plataforma_importar_negocios"]) {
      const d = FERRAMENTA_POR_NOME.get(nome)!.description;
      expect(d, nome).toContain("equipe → funis → empresas → contatos → negócios → materiais");
      expect(d, nome).toMatch(/Teto: \d+ .* por chamada/);
      expect(d, nome).toContain("Pode ser repetida sem duplicar");
    }
  });

  it("toda ferramenta tem uma chamada de exemplo que o próprio schema aceita", () => {
    for (const f of FERRAMENTAS_DE_IMPORTACAO) {
      const parsed = z.object(f.inputSchema).safeParse(f.exemplo);
      expect(parsed.success, `${f.name}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it("os exemplos de item passam na validação de item da própria ferramenta", () => {
    expect(lerContato(EXEMPLO_DE_CONTATO)).toMatchObject({ ok: true });
    expect(lerNegocio(EXEMPLO_DE_NEGOCIO)).toMatchObject({ ok: true });
    const { etiquetas, campos, ...resto } = EXEMPLO_DE_EMPRESA;
    expect(empresaCreateSchema.safeParse({ ...resto, tags: etiquetas, custom_fields: campos }).success).toBe(true);
  });

  it("os exemplos são fictícios: e-mail em domínio reservado e nenhum endereço de terceiro", () => {
    const texto = JSON.stringify(FERRAMENTAS_DE_IMPORTACAO.map((f) => [f.description, f.exemplo]));
    for (const email of texto.match(/[\w.+-]+@[\w.-]+/g) ?? []) {
      expect(email, `e-mail de exemplo fora do domínio reservado: ${email}`).toMatch(/\.invalid$/);
    }
    for (const endereco of texto.match(/https?:\/\/[^\s"'`)\\]+/g) ?? []) {
      expect(endereco, `endereço de exemplo fora do domínio reservado: ${endereco}`).toMatch(/exemplo\.invalid/);
    }
  });
});

describe("a auditoria não carrega pessoa", () => {
  it("toda escrita de importação declara a redação dos argumentos", () => {
    for (const f of FERRAMENTAS_DE_IMPORTACAO.filter((x) => x.operacao !== null)) {
      expect(typeof (f as FerramentaDeImportacao).redigirParaAuditoria, `${f.name} sem redação`).toBe("function");
    }
  });

  it("a redação é lista BRANCA: argumento que ninguém declarou não entra", () => {
    const redigir = redigirLote(["organization_id", "origem"], ["contatos"]);
    expect(
      redigir({
        organization_id: "org-1",
        origem: "rdstation",
        contatos: [{ nome: "Ana Souza" }, { nome: "Bruno Lima" }],
        observacao_solta: "Ana Souza pediu desconto",
        // Um objeto num argumento "seguro" seria a porta dos fundos do dado pessoal.
        extra: { nome: "Ana Souza" },
      }),
    ).toEqual({ organization_id: "org-1", origem: "rdstation", contatos: { itens: 2 } });
    expect(redigir({ organization_id: { nome: "Ana Souza" }, contatos: "não é lista" })).toEqual({ contatos: { itens: 0 } });
  });

  it("ferramenta SEM redação (as de administração) segue gravando os argumentos, como sempre", () => {
    const lancarCredito = FERRAMENTA_POR_NOME.get("plataforma_lancar_credito")!;
    const args = { organization_id: "org-1", tipo: "credito", amount_cents: 5000 };
    expect(argumentosParaAuditoria(lancarCredito, args)).toBe(args);
  });

  it("ferramenta de importação tem os argumentos trocados por contagem antes de ir para a trilha", () => {
    const importarContatos = FERRAMENTA_POR_NOME.get("plataforma_importar_contatos")!;
    const redigido = argumentosParaAuditoria(importarContatos, {
      organization_id: "org-1",
      origem: "rdstation",
      contatos: [{ nome: "Ana Souza", telefone: "(10) 99111-0001", email: "ana.souza@exemplo.invalid" }],
    });
    expect(JSON.stringify(redigido)).not.toMatch(/Ana|99111|exemplo\.invalid/);
    expect(redigido).toEqual({ organization_id: "org-1", origem: "rdstation", contatos: { itens: 1 } });
  });
});

describe("as peças de base", () => {
  it("a origem é normalizada para uma forma só, e recusada quando não serve de chave", () => {
    expect(origemDaImportacao("RD Station", true)).toBe("rd_station");
    expect(origemDaImportacao("  pipedrive ", true)).toBe("pipedrive");
    expect(origemDaImportacao("Agência Órbita", true)).toBe("agencia_orbita");
    expect(origemDaImportacao(undefined, false)).toBeNull();
    expect(() => origemDaImportacao(undefined, true)).toThrow(/obrigatória/);
    expect(() => origemDaImportacao("x", true)).toThrow(/2 a 40/);
    expect(() => origemDaImportacao("!!!", true)).toThrow(/não serve/);
  });

  it("o que nasce de uma migração aparece como IMPORT no cartão do funil e na ficha", () => {
    // `lib/cartoes/canal.ts` repete o prefixo (roda no navegador e não pode
    // importar o módulo da importação): os dois têm de bater.
    const source = sourceDaImportacao("rdstation");
    expect(source).toBe(`${PREFIXO_DA_ORIGEM}rdstation`);
    const vazio = { source_metadata: null, external_id: null, tags: [] };
    expect(canalDoNegocio({ ...vazio, source }, null).sigla).toBe("IMPORT");
    // Negócio criado à mão para um contato que veio da migração herda o canal do contato.
    expect(canalDoNegocio({ ...vazio, source: "manual" }, { source, source_metadata: null }).sigla).toBe("IMPORT");
    // E o que não é de migração continua como era.
    expect(canalDoNegocio({ ...vazio, source: "manual" }, null).sigla).toBe("MANUAL");
  });

  it("datas de outro sistema: ISO e o formato brasileiro; o que não é data volta nulo", () => {
    expect(dataDeOrigem("2026-03-14")).toBe("2026-03-14T12:00:00.000Z");
    expect(dataDeOrigem("14/03/2026")).toBe("2026-03-14T12:00:00.000Z");
    expect(dataDeOrigem("2026-03-14T08:30:00-03:00")).toBe("2026-03-14T11:30:00.000Z");
    for (const torta of ["31/02/2026", "ontem", "14-03-2026", "", null, undefined, 20260314]) {
      expect(dataDeOrigem(torta), String(torta)).toBeNull();
    }
  });

  it("a recusa de um item diz a posição, o campo, o que era esperado e um exemplo", () => {
    const coletor = new Coletor();
    coletor.registrar(2, "criou", { id: "b" });
    coletor.recusar(1, "telefone", "o telefone não é válido.", '"(11) 99999-8888"');
    coletor.registrar(3, "ja_estava", { id: "c", avisos: ["um aviso"] });
    const r = coletor.resultado({ id: "org-1", nome: "Cliente", demonstracao: true });

    // Na ordem da lista enviada, mesmo que os desfechos tenham sido registrados fora dela.
    expect(r.itens.map((i) => i.posicao)).toEqual([1, 2, 3]);
    expect(r.itens[0]).toEqual({
      posicao: 1,
      desfecho: "recusou",
      motivo: 'Item 1, campo `telefone`: o telefone não é válido. Exemplo que passa: "(11) 99999-8888"',
    });
    expect(r).toMatchObject({ total: 3, criou: 1, atualizou: 0, ja_estava: 1, recusou: 1, nada_foi_enviado: NADA_FOI_ENVIADO });
    // A empresa de DEMONSTRAÇÃO é aceita, e a resposta diz que é ela.
    expect(r.organizacao.demonstracao).toBe(true);
  });

  it("o problema do schema da tela vira o nome do campo da ferramenta e uma frase em português", () => {
    const campos = { phone_number: "telefone", tags: "etiquetas" };
    expect(
      explicarProblemaDoSchema({ code: "too_big", origin: "string", maximum: 200, path: ["name"], message: "Too big" }, campos),
    ).toEqual({ campo: "name", esperado: "aceita no máximo 200 caracteres." });
    expect(
      explicarProblemaDoSchema({ code: "invalid_type", expected: "array", path: ["tags"], message: "Invalid input" }, campos),
    ).toEqual({ campo: "etiquetas", esperado: "deveria ser lista." });
    expect(
      explicarProblemaDoSchema(
        { code: "invalid_format", path: ["phone_number"], message: "Telefone deve estar em formato E.164 (+5511999998888)" },
        campos,
      ),
    ).toEqual({ campo: "telefone", esperado: "Telefone deve estar em formato E.164 (+5511999998888)" });
    expect(explicarProblemaDoSchema({ code: "custom", path: [], message: "Invalid input" }, campos)).toEqual({
      campo: "item",
      esperado: "o valor não está no formato esperado.",
    });
  });

  it("a leitura em páginas só para na página VAZIA, e não em 'veio menos que o pedido'", async () => {
    // Uma instalação com `max-rows` menor que a página devolve páginas curtas.
    const paginas = [[{ id: "a" }, { id: "b" }], [{ id: "c" }], []];
    const pedidos: Array<string | null> = [];
    const linhas = await lerEmPaginas<{ id: string }>(async (depoisDoId) => {
      pedidos.push(depoisDoId);
      return { data: paginas[pedidos.length - 1] ?? [], error: null };
    });
    expect(linhas.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(pedidos).toEqual([null, "b", "c"]);

    await expect(lerEmPaginas(async () => ({ data: null, error: { message: "sem permissão" } }))).rejects.toThrow(/sem permissão/);
  });
});
