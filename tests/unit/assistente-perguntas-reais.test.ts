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
 *
 * FORK MIA (.118, MIA-252): no fim, a RÉGUA do assistente (MIA-239), as 30
 * perguntas fixas com o papel e a tela de cada uma. Aqui entra a parte que
 * não depende do modelo: o manual certo, a ferramenta que lê o dado e a peça
 * que decide sozinha (a lista do nunca, o campo faltando).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Role } from "@/lib/auth/types";
import { normalizar, PRETERITOS_EM_RAM, radical, sinonimosDe, termos } from "@/lib/assistente/busca-da-ajuda";
import { pareceValidacaoDeCampo } from "@/lib/assistente/chamado";
import { buscarAjuda, ajudaEmOrdem, telasDoManual, type FonteDaAjuda } from "@/lib/assistente/leituras/ajuda";
import { MANUAIS } from "@/lib/assistente/manuais";
import { LISTA_DO_NUNCA, type ItemDoNunca } from "@/lib/assistente/nunca";
import { ROTEIROS } from "@/lib/assistente/roteiros";
import { telasParaOPapel } from "@/lib/assistente/telas";

import { hrefsDoCatalogo, rotasDoApp, telasPrincipais } from "./helpers/telas-do-app";

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
  // FORK MIA · coexistência (MIA-28).
  { pergunta: "como conecto o numero que ja uso no app whatsapp business", sobre: "/app/connections", espera: "coexistencia-pelo-app" },
  { pergunta: "a sincronizacao do historico do app nao veio", sobre: "/app/connections", espera: "coexistencia-pelo-app" },
  // FORK MIA · coexistência, o dia a dia (MIA-30).
  { pergunta: "o numero do app whatsapp business saiu do ar na mia", sobre: "/app/connections", espera: "coexistencia-fora-do-ar" },
  { pergunta: "como faço o numero do app voltar", sobre: "/app/connections", espera: "coexistencia-fora-do-ar" },
  { pergunta: "editei uma mensagem no app, muda na mia?", sobre: "/app/connections", espera: "coexistencia-fora-do-ar" },
  { pergunta: "o cliente apagou a mensagem no whatsapp", sobre: "/app/connections", espera: "coexistencia-fora-do-ar" },
  { pergunta: "posso pedir o historico do app de novo", sobre: "/app/connections", espera: "coexistencia-pelo-app" },
  { pergunta: "como configuro o horário da IA", sobre: "/app/ai/agents", espera: "horario-da-ia" },
  { pergunta: "onde vejo as conversões da meta", sobre: "/app/settings/conversoes", espera: "conversoes-meta" },
  { pergunta: "como mando e-mail marketing", sobre: "/app/broadcast", espera: "email-marketing-campanha" },
  { pergunta: "como convido alguém", sobre: "/app/team", espera: "convidar-equipe" },
  // .100 — as telas que o upstream trouxe na v1.89 e na v1.97.
  { pergunta: "onde acho o manual de cada tarefa", sobre: "/app/ajuda", espera: "ajuda-do-menu" },
  { pergunta: "como defino a meta de vendas do mês", sobre: "/app/settings/metas", espera: "meta-de-vendas" },
  // As telas que chegaram na fusão do upstream v1.100 a v1.107.
  { pergunta: "como coloco um cliente na lista de espera", sobre: "/app/agenda/lista-de-espera", espera: "lista-de-espera" },
  { pergunta: "abriu um horario, como ofereco a vaga para quem estava esperando", sobre: "/app/agenda/lista-de-espera", espera: "lista-de-espera" },
  { pergunta: "como crio uma cadencia de e-mail", sobre: "/app/cadencias", espera: "cadencias-de-email" },
  { pergunta: "como monto uma sequencia de e-mails para um segmento", sobre: "/app/cadencias", espera: "cadencias-de-email" },
  { pergunta: "como ligo as cadencias de e-mail na empresa", sobre: "/app/settings/cadencias", espera: "cadencias-ligar" },
  { pergunta: "como ligo para uma lista de leads um por vez", sobre: "/app/cold-call", espera: "cold-call" },
  { pergunta: "como marco que o lead nao atendeu no cold call", sobre: "/app/cold-call", espera: "cold-call" },
  { pergunta: "onde vejo as reclamacoes que chegaram pela ouvidoria", sobre: "/app/ouvidoria", espera: "ouvidoria" },
  { pergunta: "como mudo o status de uma manifestacao", sobre: "/app/ouvidoria", espera: "ouvidoria" },
  { pergunta: "onde vejo quem esta esperando atendimento em cada numero", sobre: "/app/painel", espera: "painel-de-atendimento" },

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
  // FORK MIA (.97): o filtro inteiro, sem o teto de 100.
  { pergunta: "como etiqueto todos os contatos de uma vez", sobre: "/app/contacts", espera: "contatos-em-massa" },
  { pergunta: "como seleciono todos os contatos do filtro", sobre: "/app/contacts", espera: "contatos-em-massa" },
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
  // FORK MIA (.97): a conferência que diz por que a lista ficou vazia.
  { pergunta: "por que meu disparo deu 0 destinatários", sobre: "/app/broadcast", espera: "broadcast-oficial" },
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
  // FORK MIA (fusão da v1.124): o painel de vendas do upstream.
  { pergunta: "quanto eu vendi este mês", sobre: "/app/vendas", espera: "painel-de-vendas" },
  { pergunta: "como exporto um relatório para excel", sobre: "/app/relatorios", espera: "exportar-relatorio" },
  { pergunta: "onde vejo o custo das campanhas de anúncio", sobre: "/app/ads/meta" },
  { pergunta: "quantos negócios vieram do google ads", sobre: "/app/ads/google", espera: "painel-google-ads" },
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
  // Tela que chegou na fusão do upstream 1.125 (#5128).
  { pergunta: "como escondo o tiktok da ficha do contato", sobre: "/app/settings/links-de-contato", espera: "tipos-de-link-do-contato" },
  // Telas que chegaram na fusão do upstream 1.108 a 1.116.
  { pergunta: "como conecto o amigo da clínica", sobre: "/app/integrations/amigo", espera: "integracao-amigo" },
  { pergunta: "como mudo o visual do sistema para a equipe", sobre: "/app/settings/aparencia", espera: "aparencia" },
  { pergunta: "como crio uma organização cliente da agência", sobre: "/app/settings/organizacoes", espera: "organizacoes-da-agencia" },
  { pergunta: "como mudo os dados da empresa e a moeda", sobre: "/app/settings/tenant", espera: "organizacao" },
  { pergunta: "como devolvo as vendas para o google ads", sobre: "/app/settings/conversoes", espera: "conversoes-google" },
  { pergunta: "a meta não está recebendo as conversões, como confiro", sobre: "/app/settings/conversoes", espera: "conversoes-conferir" },
  { pergunta: "como conecto a conta de anúncios da meta", sobre: "/app/settings/meta-ads", espera: "conectar-meta-ads" },
  { pergunta: "os leads do formulário do facebook não chegam no funil", sobre: "/app/settings/leads-da-meta", espera: "leads-formulario-meta" },
  { pergunta: "como uso isso aqui", em: "/app/settings/leads-da-meta", sobre: "/app/settings/leads-da-meta", espera: "leads-formulario-meta" },
  { pergunta: "como mudo a logo e a cor da marca", sobre: "/app/settings/marca", espera: "marca" },
  { pergunta: "como pago a fatura da mensalidade", sobre: "/app/settings/billing", espera: "plano-e-cobranca" },
  // .95: o preço do e-mail por plano e a entrada paga ainda não paga
  { pergunta: "quanto custa cada e-mail do e-mail marketing", sobre: "/app/settings/email-marketing", espera: "email-marketing-configurar" },
  { pergunta: "qual o preço por e-mail no meu plano", sobre: "/app/settings/billing", espera: "plano-e-cobranca" },
  { pergunta: "assinei o plano e a conta está esperando o primeiro pagamento", sobre: "/app/settings/billing", espera: "plano-e-cobranca" },
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
  // FORK MIA (.117): a tela nova do upstream, Follow-up por etapa.
  { pergunta: "como mudo quantos dias o negócio fica parado na etapa antes do follow-up", sobre: "/app/settings/followup-por-etapa", espera: "followup-por-etapa" },
  // FORK MIA (.118, MIA-252): o Claude escrito errado, o "chat gpt", os leads que chegaram e as vendas por pessoa.
  { pergunta: "como ligo o clode no crm", sobre: "/app/settings/api-tokens", espera: "roteiro-ligar-claude" },
  { pergunta: "como conecto o claud", sobre: "/app/settings/api-tokens", espera: "roteiro-ligar-claude" },
  { pergunta: "da pra usar o chat gpt no sistema?", sobre: "/app/settings/api-tokens", espera: "mcp-e-ia-de-fora" },
  { pergunta: "da para usar o gpt com o crm", sobre: "/app/settings/api-tokens", espera: "mcp-e-ia-de-fora" },
  { pergunta: "onde vejo os leads novos", sobre: "/app/kanban", espera: "leads-que-chegaram" },
  { pergunta: "quantos leads entraram essa semana", sobre: "/app/kanban", espera: "leads-que-chegaram" },
  { pergunta: "onde vejo as vendas por vendedor", sobre: "/app/relatorios", espera: "vendas-por-vendedor" },
  { pergunta: "onde vejo o ranking de vendas da equipe", sobre: "/app/relatorios", espera: "vendas-por-vendedor" },
  // FORK MIA (.119): as telas novas do upstream, Operação do dia, Relatórios do dia e Serviços.
  { pergunta: "como vejo quem está aguardando uma pessoa hoje", sobre: "/app/operacao", espera: "operacao-do-dia" },
  { pergunta: "como mudo a hora do relatório diário", sobre: "/app/operacao/relatorios", espera: "relatorios-do-dia" },
  { pergunta: "como cadastro um serviço com sinal e prazo", sobre: "/app/servicos", espera: "servicos" },
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

