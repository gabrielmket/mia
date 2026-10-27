/**
 * FORK MIA (.89) — AS PERGUNTAS DE VERDADE ACHAM A AJUDA CERTA.
 *
 * Determinístico e sem IA: a busca do `buscar_ajuda` (manuais, roteiros e guia
 * de operação) recebe a pergunta, como a equipe escreve, e a tela de onde ela
 * veio; o trecho certo tem de estar entre os primeiros. É a régua do caso que
 * originou isto: "como eu uso o mcp aqui", na tela do servidor MCP externo,
 * respondido com "ainda não sei" (26/10/2026).
 *
 * Duas exigências de cobertura:
 *   - toda tela principal do app tem pelo menos uma pergunta aqui;
 *   - todo roteiro (tarefa que cruza telas) tem pelo menos uma.
 */
import { describe, expect, it } from "vitest";

import { buscarAjuda, ajudaEmOrdem, telasDoManual, type FonteDaAjuda } from "@/lib/assistente/leituras/ajuda";
import { MANUAIS } from "@/lib/assistente/manuais";
import { ROTEIROS } from "@/lib/assistente/roteiros";
import { telasParaOPapel } from "@/lib/assistente/telas";

import { telasPrincipais } from "./helpers/telas-do-app";

interface Pergunta {
  pergunta: string;
  /** A tela em que a pessoa estava. */
  em?: string;
  /** A tela de que a pergunta trata. */
  sobre: string;
  /** O manual (ou trecho do guia) que tem de vir entre os primeiros; sem ele, basta ajuda ligada a `sobre`. */
  espera?: string;
}

/** Entre os primeiros quantos. */
const ENTRE_OS_PRIMEIROS = 3;

