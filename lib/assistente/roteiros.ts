/**
 * FORK MIA (.89) — OS ROTEIROS: as tarefas que cruzam telas.
 *
 * O manual de uma tela responde "como faço isto aqui". A pergunta do dia a dia
 * muitas vezes é maior: "como coloco um cliente novo para atender", "como faço
 * uma campanha", "como vejo se a IA está vendendo", "como ligo o Claude no
 * CRM". Cada roteiro diz a ordem das telas, curto, e aponta para a primeira
 * (o "Me leva lá"); as outras vão em `telas`, para a busca achar o roteiro de
 * dentro de qualquer uma delas.
 *
 * A mesma regra de `manuais.ts`: só o que existe, com o nome que a tela usa;
 * texto simples, sem jargão e sem travessão. Módulo PURO.
 */
import type { Manual } from "./manuais";

export const ROTEIROS: readonly Manual[] = [
  {
    id: "roteiro-comecar-a-atender",
    tipo: "roteiro",
    titulo: "Começar a atender: número, funil, agente, follow-up e equipe",
    palavras: [
      "cliente novo", "comecar a atender", "colocar para atender", "implantar", "primeiros passos", "configurar tudo",
      "por onde comeco", "montar o atendimento", "ia atender", "ligar a ia", "comecar",
    ],
    href: "/app/connections",
    telas: ["/app/settings/tenant/pipelines", "/app/ai/agents", "/app/ai/followups", "/app/team", "/app/settings/atendimento"],
    papelMinimo: "admin",
    passos: [
      "1. Número: em Conexões, use Conectar novo WhatsApp e leia o QR Code com o celular do número.",
      "2. Funil: em Etapas do funil, crie o funil (Novo funil) com as etapas do seu jeito de vender e os motivos de perda.",
      "3. Agente: em Agentes, use Novo agente (ou abra o que já existe). Preencha Quem é este agente, As instruções dele, Por qual número ele atende, O que o agente pode fazer e Passar para uma pessoa. Teste no botão Teste, salve e publique.",
      "4. Follow-up: em Follow-ups, use Novo fluxo de follow-up (dá para Começar de um modelo) e ligue o fluxo no agente.",
      "5. Equipe: em Equipe, use Convidar membros, e em Distribuição de atendimento diga quem recebe cada cliente novo.",
      "6. Se quiser, ajuste o Horário de atendimento da IA no agente.",
    ],
    observacao: "Na MIA, a Time Company costuma montar a primeira implantação junto com a empresa. A inteligência do agente (modelo e chave) já vem da plataforma.",
  },
  {
    id: "roteiro-campanha",
    tipo: "roteiro",
    titulo: "Fazer uma campanha: WhatsApp, e-mail ou anúncio",
    palavras: ["campanha", "fazer uma campanha", "disparo", "disparar para todos", "mandar para a base", "promocao", "divulgar"],
    href: "/app/broadcast",
    telas: ["/app/settings/email-marketing", "/app/settings/carteira", "/app/ads/meta"],
    papelMinimo: "manager",
    passos: [
      "1. Abra Broadcast e use Novo disparo. Escolha o caminho: Número oficial (Meta), Número por QR ou E-mail.",
      "2. Número oficial: escolha o Template aprovado, monte o público por funil, etapa e etiqueta, confira a lista e dispare. Cada mensagem gasta crédito (veja em Créditos).",
      "3. Número por QR: texto livre, sem custo por mensagem, no ritmo do número.",
      "4. E-mail: o domínio precisa estar verificado em E-mail marketing; monte público, mensagem e envio nas abas da campanha.",
      "5. Anúncio na Meta ou no Google: a campanha é criada no gerenciador de anúncios; aqui você acompanha em Meta Ads e devolve as vendas em Conversões.",
    ],
    observacao: "Nada sai antes da conferência da lista. Para escrever o modelo do número oficial, use Conexões, aba API Oficial (Meta), Templates da Meta.",
  },
  {
    id: "roteiro-ia-vendendo",
    tipo: "roteiro",
    titulo: "Ver se a IA está vendendo",
    palavras: [
      "ia esta vendendo", "a ia vende", "resultado da ia", "o agente esta funcionando", "quanto a ia fechou",
      "desempenho da ia", "vale a pena", "retorno da ia", "ia converte",
    ],
    href: "/app/paineis",
    telas: ["/app/paineis/funil", "/app/ai/evolution", "/app/ai/cases", "/app/metrics", "/app/relatorios"],
    papelMinimo: "viewer",
    passos: [
      "1. Painéis prontos: veja Atendimento: agente e equipe (quanto o agente atendeu e passou adiante), Resultado do mês e De onde vêm.",
      "2. Análise do funil: em De onde vêm os que fecham e Conversão etapa a etapa você vê onde os negócios andam e onde param.",
      "3. Casos: os atendimentos que o agente conduziu, do início ao desfecho.",
      "4. Evolução da IA (gerente e administrador): o que o agente aprendeu, o que mudou no resultado e o que está travando.",
      "5. Para um corte do seu jeito, monte em Relatórios um relatório com a fonte Atendimento ou Negócios.",
    ],
    observacao: "Pergunte também aqui: \"como está minha performance no mês?\" ou \"como estão meus leads?\" trazem os números na hora.",
  },
  {
    id: "roteiro-ligar-claude",
    tipo: "roteiro",
    titulo: "Ligar o Claude (ou outra IA) no CRM",
    palavras: ["ligar o claude", "claude no crm", "chatgpt no crm", "conectar claude", "ia de fora", "mcp", "claude desktop", "claude code"],
    href: "/app/settings/api-tokens",
    papelMinimo: "admin",
    passos: [
      "1. Em Configurações › API Tokens, use Criar token, dê um Nome e marque Agentes de IA podem LER o CRM (MCP) e, para agir, Agentes de IA podem AGIR no CRM (MCP).",
      "2. Clique em Criar e copie o token na hora: ele aparece uma vez só.",
      "3. No Claude, adicione um conector MCP personalizado com o endereço {endereco_do_sistema}/api/mcp e o token como chave de acesso (Authorization: Bearer e o token).",
      "4. Pergunte ao Claude algo como \"liste meus negócios abertos\" para conferir.",
    ],
    observacao: "Só o administrador cria token, e o token enxerga só esta empresa. Para desligar, use Revogar em API Tokens. O contrário, a IA da MIA consultar um sistema seu, é o Servidor MCP externo.",
    vejaTambem: ["servidor-mcp-externo"],
  },
  {
    id: "roteiro-anuncio-ate-a-venda",
    tipo: "roteiro",
    titulo: "Do anúncio à venda: ligar a Meta de ponta a ponta",
    palavras: ["anuncio", "meta", "facebook", "instagram", "trafego pago", "lead de anuncio", "ligar a meta", "integrar meta"],
    href: "/app/settings/meta-ads",
    telas: ["/app/settings/conversoes", "/app/ads/meta"],
    papelMinimo: "admin",
    passos: [
      "1. Em Configurações › Meta Ads, aba Contas de anúncio, cole o token para ler o desempenho das campanhas.",
      "2. Na aba Formulários de leads, ligue a importação para os leads de cadastro instantâneo caírem no funil.",
      "3. Em Configurações › Conversões, conecte o conjunto de dados e escolha o que cada etapa do funil avisa à Meta, para o anúncio aprender quem vira cliente.",
      "4. Acompanhe o custo por resultado em Meta Ads, no MIA Insights.",
    ],
  },
  {
    id: "roteiro-avisos-no-celular",
    tipo: "roteiro",
    titulo: "Receber os avisos do sistema no celular",
    palavras: ["aviso no celular", "notificacao no celular", "receber aviso", "push", "alerta no celular"],
    href: "/app/settings/aplicativo",
    telas: ["/app/settings/notifications", "/app/agenda/avisos", "/app/ai/cases/avisos"],
    papelMinimo: "viewer",
    passos: [
      "1. Instale o sistema no celular em Configurações › App no celular.",
      "2. Em Notificações, ligue os avisos neste aparelho e escolha sobre o que quer ser avisado.",
      "3. O administrador também pode receber no WhatsApp os agendamentos (Aviso de agendamento) e os casos que a IA abre (Aviso no WhatsApp).",
    ],
  },
  {
    id: "roteiro-novo-vendedor",
    tipo: "roteiro",
    titulo: "Colocar um vendedor novo para atender",
    palavras: ["vendedor novo", "novo atendente", "novo funcionario", "colocar vendedor", "dar acesso", "novo usuario"],
    href: "/app/team",
    telas: ["/app/settings/atendimento"],
    papelMinimo: "admin",
    passos: [
      "1. Em Equipe, use Convidar membros, informe o e-mail e escolha o Papel (Atendente para quem só atende).",
      "2. Em Distribuição de atendimento, inclua a pessoa em quem recebe o cliente novo e nos Responsáveis por número.",
      "3. Peça para a pessoa abrir o convite, entrar e instalar o sistema no celular.",
    ],
    observacao: "O convite vale 15 dias. O atendente vê os próprios negócios e conversas; gerente e administrador veem a equipe.",
  },
  {
    id: "roteiro-pausar-a-ia",
    tipo: "roteiro",
    titulo: "Pausar a IA (numa conversa, num horário ou de vez)",
    palavras: ["pausar a ia", "desligar a ia", "parar o robo", "ia parar de responder", "desligar o agente", "calar a ia"],
    href: "/app/inbox",
    telas: ["/app/ai/agents"],
    papelMinimo: "agent",
    passos: [
      "1. Numa conversa: no Inbox, use Assumir. A IA fica calada até alguém usar Devolver ao automático.",
      "2. Num horário: em Agentes, ajuste o Horário de atendimento da IA e publique.",
      "3. De vez: em Agentes, o administrador pausa o agente. As conversas novas ficam com a equipe.",
    ],
    observacao: "Pelo celular do número, #off pausa e #on devolve, se o agente aceitar comandos pelo celular.",
  },
];