// ─── A régua do assistente (MIA-239, plano do Arquiteto na MIA-245) ─────────

type AreaDaRegua = "rotina" | "numeros" | "como-fazer" | "onde-fica" | "permissao" | "nunca" | "erro";

interface PerguntaDaRegua {
  n: number;
  papel: Role;
  /** A tela em que a pessoa estava. */
  em: string;
  pergunta: string;
  area: AreaDaRegua;
  /** Como fazer e onde fica: o manual (qualquer um destes) entre os 3 primeiros. */
  manual?: readonly string[];
  /** O manual da lista tem de vir em PRIMEIRO: o assistente responde pelo primeiro. */
  primeiro?: true;
  /** Rotina e números: a ferramenta do assistente que lê o dado. */
  ferramentas?: readonly string[];
  /** O pedido da lista do nunca. */
  nunca?: ItemDoNunca["id"];
  /** O que ainda falta para a pergunta ter resposta sem o modelo, com a tarefa. Entra como pendente. */
  falta?: string;
}

/**
 * As 30 perguntas fixas. Dado fictício. A "resposta certa em uma linha" de cada
 * uma está no plano (MIA-239); aqui fica o que se confere sem IA.
 */
const REGUA: readonly PerguntaDaRegua[] = [
  // Rotina
  { n: 1, papel: "agent", em: "/app/inicio", area: "rotina", pergunta: "Como está minha rotina hoje?", ferramentas: ["ver_minha_rotina"] },
  { n: 2, papel: "manager", em: "/app/inicio", area: "rotina", pergunta: "Por onde eu começo hoje?", ferramentas: ["ver_prioridades"] },
  { n: 3, papel: "agent", em: "/app/tasks", area: "rotina", pergunta: "Quantas tarefas eu concluí hoje?", ferramentas: ["ver_minha_rotina"], falta: "as tarefas concluídas na leitura da rotina (MIA-244)" },
  { n: 4, papel: "agent", em: "/app/inbox", area: "rotina", pergunta: "Tenho cliente esperando resposta?", ferramentas: ["ver_minha_rotina"] },
  // Números, período e funil
  { n: 5, papel: "manager", em: "/app/inicio", area: "numeros", pergunta: "Quantos leads chegaram hoje?", ferramentas: ["ver_meus_leads"], falta: "o período na leitura dos leads (MIA-244)" },
  { n: 6, papel: "manager", em: "/app/crm", area: "numeros", pergunta: "Quantos leads entraram no fim de semana no funil Comercial?", ferramentas: ["ver_meus_leads"], falta: "o período e o funil na leitura dos leads (MIA-244)" },
  { n: 7, papel: "admin", em: "/app/inicio", area: "numeros", pergunta: "Quantos leads novos chegaram na semana passada e de onde vieram?", ferramentas: ["ver_meus_leads"], falta: "o período livre e a origem na leitura dos leads (MIA-244)" },
  { n: 8, papel: "manager", em: "/app/inicio", area: "numeros", pergunta: "Quanto a equipe vendeu este mês comparado com o mês passado?", ferramentas: ["ver_numeros_da_equipe"] },
  { n: 9, papel: "agent", em: "/app/inicio", area: "numeros", pergunta: "Qual foi a minha taxa de ganho de 1 a 15 de outubro?", ferramentas: ["ver_minha_performance"] },
  { n: 10, papel: "manager", em: "/app/crm", area: "numeros", pergunta: "Quantos negócios estão na etapa Proposta do funil Comercial?", falta: "a contagem por etapa, pela ponte de leitura do MCP (PR E, .119)" },
  { n: 11, papel: "agent", em: "/app/crm", area: "numeros", pergunta: "Quais negócios meus estão em risco?", ferramentas: ["ver_meus_leads"], falta: "o Radar pela sessão na leitura dos leads (MIA-244)" },
  { n: 12, papel: "agent", em: "/app/inicio", area: "numeros", pergunta: "Estou perto da minha meta do mês?", ferramentas: ["ver_minha_performance"] },
  { n: 13, papel: "agent", em: "/app/agenda", area: "numeros", pergunta: "Quantos agendamentos eu tenho amanhã?", falta: "a agenda de outro dia, pela ponte de leitura do MCP (PR E, .119)" },
  { n: 14, papel: "agent", em: "/app/inbox", area: "numeros", pergunta: "Por que a IA não respondeu a Ana Exemplo?", ferramentas: ["ver_por_que_a_ia_nao_respondeu"] },
  // Como fazer
  { n: 15, papel: "admin", em: "/app/ai/agents", area: "como-fazer", pergunta: "Como configuro o horário da IA?", manual: ["horario-da-ia"], primeiro: true },
  { n: 16, papel: "agent", em: "/app/crm", area: "como-fazer", pergunta: "Como marco um negócio como perdido?", manual: ["marcar-perdido"], primeiro: true },
  { n: 17, papel: "manager", em: "/app/contacts", area: "como-fazer", pergunta: "Como importo a planilha da Lista de Outubro com os contatos?", manual: ["importar-contatos"], primeiro: true },
  { n: 18, papel: "manager", em: "/app/contacts", area: "como-fazer", pergunta: "Como coloco a etiqueta Lista de Outubro em vários contatos de uma vez?", manual: ["contatos-em-massa"], primeiro: true },
  { n: 19, papel: "manager", em: "/app/inicio", area: "como-fazer", pergunta: "Como faço a IA chamar de novo quem parou de responder?", manual: ["followup"], primeiro: true },
  { n: 20, papel: "admin", em: "/app/inicio", area: "como-fazer", pergunta: "Como ligo o cloude no sistema?", manual: ["roteiro-ligar-claude", "mcp-da-mia", "mcp-e-ia-de-fora"], primeiro: true },
  { n: 21, papel: "admin", em: "/app/inicio", area: "como-fazer", pergunta: "O sistema tem MCP?", manual: ["mcp-da-mia", "mcp-e-ia-de-fora"], primeiro: true },
  { n: 22, papel: "agent", em: "/app/inbox", area: "como-fazer", pergunta: "Como crio uma resposta rápida?", manual: ["respostas-rapidas"], primeiro: true },
  // Onde fica
  { n: 23, papel: "agent", em: "/app/inicio", area: "onde-fica", pergunta: "Onde vejo os leads que chegaram?", manual: ["leads-que-chegaram", "abrir-funil"], primeiro: true },
  { n: 24, papel: "manager", em: "/app/inicio", area: "onde-fica", pergunta: "Onde vejo quanto cada vendedor vendeu?", manual: ["vendas-por-vendedor", "painel-de-vendas", "relatorios"], primeiro: true },
  { n: 25, papel: "admin", em: "/app/inicio", area: "onde-fica", pergunta: "Onde acompanho se a IA está vendendo?", manual: ["roteiro-ia-vendendo"], primeiro: true },
  // Permissão
  { n: 26, papel: "agent", em: "/app/inicio", area: "permissao", pergunta: "Quanto o Bruno Teste vendeu este mês?", ferramentas: ["ver_numeros_da_equipe", "oferecer_pedir_a_pessoa"] },
  { n: 27, papel: "agent", em: "/app/inicio", area: "permissao", pergunta: "Como convido a Ana Exemplo para a equipe?", manual: ["convidar-equipe"], primeiro: true },
  // O "nunca"
  { n: 28, papel: "manager", em: "/app/ai/agents", area: "nunca", pergunta: "Publica o agente de vendas da Academia Alfa pra mim.", nunca: "publicar", ferramentas: ["mostrar_me_leva_la"] },
  { n: 29, papel: "agent", em: "/app/inbox", area: "nunca", pergunta: "Manda uma mensagem para a Ana Exemplo no +55 31 900000002 dizendo que a aula mudou para as 19h.", nunca: "mensagem" },
  // Erro
  { n: 30, papel: "agent", em: "/app/contacts", area: "erro", pergunta: "Fui salvar o contato e apareceu \"Telefone é obrigatório\". É erro do sistema?", ferramentas: ["preparar_chamado"] },
];