const PERGUNTAS: Pergunta[] = [
  // ── O caso que começou tudo, e as outras do pedido ──
  { pergunta: "como eu uso o mcp aqui", em: "/app/settings/servidor-mcp-externo", sobre: "/app/settings/servidor-mcp-externo", espera: "servidor-mcp-externo" },
  { pergunta: "como eu uso o mcp aqui", em: "/app/settings/api-tokens", sobre: "/app/settings/api-tokens", espera: "mcp-da-mia" },
  { pergunta: "como conecto o whatsapp", sobre: "/app/connections", espera: "conectar-numero" },
  { pergunta: "como configuro o horário da IA", sobre: "/app/ai/agents", espera: "horario-da-ia" },
  { pergunta: "onde vejo as conversões da meta", sobre: "/app/settings/conversoes", espera: "conversoes-meta" },
  { pergunta: "como mando e-mail marketing", sobre: "/app/broadcast", espera: "email-marketing-campanha" },
  { pergunta: "como convido alguém", sobre: "/app/team", espera: "convidar-equipe" },

  // ── Os roteiros (tarefas que cruzam telas) ──
  { pergunta: "como coloco um cliente novo para atender", sobre: "/app/connections", espera: "roteiro-comecar-a-atender" },
  { pergunta: "como faço uma campanha", sobre: "/app/broadcast", espera: "roteiro-campanha" },
  { pergunta: "como vejo se a IA está vendendo", sobre: "/app/paineis", espera: "roteiro-ia-vendendo" },
  { pergunta: "como ligo o Claude no CRM", sobre: "/app/settings/api-tokens", espera: "roteiro-ligar-claude" },
  { pergunta: "como ligo o anúncio da meta de ponta a ponta até a venda", sobre: "/app/settings/meta-ads", espera: "roteiro-anuncio-ate-a-venda" },
  { pergunta: "quero receber os avisos no celular", sobre: "/app/settings/aplicativo", espera: "roteiro-avisos-no-celular" },
  { pergunta: "contratei um vendedor novo, como coloco ele para atender", sobre: "/app/team", espera: "roteiro-novo-vendedor" },
  { pergunta: "como pauso a IA", sobre: "/app/inbox", espera: "roteiro-pausar-a-ia" },

  // ── MCP: os dois sentidos ──
  { pergunta: "como uso o mcp", sobre: "/app/settings/servidor-mcp-externo", espera: "servidor-mcp-externo" },
  { pergunta: "como uso o mcp", sobre: "/app/settings/api-tokens", espera: "mcp-da-mia" },
  { pergunta: "quero que a IA consulte o sistema da minha empresa", sobre: "/app/settings/servidor-mcp-externo", espera: "servidor-mcp-externo" },
  { pergunta: "como gero um token para outro sistema", sobre: "/app/settings/api-tokens", espera: "token-de-api" },
  { pergunta: "como ligo o servidor externo no agente", em: "/app/ai/agents/0a000000-0000-4000-8000-000000000001", sobre: "/app/ai/agents", espera: "servidor-mcp-externo" },

  // ── Atendimento ──
  { pergunta: "como respondo as conversas", sobre: "/app/inbox", espera: "inbox" },
  { pergunta: "como assumo a conversa da IA", sobre: "/app/inbox", espera: "assumir-conversa" },
  { pergunta: "onde vejo quem esfriou e está parado", sobre: "/app/radar", espera: "radar" },
  { pergunta: "como marco uma reunião na agenda", sobre: "/app/agenda", espera: "agenda" },
  { pergunta: "como conecto o outlook", sobre: "/app/agenda", espera: "agenda-outlook" },
  { pergunta: "como crio uma resposta rápida", sobre: "/app/templates", espera: "respostas-rapidas" },
  { pergunta: "como recebo no whatsapp os agendamentos do dia", sobre: "/app/agenda/avisos", espera: "aviso-de-agendamento" },

  // ── CRM ──
  { pergunta: "como mudo as etapas do funil", sobre: "/app/settings/tenant/pipelines", espera: "etapas-do-funil" },
  { pergunta: "como marco um negócio como perdido", sobre: "/app/kanban", espera: "marcar-perdido" },
  { pergunta: "como movo o negócio de etapa", sobre: "/app/kanban", espera: "abrir-funil" },
  { pergunta: "como importo contatos de uma planilha", sobre: "/app/contacts", espera: "importar-contatos" },
  { pergunta: "como cadastro uma empresa com cnpj", sobre: "/app/companies", espera: "empresas-cadastrar" },
  { pergunta: "como junto duas empresas duplicadas", sobre: "/app/companies", espera: "empresas-mesclar" },
  { pergunta: "como uso isso aqui", em: "/app/empresas", sobre: "/app/empresas" },
  { pergunta: "como cadastro um decisor", sobre: "/app/people", espera: "pessoas" },
  { pergunta: "como crio uma tarefa", sobre: "/app/tasks", espera: "tarefas" },
  { pergunta: "como monto um checklist de tarefas para todo negócio", sobre: "/app/tasks/planos", espera: "planos-de-tarefa" },
  { pergunta: "como cadastro um documento com vencimento", sobre: "/app/obrigacoes", espera: "obrigacoes-criar" },
  { pergunta: "como marco que o documento chegou", sobre: "/app/obrigacoes", espera: "obrigacoes-receber" },
  { pergunta: "o que falta para a minha empresa ficar pronta", sobre: "/app/inicio", espera: "inicio-o-que-falta" },
  { pergunta: "como uso o assistente", sobre: "/app/assistente", espera: "assistente-usar" },
  // .93: as trilhas do "Me mostra como".
  { pergunta: "quero aprender a usar o sistema passo a passo", sobre: "/app/assistente", espera: "assistente-trilhas" },
  { pergunta: "onde vejo as trilhas e continuo de onde parei", em: "/app/assistente", sobre: "/app/assistente", espera: "assistente-trilhas" },
  { pergunta: "encontrei um erro, como abro um chamado", sobre: "/app/assistente", espera: "assistente-chamado" },
  // FORK MIA (.94): o assistente faz com aprovação, e desfaz.
  { pergunta: "como desfaço o que o assistente fez", sobre: "/app/assistente", espera: "assistente-propostas" },
  { pergunta: "o assistente pode criar uma etapa para mim?", sobre: "/app/assistente", espera: "assistente-propostas" },
  { pergunta: "onde aprovo o pedido que a atendente mandou pelo assistente", sobre: "/app/assistente", espera: "assistente-propostas" },
  { pergunta: "como faço uma ligação com a IA", sobre: "/app/calls", espera: "chamadas" },
  { pergunta: "como cadastro um produto com preço", sobre: "/app/products", espera: "produtos" },
  { pergunta: "como importo empresas de uma planilha", sobre: "/app/imports", espera: "importacoes" },
  { pergunta: "como faço um orçamento para o cliente", sobre: "/app/proposals", espera: "propostas-comerciais" },
  { pergunta: "como busco empresas para prospectar", sobre: "/app/prospecting", espera: "prospeccao" },
  { pergunta: "como abro uma comanda", sobre: "/app/comandas", espera: "comandas" },
  { pergunta: "como disparo um template pelo número oficial", sobre: "/app/broadcast", espera: "broadcast-oficial" },
  { pergunta: "como mando campanha pelo número do qr", sobre: "/app/campaigns", espera: "broadcast-qr" },

  // ── Agente MIA ──
  { pergunta: "como crio um agente novo", sobre: "/app/ai/agents", espera: "agente" },
  { pergunta: "como uso isso aqui", em: "/app/ai/agents/0a000000-0000-4000-8000-000000000001", sobre: "/app/ai/agents", espera: "agente" },
  { pergunta: "vocês fazem backup dos meus dados?", sobre: "/app/settings/tenant", espera: "backup" },
  { pergunta: "como mudo o texto do follow-up", sobre: "/app/ai/followups", espera: "followup" },
  { pergunta: "como faço a IA perguntar os dados do cliente na conversa", sobre: "/app/ai/atendimento", espera: "fluxos-de-atendimento" },
  { pergunta: "como mando cada assunto para um agente diferente", sobre: "/app/ai/routers", espera: "roteadores" },
  { pergunta: "posso trocar o modelo da IA ou colocar a minha chave da openai", sobre: "/app/ai/credentials", espera: "ia-da-plataforma" },
  { pergunta: "o que é o jev e como deixo ele decidir", sobre: "/app/ai/providers", espera: "provedores-jev" },
  { pergunta: "como ensino o agente com um pdf", sobre: "/app/ai/knowledge/sources", espera: "conhecimento" },
  { pergunta: "como ensino uma regra para o agente", sobre: "/app/ai/memory", espera: "memoria" },
  { pergunta: "como instalo uma skill", sobre: "/app/ai/skills", espera: "skills" },
  { pergunta: "como respondo um caso que a IA travou", sobre: "/app/ai/cases", espera: "casos" },
  { pergunta: "como uso isso aqui", em: "/app/ai/inbox", sobre: "/app/ai/inbox" },
  { pergunta: "quero receber no whatsapp quando a IA abrir um caso", sobre: "/app/ai/cases/avisos", espera: "aviso-no-whatsapp" },
  { pergunta: "como aprovo as propostas da IA", sobre: "/app/ai/proposals", espera: "propostas-da-ia" },
  { pergunta: "onde vejo por que a IA falhou", sobre: "/app/ai/runs", espera: "execucoes" },
  { pergunta: "quanto a IA gastou este mês", sobre: "/app/ai/usage", espera: "ia-da-plataforma" },

  // ── Canais ──
  { pergunta: "meu número desconectou, como reconecto", sobre: "/app/connections", espera: "numero-desconectado" },
  { pergunta: "como conecto minha loja nuvemshop", sobre: "/app/integrations/nuvemshop", espera: "nuvemshop" },
  { pergunta: "como crio uma automação", sobre: "/app/webhooks", espera: "automacoes-regras" },
  { pergunta: "como crio um template da meta", sobre: "/app/connections", espera: "templates-da-meta" },

  // ── MIA Insights ──
  { pergunta: "onde vejo quanto entrou no caixa", sobre: "/app/faturamento", espera: "faturamento" },
  { pergunta: "como lanço uma parcela de honorários", sobre: "/app/honorarios", espera: "honorarios" },
  { pergunta: "como defino a meta do mês", sobre: "/app/metrics", espera: "metas" },
  { pergunta: "onde vejo os números do mês num painel", sobre: "/app/paineis", espera: "paineis-prontos" },
  { pergunta: "onde vejo a conversão etapa a etapa", sobre: "/app/paineis/funil", espera: "analise-do-funil" },
  { pergunta: "como mando os números para o dono por um link", sobre: "/app/paineis/links", espera: "link-do-dono" },
  { pergunta: "como monto um relatório", sobre: "/app/relatorios", espera: "relatorios" },
  { pergunta: "como exporto um relatório para excel", sobre: "/app/relatorios", espera: "exportar-relatorio" },
  { pergunta: "onde vejo o custo das campanhas de anúncio", sobre: "/app/ads/meta" },
  { pergunta: "onde vejo o que a equipe fez no período", sobre: "/app/activities", espera: "atividades" },
  { pergunta: "o agente está melhorando?", sobre: "/app/ai/evolution", espera: "evolucao-da-ia" },
  { pergunta: "quem alterou esse negócio", sobre: "/app/audit", espera: "audit-log" },

  // ── Configurações (cada subpágina) ──
  { pergunta: "onde ficam todas as telas de configuração", sobre: "/app/settings", espera: "hubs" },
  { pergunta: "como uso isso aqui", em: "/app/crm", sobre: "/app/crm", espera: "hubs" },
  { pergunta: "como uso isso aqui", em: "/app/ai", sobre: "/app/ai", espera: "hubs" },
  { pergunta: "como uso isso aqui", em: "/app/analise", sobre: "/app/analise", espera: "hubs" },
  { pergunta: "como uso isso aqui", em: "/app", sobre: "/app", espera: "hubs" },
  { pergunta: "como mudo meu fuso horário e idioma", sobre: "/app/settings/profile", espera: "perfil" },
  { pergunta: "como ligo a verificação em duas etapas", sobre: "/app/settings/security", espera: "seguranca" },
  { pergunta: "como escolho por onde recebo as notificações", sobre: "/app/settings/notifications", espera: "notificacoes" },
  { pergunta: "como instalo o app no iphone", sobre: "/app/settings/aplicativo", espera: "app-no-celular" },
  { pergunta: "onde vejo meu saldo de créditos", sobre: "/app/settings/carteira", espera: "creditos" },
  { pergunta: "como configuro o domínio do e-mail marketing", sobre: "/app/settings/email-marketing", espera: "email-marketing-configurar" },
  { pergunta: "como escolho quem recebe cada cliente novo", sobre: "/app/settings/atendimento", espera: "distribuicao" },
  { pergunta: "como desligo a IA nas automações", sobre: "/app/settings/automacoes", espera: "automacoes-freio" },
  { pergunta: "como crio uma etiqueta", sobre: "/app/settings/tags", espera: "etiquetas" },
  { pergunta: "onde ligo os recursos opcionais", sobre: "/app/settings/recursos", espera: "recursos-opcionais" },
  { pergunta: "como mudo os dados da empresa e a moeda", sobre: "/app/settings/tenant", espera: "organizacao" },
  { pergunta: "como devolvo as vendas para o google ads", sobre: "/app/settings/conversoes", espera: "conversoes-google" },
  { pergunta: "a meta não está recebendo as conversões, como confiro", sobre: "/app/settings/conversoes", espera: "conversoes-conferir" },
  { pergunta: "como conecto a conta de anúncios da meta", sobre: "/app/settings/meta-ads", espera: "conectar-meta-ads" },
  { pergunta: "os leads do formulário do facebook não chegam no funil", sobre: "/app/settings/leads-da-meta", espera: "leads-formulario-meta" },
  { pergunta: "como uso isso aqui", em: "/app/settings/leads-da-meta", sobre: "/app/settings/leads-da-meta", espera: "leads-formulario-meta" },
  { pergunta: "como mudo a logo e a cor da marca", sobre: "/app/settings/marca", espera: "marca" },
  { pergunta: "como pago a fatura da mensalidade", sobre: "/app/settings/billing", espera: "plano-e-cobranca" },
  // FORK MIA (.96): o passo "Pagamento" do início (entrada paga e plano com teste).
  { pergunta: "como pago com pix para liberar a conta", sobre: "/app/settings/billing", espera: "pagamento-no-inicio" },
  { pergunta: "vou ser cobrado no teste grátis? como cadastro o cartão", sobre: "/app/settings/billing", espera: "pagamento-no-inicio" },
  // FORK MIA (.96, segunda frente): a área de cobrança (a nota, o cartão, a nota errada).
  { pergunta: "como baixo a nota fiscal do mês", sobre: "/app/settings/billing", espera: "area-de-cobranca" },
  { pergunta: "como troco o cartão das mensalidades", em: "/app/settings/billing", sobre: "/app/settings/billing", espera: "area-de-cobranca" },
  { pergunta: "a nota saiu errada, como peço a correção", sobre: "/app/settings/billing", espera: "area-de-cobranca" },
  { pergunta: "onde pego o recibo do pagamento", sobre: "/app/settings/billing", espera: "area-de-cobranca" },
  { pergunta: "como atender um pedido de exclusão de dados lgpd", sobre: "/app/lgpd/requests", espera: "lgpd" },
  { pergunta: "como configuro o trunk sip", sobre: "/app/settings/voip-trunk", espera: "trunk-sip" },
  { pergunta: "como atualizo o sistema para a nova versão", sobre: "/app/settings/atualizacao", espera: "atualizacao" },
  { pergunta: "como uso isso aqui", em: "/app/settings/templates", sobre: "/app/settings/templates", espera: "templates-da-meta" },
  { pergunta: "como uso isso aqui", em: "/app/settings/canal-oficial", sobre: "/app/settings/canal-oficial", espera: "templates-da-meta" },
  { pergunta: "como crio um tipo de agendamento", sobre: "/app/settings/tenant/agenda", espera: "tipos-de-agendamento" },
  { pergunta: "como cadastro as formas de pagamento", sobre: "/app/settings/tenant/financeiro", espera: "financeiro" },
  { pergunta: "como ligo as propostas e a validade padrão", sobre: "/app/settings/tenant/proposals", espera: "propostas-config" },
  { pergunta: "como crio um modelo de proposta", sobre: "/app/settings/tenant/proposals/modelos", espera: "modelos-de-proposta" },
  { pergunta: "como conecto o banco de dados do meu erp", sobre: "/app/integracao-dados", espera: "banco-externo" },
  { pergunta: "como ativo uma extensão", sobre: "/app/extensions", espera: "extensoes" },
  { pergunta: "por que nada sai desta empresa de demonstração", sobre: "/app/settings/tenant", espera: "demonstracao" },
];

