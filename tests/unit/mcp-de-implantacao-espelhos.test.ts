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
  // Relido na .76 (upstream 1.74 a 1.80): só o GET mudou (busca e página no servidor). O POST, que o espelho segue, é o mesmo.
  { rota: "app/api/v1/products/route.ts", espelho: "lib/implantacao/produtos.ts", impressao: "8e1d25078bb05b83" },
  { rota: "app/api/v1/products/[id]/route.ts", espelho: "lib/implantacao/produtos.ts", impressao: "0c030f4dbec32b72" },
  // Automações.
  // Relido na .76 (upstream 1.78): a fonte de formulário de `trigger_config.webhook_source_id` tem de ser da empresa. O espelho confere (conferirConfiguracaoDoGatilho), com a frase da rota; e também o funil e a etapa dos gatilhos de tempo.
  { rota: "app/api/v1/automation-rules/route.ts", espelho: "lib/implantacao/automacoes.ts", impressao: "60944af22187bd79" },
  // Relido na .72 (upstream 1.71, #2211): o PATCH parcial confere o laço de lead (acoesQueFechamLaco) contra a regra gravada. O espelho valida a regra INTEIRA com createAutomationRuleSchema, que já recusa o laço (recusarLacoDeLead): coberto.
  // Relido na .76 (upstream 1.78): a mesma conferência da fonte no PATCH. Coberta pelo mesmo conferirConfiguracaoDoGatilho, que roda antes de criar e de editar.
  { rota: "app/api/v1/automation-rules/[id]/route.ts", espelho: "lib/implantacao/automacoes.ts", impressao: "13713ae934a645a7" },
  // Follow-up.
  // Relido na .72 (upstream 1.70, #2028): só a autenticação mudou (sessão OU token dsk_, resolveAuthDual). Nenhuma regra nova para o espelho.
  { rota: "app/api/v1/ai/followup-flows/from-model/route.ts", espelho: "lib/implantacao/followup.ts", impressao: "a0e03549e796bcf8" },
  { rota: "app/api/v1/ai/followup-flows/[id]/route.ts", espelho: "lib/implantacao/followup.ts", impressao: "d7640ddfa33c7917" },
  { rota: "app/api/v1/ai/followup-flows/[id]/publish/route.ts", espelho: "lib/implantacao/followup.ts", impressao: "c69f3113aa3c1067" },
  // Agente de IA.
  // Relido na .72 (upstream 1.70 #2028 e 1.73 #2296): token dsk_ e o corpo legado passa a criar mcp_agent com v1 rascunho pelo MESMO mcpAgentDraftRecords que o espelho já usa. A trava da IA continua na rota (lib/ai/trava-da-ia-na-rota.ts).
  // Relido na .76 (upstream 1.74 e 1.79): o código do erro de escopo (provedor desligado) e a coluna handoff_legal_enabled na leitura. O espelho já passava a versão inteira à conferência de escopo; a recusa passou a usar mensagemDoEscopo.
  { rota: "app/api/v1/ai/agents/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "a121e37852edf28c" },
  // Relido na .72 (upstream 1.70, #2013 e #2028): a versão nova grava proposal_ai_draft_enabled; o espelho (inserirVersao) passou a gravar também. O resto é a autenticação por token.
  // Relido na .76 (upstream 1.74 e 1.79): a versão nova copia handoff_legal_enabled e o escopo confere provedor, chave e número. O espelho (inserirVersao e a conferência antes de gravar) faz os dois.
  { rota: "app/api/v1/ai/agents/[id]/versions/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "b7f10fdc1237e374" },
  // Relido na .76: token dsk_ (resolveAuthDual), handoff_legal_enabled no PATCH e a conferência de escopo antes de editar o rascunho. O espelho confere o escopo antes das duas gravações.
  { rota: "app/api/v1/ai/agents/[id]/versions/[vid]/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "ed48b99f03791c97" },
  // Relido na .76 (upstream 1.79, #2156): publishAgentVersion recebe quemPublicou, e a mudança da chave jurídica sai como ai_agent.legal_handoff_changed com o ator. O espelho passa o autor do token. E a ferramenta de servidor MCP externo escolhida no agente conta como capacidade válida (`toolIdAceito`): o espelho usa a mesma régua ao publicar.
  { rota: "app/api/v1/ai/agents/[id]/publish/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "479026df35f97b55" },
  { rota: "app/api/v1/ai/agents/[id]/pause/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "6e42c31f7151ac42" },
  // Espelhado na .73 (upstream 1.71, #2216): o limiar de sentimento mora em `config` do cadastro. O espelho (configComLimiar) faz a mesma mescla do PATCH: padrões, o gravado e o pedido por cima, conferido por agentPatchSchema.
  // Relido na .76 (upstream 1.74): token dsk_ e a auditoria ai_agent.updated no PATCH do cadastro. O espelho deixa a mesma linha quando muda nome, descrição, prioridade ou limiar.
  { rota: "app/api/v1/ai/agents/[id]/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "e0f5fecd68174ac1" },
  // Roteador de intenção, espelhado na .73 (upstream 1.73, #2290: destino de funil por intenção). O espelho cria DESLIGADO de propósito; o resto segue a rota (número conferido, configDoRoteador, gravação das intenções pelas mesmas duas funções).
  // Relido na .76 (upstream 1.74, #2061): o roteador novo nasce com context_message_count 8, e a régua é 0 a 16. O espelho grava o mesmo e ganhou `mensagens_de_contexto`.
  { rota: "app/api/v1/ai/routers/route.ts", espelho: "lib/implantacao/roteador.ts", impressao: "ae6ec0c7df54231f" },
  { rota: "app/api/v1/ai/routers/[id]/route.ts", espelho: "lib/implantacao/roteador.ts", impressao: "355393b0881dc083" },
  // Relido na .76 (upstream 1.79, #2624): o cliente do pool que falhou no meio da transação volta com erro (release(err)). O espelho faz o mesmo em gravarIntencoes.
  { rota: "app/api/v1/ai/routers/[id]/members/route.ts", espelho: "lib/implantacao/roteador.ts", impressao: "07620fd49b8a6ea5" },
  // Memória da empresa.
  { rota: "app/api/v1/ai/memory/route.ts", espelho: "lib/implantacao/memoria.ts", impressao: "c28255da296e68b6" },
  { rota: "app/api/v1/ai/memory/entries/route.ts", espelho: "lib/implantacao/memoria.ts", impressao: "721aec1553d22379" },
  // Dados da empresa e regras de atendimento.
  // Relido na .72 (upstream 1.70, #2027): o papel passa por podeAdministrarEmpresa, a regra única do upstream. O espelho é do servidor (o token do MCP de plataforma já é a autorização).
  // Relido na .76 (upstream 1.74 e 1.79): a gravação mora em gravarDadosCadastrais (com media_retention_enforced e a frase do CNPJ repetido), e o modo de venda ausente não muda. O espelho grava as mesmas colunas e dá a mesma frase.
  { rota: "app/actions/settings/updateTenant.ts", espelho: "lib/implantacao/empresa.ts", impressao: "14a8d796f39e6d76" },
  // Espelhado na .76 (upstream 1.76, #2367): o freio do passo "a IA decide", com a mescla nos dois níveis de settings e a mesma auditoria.
  { rota: "app/actions/settings/definirAiDecideDaEmpresa.ts", espelho: "lib/implantacao/empresa.ts", impressao: "8168719014b15dca" },
  // Espelhado na .76 (upstream 1.77, #1752): os planos de tarefa, conferidos por planosSchema, em settings.task_plans.
  { rota: "app/api/v1/settings/task-plans/route.ts", espelho: "lib/implantacao/planos-de-tarefa.ts", impressao: "dbd8af9b1d6e19dd" },
  // Espelhado na .76 (upstream 1.74, #2321): a camada de afirmação clínica da empresa, pelo mesmo upsert e auditoria.
  { rota: "app/api/v1/ai/guardrail-layers/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "2bde06e4c4f3887e" },
  // Espelhados na .76: os dias da prospecção (1.80, 0642), guardar o histórico (1.74, #999) e a pausa agendada (1.79, #2388).
  { rota: "app/api/v1/ai/pacing/route.ts", espelho: "lib/implantacao/canal.ts", impressao: "3a02cf8f709c4ea5" },
  { rota: "app/api/v1/channel-sessions/[id]/acervo/route.ts", espelho: "lib/implantacao/canal.ts", impressao: "1932744eaa41d92f" },
  { rota: "app/api/v1/channel-schedules/route.ts", espelho: "lib/implantacao/canal.ts", impressao: "a8182100962af47e" },
  { rota: "app/api/v1/channel-schedules/[id]/route.ts", espelho: "lib/implantacao/canal.ts", impressao: "c2250a4cbc7936d4" },
  // Espelhados na .76 (upstream 1.76 e 1.78): a fonte de formulário, com as perguntas e a autorização de IA (que exige a assinatura).
  { rota: "app/api/v1/webhook-sources/route.ts", espelho: "lib/implantacao/fonte-de-formulario.ts", impressao: "a400691a20559e3f" },
  { rota: "app/api/v1/webhook-sources/[id]/route.ts", espelho: "lib/implantacao/fonte-de-formulario.ts", impressao: "f83c28ab7f4d3e8f" },
  // Espelhado na .76 (upstream 1.74, 0558): a coluna do cliente numa conexão de banco externo, sem tocar na credencial.
  { rota: "app/api/v1/external-db/connections/[id]/route.ts", espelho: "lib/implantacao/banco-externo.ts", impressao: "6e2d98edd7287b89" },
  // Espelhado na .76 (upstream 1.79, #2591): o dono do contato. A rota chama fn_definir_carteira_do_cliente; o MCP chama a cópia do fork (9022) e deixa a mesma auditoria.
  { rota: "app/api/v1/contacts/[id]/carteira/route.ts", espelho: "lib/mcp-plataforma/importacao/contatos.ts", impressao: "dde32113060d7ce5" },
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
  // Relido na .75 (9020, mudança NOSSA na rota): convite que o banco não grava vira item de `failed` (`convite_nao_gravado`) e o lote segue, em vez de 500. O espelho faz o mesmo: desfecho `nao_gravou`, com aviso, e as outras pessoas seguem.
  // Relido na .76 (upstream 1.78, cobrança): o pedido inteiro é recusado antes do e-mail quando a empresa já ocupa os assentos do plano. O espelho faz a mesma conta e dá a mesma frase; com a cobrança desligada, não há limite.
  { rota: "app/api/v1/team/invite/route.ts", espelho: "lib/implantacao/equipe.ts", impressao: "216ab6f92e5f6eca" },
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

/**
 * A FUNÇÃO DO BANCO que a migration 9022 copia (`fn_definir_carteira_do_cliente`,
 * upstream 0622): a 9022 tem o mesmo corpo, com o token de plataforma no lugar do
 * gerente membro como ator. A impressão é do texto da função como ele vale no
 * install (a ÚLTIMA definição em `supabase/baseline.sql`), sem comentário e sem
 * diferença de espaço. Mudou, reprova: releia a 9022 e leve a regra nova numa
 * migration nova do fork (a 9022 não se edita depois de aplicada).
 */
const PORTA_DA_CARTEIRA = {
  marca: "create or replace function public.fn_definir_carteira_do_cliente(",
  copia: "supabase/migrations-mia/20261014150000_9022_dono_do_contato_pela_plataforma.sql",
  impressao: "11a835066dd98199",
};

function impressaoDaFuncao(baseline: string, marca: string): string | null {
  const inicio = baseline.lastIndexOf(marca);
  if (inicio < 0) return null;
  const fim = baseline.indexOf("$;", inicio);
  const corpo = baseline
    .slice(inicio, fim + 3)
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(corpo).digest("hex").slice(0, 16);
}

describe("a função do banco que a 9022 copia não mudou sem alguém reler a cópia", () => {
  const baseline = readFileSync(path.join(RAIZ, "supabase/baseline.sql"), "utf8");

  it("CONTROLE: o leitor acha a função, e a cópia do fork existe", () => {
    expect(impressaoDaFuncao(baseline, PORTA_DA_CARTEIRA.marca)).not.toBeNull();
    expect(existsSync(path.join(RAIZ, PORTA_DA_CARTEIRA.copia))).toBe(true);
    // A impressão enxerga mudança de código e ignora comentário.
    const base = impressaoDaFuncao("create or replace function public.f(\n x\n) as $ begin end; $;", "create or replace function public.f(");
    expect(impressaoDaFuncao("create or replace function public.f( -- comentário\n x\n) as $ begin end; $;", "create or replace function public.f(")).toBe(base);
    expect(impressaoDaFuncao("create or replace function public.f(\n y\n) as $ begin end; $;", "create or replace function public.f(")).not.toBe(base);
  });

  it("⭐ fn_definir_carteira_do_cliente", () => {
    expect(
      impressaoDaFuncao(baseline, PORTA_DA_CARTEIRA.marca),
      "A função fn_definir_carteira_do_cliente mudou no upstream desde que a 9022 a copiou. Leia o que mudou (git log -p -- supabase/baseline.sql), " +
        "leve a regra nova para uma migration nova do fork que redefina fn_mia_definir_dono_do_contato_pela_plataforma e grave a impressão nova aqui.",
    ).toBe(PORTA_DA_CARTEIRA.impressao);
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
