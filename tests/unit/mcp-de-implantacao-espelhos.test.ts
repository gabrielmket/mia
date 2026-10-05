/**
 * FORK MIA — OS ESPELHOS DO MCP DE IMPLANTAÇÃO NÃO ENVELHECEM EM SILÊNCIO.
 *
 * ── O problema que este arquivo guarda ────────────────────────────────────
 *
 * A regra do MCP de implantação é: cada escrita passa pelo MESMO caminho da
 * tela. Onde a lógica estava presa dentro da rota e dava para tirar, ela foi
 * tirada para uma função que a rota e a ferramenta chamam (funil, mapeamento do
 * agente, configuração do funil, material de conhecimento, contrato dos tipos
 * de agendamento): ali não há o que divergir, e este arquivo não tem nada a
 * dizer sobre elas.
 *
 * Nas outras áreas a rota é fina (validação com um schema de `lib/schemas/`,
 * uma gravação e a auditoria) ou é lida por uma cerca do upstream que mede o
 * TEXTO dela. Nesses casos a operação de `lib/implantacao/` monta a mesma
 * sequência com as mesmas funções de biblioteca: é um ESPELHO. Espelho tem um
 * defeito conhecido: no dia em que o upstream acrescentar uma regra na rota (um
 * campo novo, uma recusa nova), a tela passa a obedecer e a ferramenta não, e
 * nenhum teste reprova, porque cada lado continua certo sozinho.
 *
 * ── O que ele mede ────────────────────────────────────────────────────────
 *
 * 1. A única REGRA que morava só numa rota e foi copiada: a lista de gatilhos
 *    de follow-up que têm motor. Comparada literal a literal, nos dois sentidos.
 *
 * 2. A IMPRESSÃO de cada rota espelhada: o código dela sem comentário e sem
 *    espaço, resumido. Mudou o código da rota, o teste reprova e diz qual
 *    operação reler. Não é um veredito de que o espelho está errado: é o aviso
 *    de que alguém precisa OLHAR. Quem olha confere o diff da rota, ajusta a
 *    operação se for o caso e grava a impressão nova aqui, no mesmo commit.
 *
 * ── O custo, declarado ────────────────────────────────────────────────────
 *
 * Isto reprova em mudança que não importa (uma variável renomeada na rota).
 * É o preço de não saber, de fora, qual mudança importa. Comentário e
 * formatação não disparam. Quando o custo incomodar numa área, a saída é a das
 * outras: tirar a sequência de dentro da rota, e a linha dela sai desta lista.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { GATILHOS_COM_MOTOR } from "@/lib/implantacao/followup";

const RAIZ = process.cwd();

/** O código do arquivo sem comentário e sem diferença de formatação, resumido. */
function impressao(relativo: string): string {
  const fonte = readFileSync(path.join(RAIZ, relativo), "utf8");
  const arquivo = ts.createSourceFile(relativo, fonte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const semComentario = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(arquivo);
  return createHash("sha256").update(semComentario.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
}

/**
 * Cada rota espelhada, a operação que a espelha e a impressão do código dela
 * no dia em que o espelho foi conferido.
 */
const ESPELHOS: ReadonlyArray<{ rota: string; espelho: string; impressao: string }> = [
  // Catálogo de produtos.
  { rota: "app/api/v1/products/route.ts", espelho: "lib/implantacao/produtos.ts", impressao: "882cbb6f1f5970e8" },
  { rota: "app/api/v1/products/[id]/route.ts", espelho: "lib/implantacao/produtos.ts", impressao: "0c030f4dbec32b72" },
  // Automações.
  { rota: "app/api/v1/automation-rules/route.ts", espelho: "lib/implantacao/automacoes.ts", impressao: "421acfdd5ebf5624" },
  // Relido na .72 (upstream 1.71, #2211): o PATCH parcial confere o laço de lead (acoesQueFechamLaco) contra a regra gravada. O espelho valida a regra INTEIRA com createAutomationRuleSchema, que já recusa o laço (recusarLacoDeLead): coberto.
  { rota: "app/api/v1/automation-rules/[id]/route.ts", espelho: "lib/implantacao/automacoes.ts", impressao: "f96ce8914978b826" },
  // Follow-up.
  // Relido na .72 (upstream 1.70, #2028): só a autenticação mudou (sessão OU token dsk_, resolveAuthDual). Nenhuma regra nova para o espelho.
  { rota: "app/api/v1/ai/followup-flows/from-model/route.ts", espelho: "lib/implantacao/followup.ts", impressao: "a0e03549e796bcf8" },
  { rota: "app/api/v1/ai/followup-flows/[id]/route.ts", espelho: "lib/implantacao/followup.ts", impressao: "d7640ddfa33c7917" },
  { rota: "app/api/v1/ai/followup-flows/[id]/publish/route.ts", espelho: "lib/implantacao/followup.ts", impressao: "c69f3113aa3c1067" },
  // Agente de IA.
  // Relido na .72 (upstream 1.70 #2028 e 1.73 #2296): token dsk_ e o corpo legado passa a criar mcp_agent com v1 rascunho pelo MESMO mcpAgentDraftRecords que o espelho já usa. A trava da IA continua na rota (lib/ai/trava-da-ia-na-rota.ts).
  { rota: "app/api/v1/ai/agents/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "2ef1be8524c50214" },
  // Relido na .72 (upstream 1.70, #2013 e #2028): a versão nova grava proposal_ai_draft_enabled; o espelho (inserirVersao) passou a gravar também. O resto é a autenticação por token.
  { rota: "app/api/v1/ai/agents/[id]/versions/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "34fbc917df0f927e" },
  { rota: "app/api/v1/ai/agents/[id]/versions/[vid]/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "a7a06466ba489ee7" },
  { rota: "app/api/v1/ai/agents/[id]/publish/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "94c4106ae472461e" },
  { rota: "app/api/v1/ai/agents/[id]/pause/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "6e42c31f7151ac42" },
  // Espelhado na .73 (upstream 1.71, #2216): o limiar de sentimento mora em `config` do cadastro. O espelho (configComLimiar) faz a mesma mescla do PATCH: padrões, o gravado e o pedido por cima, conferido por agentPatchSchema.
  { rota: "app/api/v1/ai/agents/[id]/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "d936626303d10f95" },
  // Roteador de intenção, espelhado na .73 (upstream 1.73, #2290: destino de funil por intenção). O espelho cria DESLIGADO de propósito; o resto segue a rota (número conferido, configDoRoteador, gravação das intenções pelas mesmas duas funções).
  { rota: "app/api/v1/ai/routers/route.ts", espelho: "lib/implantacao/roteador.ts", impressao: "2b6aee5c444c9b91" },
  { rota: "app/api/v1/ai/routers/[id]/route.ts", espelho: "lib/implantacao/roteador.ts", impressao: "f8b87207dbe05d67" },
  { rota: "app/api/v1/ai/routers/[id]/members/route.ts", espelho: "lib/implantacao/roteador.ts", impressao: "65e0573c219a9ca0" },
  // Memória da empresa.
  { rota: "app/api/v1/ai/memory/route.ts", espelho: "lib/implantacao/memoria.ts", impressao: "c28255da296e68b6" },
  { rota: "app/api/v1/ai/memory/entries/route.ts", espelho: "lib/implantacao/memoria.ts", impressao: "721aec1553d22379" },
  // Dados da empresa e regras de atendimento.
  // Relido na .72 (upstream 1.70, #2027): o papel passa por podeAdministrarEmpresa, a regra única do upstream. O espelho é do servidor (o token do MCP de plataforma já é a autorização).
  { rota: "app/actions/settings/updateTenant.ts", espelho: "lib/implantacao/empresa.ts", impressao: "1688d446cb9dc922" },
  { rota: "app/api/v1/settings/routing/route.ts", espelho: "lib/implantacao/empresa.ts", impressao: "5141ab7ba6a82744" },
  // Espelhado na .73 (upstream 1.70, #2079): quem fala, em negrito, na mensagem. O espelho confere com o mesmo assinaturaEntradaSchema e grava a mesma chave de settings.
  { rota: "app/api/v1/settings/assinatura/route.ts", espelho: "lib/implantacao/empresa.ts", impressao: "874d611f8e1a7d71" },
  // Jornada de quem atende.
  { rota: "app/api/v1/attendants/availability/[user_id]/route.ts", espelho: "lib/implantacao/agenda.ts", impressao: "de0c21f50707a594" },
  // Respostas prontas e modelo oficial do WhatsApp.
  { rota: "app/api/v1/message-templates/route.ts", espelho: "lib/implantacao/mensagens.ts", impressao: "dcd56e5cc8b68b25" },
  { rota: "app/api/v1/message-templates/[id]/route.ts", espelho: "lib/implantacao/mensagens.ts", impressao: "8740628df9e2dc2f" },
  { rota: "app/api/v1/channels/templates/criar/route.ts", espelho: "lib/implantacao/mensagens.ts", impressao: "42df61fe7056d0ea" },
  // Convite de equipe.
  { rota: "app/api/v1/team/invite/route.ts", espelho: "lib/implantacao/equipe.ts", impressao: "49adbac051eb4929" },
];

describe("a regra copiada: gatilhos de follow-up que têm motor", () => {
  const PUBLICAR = "app/api/v1/ai/followup-flows/[id]/publish/route.ts";

  function daRota(): string[] {
    const fonte = readFileSync(path.join(RAIZ, PUBLICAR), "utf8");
    const achado = /const KINDS_COM_MOTOR = new Set\(\[([^\]]*)\]\)/.exec(fonte);
    if (achado === null) return [];
    return [...achado[1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!);
  }

  it("CONTROLE: o leitor acha a lista na rota (instrumento que não acha nada dá verde igual)", () => {
    expect(daRota().length, "não achei KINDS_COM_MOTOR na rota de publicar").toBeGreaterThan(0);
    expect(GATILHOS_COM_MOTOR.length).toBeGreaterThan(0);
  });

  it("⭐ a ferramenta publica exatamente os gatilhos que a tela publica, nos dois sentidos", () => {
    const rota = new Set(daRota());
    const ferramenta = new Set(GATILHOS_COM_MOTOR);
    expect(
      [...ferramenta].filter((k) => !rota.has(k)),
      "a ferramenta publicaria um gatilho que a tela recusa: fluxo ativo que nunca inscreve ninguém",
    ).toEqual([]);
    expect(
      [...rota].filter((k) => !ferramenta.has(k)),
      "a tela publica um gatilho que a ferramenta recusa: acrescente-o a GATILHOS_COM_MOTOR em lib/implantacao/followup.ts",
    ).toEqual([]);
  });
});

describe("as rotas espelhadas não mudaram sem alguém reler o espelho", () => {
  it("CONTROLE: a impressão ignora comentário e formatação, e enxerga mudança de código", () => {
    const resumo = (fonte: string) => {
      const arquivo = ts.createSourceFile("x.ts", fonte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      return ts.createPrinter({ removeComments: true }).printFile(arquivo).replace(/\s+/g, " ").trim();
    };
    const base = resumo("const teto = 10;\nexport function f() { return teto; }");
    expect(resumo("// um comentário\nconst teto = 10;\n\n\nexport function f() {\n  /* outro */ return teto;\n}")).toBe(base);
    expect(resumo("const teto = 11;\nexport function f() { return teto; }")).not.toBe(base);
  });

  it("toda rota da lista existe, e todo espelho também", () => {
    const sumiram = ESPELHOS.flatMap((e) => [e.rota, e.espelho]).filter((p) => !existsSync(path.join(RAIZ, p)));
    expect(
      [...new Set(sumiram)],
      "arquivo da lista de espelhos não existe mais: a rota foi movida ou apagada, e o espelho ficou sem par",
    ).toEqual([]);
  });

  it.each(ESPELHOS.map((e) => [e.rota, e] as const))("⭐ %s", (_rota, e) => {
    expect(
      impressao(e.rota),
      `O código de ${e.rota} mudou desde que ${e.espelho} foi conferido contra ele. ` +
        `Leia o que mudou na rota (git log -p -- "${e.rota}"), leve para ${e.espelho} a regra nova se houver ` +
        "e grave a impressão nova em ESPELHOS, neste arquivo.",
    ).toBe(e.impressao);
  });
});