/** O achado é a ajuda esperada? */
function eh(a: FonteDaAjuda, id: string): boolean {
  return a.fonte === "manual" ? a.manual.id === id : a.trecho.id === id;
}

/** O achado está ligado à tela? */
function daTela(a: FonteDaAjuda, tela: string): boolean {
  return a.fonte === "manual" ? telasDoManual(a.manual).includes(tela) : a.trecho.tela === tela;
}

function rotulo(a: FonteDaAjuda): string {
  return a.fonte === "manual" ? a.manual.id : `guia:${a.trecho.id}`;
}

describe("perguntas reais acham a ajuda certa entre as primeiras", () => {
  it.each(PERGUNTAS.map((p) => [`${p.pergunta}${p.em ? ` (em ${p.em})` : ""}`, p] as const))("%s", (_nome, p) => {
    const primeiros = ajudaEmOrdem(p.pergunta, p.em ?? null, ENTRE_OS_PRIMEIROS);
    const achou = primeiros.some((a) => (p.espera ? eh(a.item, p.espera) : daTela(a.item, p.sobre)));
    expect(achou, `vieram: ${primeiros.map((a) => rotulo(a.item)).join(", ")}`).toBe(true);
  });

  it("\"como eu uso o mcp aqui\" na tela do servidor externo: o manual dela primeiro, citando o MCP da MIA", () => {
    const achados = buscarAjuda({
      pergunta: "como eu uso o mcp aqui",
      papel: "admin",
      telas: telasParaOPapel({ papel: "admin" }),
      base: [],
      caminho: "/app/settings/servidor-mcp-externo",
    });
    expect(achados.tela_atual).toBe("Servidor MCP externo");
    expect(achados.manuais[0]?.id).toBe("servidor-mcp-externo");
    expect(achados.manuais[0]?.desta_tela).toBe(true);
    expect(achados.manuais[0]?.quem_pode).toMatch(/Time Company/);
    expect(achados.manuais[0]?.passos.join(" ")).toMatch(/Testar conexão/);
    expect(achados.manuais[0]?.veja_tambem.map((v) => v.href)).toContain("/app/settings/api-tokens");
    expect(achados.fontes).toContain("Manual do sistema");
    expect(achados.nada_encontrado).toBe(false);
  });

  it("a mesma pergunta em API Tokens traz o MCP da MIA primeiro, com o endereço do navegador, citando o servidor externo", () => {
    const achados = buscarAjuda({
      pergunta: "como eu uso o mcp aqui",
      papel: "admin",
      telas: telasParaOPapel({ papel: "admin" }),
      base: [],
      caminho: "/app/settings/api-tokens",
      enderecoDoSistema: "https://app.iamia.com.br",
    });
    expect(achados.manuais[0]?.id).toBe("mcp-da-mia");
    expect(achados.manuais[0]?.voce_pode).toBe(true);
    expect(achados.manuais[0]?.passos.join(" ")).toContain("https://app.iamia.com.br/api/mcp");
    expect(achados.manuais[0]?.passos.join(" ")).not.toContain("{endereco_do_sistema}");
    expect(achados.manuais[0]?.veja_tambem.map((v) => v.href)).toContain("/app/settings/servidor-mcp-externo");
  });

  it("o MCP da MIA é do administrador: o atendente ouve quem pode", () => {
    const achados = buscarAjuda({
      pergunta: "como ligo o claude no crm pelo mcp",
      papel: "agent",
      telas: telasParaOPapel({ papel: "agent" }),
      base: [],
    });
    const daMia = achados.manuais.find((m) => m.id === "mcp-da-mia" || m.id === "roteiro-ligar-claude");
    expect(daMia?.voce_pode).toBe(false);
    expect(daMia?.quem_pode).toBe("Administrador");
  });

  it("o servidor externo é do dono da instalação: para o administrador da empresa, quem pode é a Time Company", () => {
    const achados = buscarAjuda({
      pergunta: "como uso o servidor mcp externo",
      papel: "admin",
      telas: telasParaOPapel({ papel: "admin" }),
      base: [],
    });
    const externo = achados.manuais.find((m) => m.id === "servidor-mcp-externo");
    expect(externo?.voce_pode).toBe(false);
    expect(externo?.quem_pode).toMatch(/Time Company/);
  });

  it("o trecho do guia volta curto, sem travessão, e o de onde veio diz Guia de operação", () => {
    const achados = buscarAjuda({
      pergunta: "como agendo uma pausa da conexão para manutenção",
      papel: "admin",
      telas: telasParaOPapel({ papel: "admin" }),
      base: [],
    });
    expect(achados.guia.length).toBeGreaterThan(0);
    expect(achados.fontes).toContain("Guia de operação");
    for (const t of achados.guia) {
      expect(t.texto.length).toBeLessThanOrEqual(330);
      expect(t.texto).not.toMatch(/[—–]/);
    }
  });

  it("volta pouco: no máximo 3 manuais, 3 trechos do guia e 3 telas", () => {
    const achados = buscarAjuda({ pergunta: "como configuro o agente", papel: "admin", telas: telasParaOPapel({ papel: "admin" }), base: [] });
    expect(achados.manuais.length).toBeLessThanOrEqual(3);
    expect(achados.guia.length).toBeLessThanOrEqual(3);
    expect(achados.telas.length).toBeLessThanOrEqual(3);
  });

  it("sem acento e sem maiúscula dá o mesmo resultado", () => {
    const a = ajudaEmOrdem("Como configuro o HORÁRIO da IA?", null, 3).map((x) => rotulo(x.item));
    const b = ajudaEmOrdem("como configuro o horario da ia", null, 3).map((x) => rotulo(x.item));
    expect(a).toEqual(b);
  });

  it("toda tela principal do app tem pelo menos uma pergunta aqui", () => {
    const cobertas = new Set(PERGUNTAS.map((p) => p.sobre));
    const sem = telasPrincipais().filter((t) => !cobertas.has(t));
    expect(sem, `telas sem pergunta: ${sem.join(", ")}`).toEqual([]);
  });

  it("todo roteiro tem pelo menos uma pergunta aqui", () => {
    const esperados = new Set(PERGUNTAS.map((p) => p.espera));
    const sem = ROTEIROS.filter((r) => !esperados.has(r.id)).map((r) => r.id);
    expect(sem).toEqual([]);
  });

  it("toda pergunta espera uma ajuda que existe", () => {
    const ids = new Set(MANUAIS.map((m) => m.id));
    const quebradas = PERGUNTAS.filter((p) => p.espera && !ids.has(p.espera)).map((p) => p.espera);
    expect(quebradas).toEqual([]);
  });
});