/** As ferramentas do assistente, pelo nome, lidas da fonte (sem montar o turno). */
function nomesDasFerramentas(): Set<string> {
  const fonte = readFileSync(join(process.cwd(), "lib/assistente/ferramentas.ts"), "utf8");
  return new Set([...fonte.matchAll(/^ {4}([a-z_]+): tool\(/gm)].map((m) => m[1] ?? ""));
}

const nomeDaRegua = (p: PerguntaDaRegua) => `${p.n}. ${p.pergunta} (${p.papel}, em ${p.em})`;

describe("a régua do assistente: as 30 perguntas, com o papel e a tela", () => {
  it("são 30, de 1 a 30, cada uma numa tela que existe e com o que conferir", () => {
    expect(REGUA.map((p) => p.n)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    const telas = new Set([...rotasDoApp(), ...hrefsDoCatalogo()]);
    for (const p of REGUA) {
      expect(telas.has(p.em), nomeDaRegua(p)).toBe(true);
      expect(Boolean(p.manual || p.ferramentas || p.nunca || p.falta), nomeDaRegua(p)).toBe(true);
    }
  });

  it("todo manual que a régua espera existe", () => {
    const ids = new Set(MANUAIS.map((m) => m.id));
    expect(REGUA.flatMap((p) => p.manual ?? []).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("como fazer e onde fica (15 a 25) não têm nada faltando", () => {
    const pendentes = REGUA.filter((p) => (p.area === "como-fazer" || p.area === "onde-fica") && p.falta).map(nomeDaRegua);
    expect(pendentes).toEqual([]);
  });

  const comManual = REGUA.filter((p) => p.manual && !p.falta);
  it.each(comManual.map((p) => [nomeDaRegua(p), p] as const))("%s: o manual certo entre os 3 primeiros", (_nome, p) => {
    const primeiros = ajudaEmOrdem(p.pergunta, p.em, ENTRE_OS_PRIMEIROS, p.papel);
    const achou = primeiros.some((a) => p.manual?.some((id) => eh(a.item, id)));
    expect(achou, `vieram: ${primeiros.map((a) => rotulo(a.item)).join(", ")}`).toBe(true);
  });

  const emPrimeiro = REGUA.filter((p) => p.primeiro && !p.falta);
  it.each(emPrimeiro.map((p) => [nomeDaRegua(p), p] as const))("%s: o primeiro manual que o turno recebe é o certo", (_nome, p) => {
    const achados = buscarAjuda({ pergunta: p.pergunta, papel: p.papel, telas: telasParaOPapel({ papel: p.papel }), base: [], caminho: p.em });
    expect(p.manual, achados.manuais.map((m) => m.id).join(", ")).toContain(achados.manuais[0]?.id);
  });

  const comFerramenta = REGUA.filter((p) => p.ferramentas && !p.falta);
  it.each(comFerramenta.map((p) => [nomeDaRegua(p), p] as const))("%s: a ferramenta que lê o dado existe", (_nome, p) => {
    const nomes = nomesDasFerramentas();
    for (const f of p.ferramentas ?? []) expect(nomes.has(f), f).toBe(true);
  });

  for (const p of REGUA.filter((x) => x.falta)) it.todo(`${nomeDaRegua(p)}: falta ${p.falta}`);

  it("27: o atendente acha o convite, ouve que não é com ele e quem pode", () => {
    const achados = buscarAjuda({ pergunta: REGUA.find((p) => p.n === 27)?.pergunta ?? "", papel: "agent", telas: telasParaOPapel({ papel: "agent" }), base: [], caminho: "/app/inicio" });
    expect(achados.manuais[0]?.id).toBe("convidar-equipe");
    expect(achados.manuais[0]?.voce_pode).toBe(false);
    expect(achados.manuais[0]?.quem_pode).toBe("Administrador");
  });

  it("28 e 29: publicar o agente e mandar mensagem a cliente estão na lista do nunca, com a tela", () => {
    for (const p of REGUA.filter((x) => x.nunca)) {
      const item = LISTA_DO_NUNCA.find((n) => n.id === p.nunca);
      expect(item, nomeDaRegua(p)).toBeDefined();
      expect(item?.href.startsWith("/app/"), nomeDaRegua(p)).toBe(true);
    }
    expect(LISTA_DO_NUNCA.find((n) => n.id === "publicar")?.href).toBe("/app/ai/agents");
  });

  it("30: \"Telefone é obrigatório\" é campo faltando, não erro do sistema", () => {
    expect(pareceValidacaoDeCampo({ mensagem: "Telefone é obrigatório", status: 422 })).toBe(true);
    expect(pareceValidacaoDeCampo({ mensagem: "Telefone é obrigatório" })).toBe(true);
  });
});

describe("K1: o erro de digitação e as expressões que só dizem algo juntas", () => {
  it("cloude, claud, clode e claude são o mesmo termo; chat gpt é chatgpt", () => {
    for (const x of ["cloude", "claud", "clode", "Claude"]) expect(termos(`ligar o ${x}`), x).toEqual(termos("ligar o claude"));
    expect(normalizar("Chat GPT")).toBe("chatgpt");
    expect(normalizar("chat-gpt")).toBe("chatgpt");
  });

  it("gpt e chatgpt estão no grupo do Claude e do MCP", () => {
    const claude = radical(normalizar("claude"));
    expect(sinonimosDe(radical("gpt"))).toContain(claude);
    expect(sinonimosDe(radical("chatgpt"))).toContain(radical("mcp"));
  });

  it("chegaram, entraram e novos, junto de lead, viram o lead que chegou; sozinhos, não", () => {
    const chegou = termos("leads que chegaram").filter((t) => t !== radical("lead"));
    expect(chegou).toHaveLength(1);
    for (const x of ["leads novos", "novos leads", "lead novo", "leads que entraram", "os leads que chegou", "leads chegando"]) {
      expect(termos(x), x).toContain(chegou[0]);
      expect(termos(x), x).toContain(radical("lead"));
    }
    expect(termos("contratei um vendedor novo")).not.toContain(chegou[0]);
    expect(termos("novo relatório")).not.toContain(chegou[0]);
  });

  it("cada vendedor e por vendedor são o mesmo termo, que casa com vendas e ranking", () => {
    expect(termos("quanto cada vendedor vendeu")).toEqual(expect.arrayContaining(termos("vendas por vendedor").filter((t) => t !== radical("venda"))));
    const porVendedor = termos("cada vendedor")[0] ?? "";
    expect(termos("por vendedores")).toEqual([porVendedor]);
    expect(sinonimosDe(porVendedor)).toEqual(expect.arrayContaining([radical("ranking"), radical("venda")]));
    // "vendedor" sozinho continua sendo a pessoa da equipe.
    expect(termos("contratei um vendedor novo")).toContain(radical("vendedor"));
  });
});

describe("K2: no empate, vem antes o que a pessoa pode fazer", () => {
  it("\"o sistema tem MCP?\" de um administrador no Início: o MCP da MIA, não o servidor externo", () => {
    const achados = buscarAjuda({ pergunta: "O sistema tem MCP?", papel: "admin", telas: telasParaOPapel({ papel: "admin" }), base: [], caminho: "/app/inicio" });
    expect(achados.manuais[0]?.id).not.toBe("servidor-mcp-externo");
    expect(achados.manuais[0]?.voce_pode).toBe(true);
    // O externo continua na lista, para a resposta citar o outro sentido.
    expect(achados.manuais.map((m) => m.id)).toContain("servidor-mcp-externo");
  });

  it("do atendente: o que outro papel da empresa faz vem antes do que só o dono da instalação faz", () => {
    const achados = buscarAjuda({ pergunta: "O sistema tem MCP?", papel: "agent", telas: telasParaOPapel({ papel: "agent" }), base: [], caminho: "/app/inicio" });
    expect(achados.manuais[0]?.id).not.toBe("servidor-mcp-externo");
    expect(achados.manuais[0]?.quem_pode).toBe("Administrador");
  });

  it("na tela do servidor externo, com \"aqui\", a ordem não muda: o manual da tela primeiro", () => {
    const achados = buscarAjuda({ pergunta: "como eu uso o mcp aqui", papel: "admin", telas: telasParaOPapel({ papel: "admin" }), base: [], caminho: "/app/settings/servidor-mcp-externo" });
    expect(achados.manuais[0]?.id).toBe("servidor-mcp-externo");
  });

  it("o desempate não passa à frente o manual que casa melhor: o atendente ouve o do horário da IA", () => {
    const achados = buscarAjuda({ pergunta: "Como configuro o horário da IA?", papel: "agent", telas: telasParaOPapel({ papel: "agent" }), base: [] });
    expect(achados.manuais[0]?.id).toBe("horario-da-ia");
    expect(achados.manuais[0]?.voce_pode).toBe(false);
  });
});

/** Todas as palavras que os manuais e roteiros usam, já normalizadas. */
function vocabularioDosManuais(): Set<string> {
  const palavras = new Set<string>();
  for (const m of [...MANUAIS, ...ROTEIROS]) {
    const texto = [m.titulo, ...m.palavras, ...m.passos, m.observacao ?? ""].join(" ");
    for (const p of normalizar(texto).split(/[^a-z0-9]+/)) if (p.length >= 3) palavras.add(p);
  }
  return palavras;
}

describe("K3: o pretérito em \"-ram\" não estraga o presente dos verbos em \"-ar\"", () => {
  it("esperam, preparam, separam, disparam e declaram ficam no radical de espera, prepara, separa, dispara e declara", () => {
    for (const [presente, base] of [
      ["esperam", "espera"],
      ["preparam", "prepara"],
      ["separam", "separa"],
      ["disparam", "dispara"],
      ["declaram", "declara"],
      ["comparam", "compara"],
    ]) {
      expect(termos(presente), presente).toEqual(termos(base));
      expect(termos(presente), presente).toEqual(termos(base.replace(/a$/, "ar")));
    }
    // A frase do manual dos leads que chegaram ainda casa com "espera" e "esperando".
    expect(termos("ainda esperam alguém assumir")).toEqual(expect.arrayContaining(termos("espera")));
    expect(termos("esperando")).toEqual(termos("esperam"));
  });

  it("o pretérito da lista cai no radical do infinitivo: chegaram casa com chegar", () => {
    for (const p of PRETERITOS_EM_RAM) {
      expect(radical(p).length, p).toBeGreaterThanOrEqual(3);
      expect(radical(p), p).toBe(radical(`${p.slice(0, -3)}r`));
    }
    expect(termos("as mensagens que chegaram ontem")).toEqual(expect.arrayContaining(termos("chegar")));
  });

  it("no vocabulário dos manuais, toda palavra em \"-am\" fora da lista fica no radical da forma em \"-a\"", () => {
    const fora: string[] = [];
    for (const p of vocabularioDosManuais()) {
      if (!p.endsWith("am") || PRETERITOS_EM_RAM.has(p)) continue;
      if (radical(p) !== radical(p.slice(0, -1))) fora.push(`${p}: ${radical(p)} × ${radical(p.slice(0, -1))}`);
    }
    expect(fora).toEqual([]);
  });
});
