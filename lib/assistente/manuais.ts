/**
 * FORK MIA (.88) — OS MANUAIS DO SISTEMA que o assistente usa no "como faço".
 *
 * O mapa das telas (`telas.ts`) responde ONDE fica. Isto responde COMO: os
 * passos de cada configuração e operação que mais se pergunta, na versão que
 * está no ar. Cada manual aponta para uma tela do catálogo de navegação (o
 * "Me leva lá"), e `tests/unit/assistente-manuais.test.ts` reprova manual que
 * aponte para tela que não existe mais.
 *
 * Mora no código, e não em `docs/`, por dois motivos medidos: a imagem do app
 * não carrega a pasta `docs/`, e o passo a passo muda junto com a tela que ele
 * descreve, no mesmo commit.
 *
 * ⚠️ Regra de escrita: só passo que existe na tela, com o nome que a tela usa.
 * Na dúvida, o manual diz a tela e o objetivo, e não inventa o botão.
 *
 * Módulo PURO.
 */
import type { Role } from "@/lib/auth/types";

export interface Manual {
  id: string;
  titulo: string;
  /** Palavras que alguém usaria para perguntar isto. */
  palavras: string[];
  /** A tela do catálogo onde se faz. */
  href: string;
  /** Quem consegue fazer (o assistente explica a todos e diz quem pode). */
  papelMinimo: Role;
  passos: string[];
  /** O cuidado que vale dizer junto. */
  observacao?: string;
}

export const MANUAIS: readonly Manual[] = [
  {
    id: "horario-da-ia",
    titulo: "Horário de atendimento da IA",
    palavras: ["horario", "hora", "expediente", "noite", "fim de semana", "ativa", "inativa", "ia responde"],
    href: "/app/ai/agents",
    papelMinimo: "admin",
    passos: [
      "Abra Agentes (no grupo Agente MIA) e escolha o agente.",
      "Vá até Horário de atendimento da IA.",
      "Escolha Ativa só no horário abaixo e monte as faixas de cada dia.",
      "Clique em Publicar. O horário vale a partir da publicação.",
    ],
    observacao:
      "Fora do horário a IA fica inativa: não responde o que chegar, nem depois, e a conversa fica com a equipe. Se a IA ficar ativa de madrugada, a tela avisa da janela de resposta do número.",
  },
  {
    id: "conectar-numero",
    titulo: "Conectar um número de WhatsApp",
    palavras: ["conectar", "numero", "whatsapp", "qr", "code", "oficial", "conexao", "celular"],
    href: "/app/connections",
    papelMinimo: "admin",
    passos: [
      "Abra Conexões.",
      "Use Conectar novo WhatsApp.",
      "Escolha o número por QR Code (o WhatsApp do celular) ou o número oficial da Meta.",
      "No QR Code, leia o código com o WhatsApp do celular em Aparelhos conectados.",
    ],
    observacao: "Só o administrador conecta número.",
  },
  {
    id: "numero-desconectado",
    titulo: "Número desconectado",
    palavras: ["desconectado", "caiu", "parou", "numero", "reconectar", "qr"],
    href: "/app/connections",
    papelMinimo: "admin",
    passos: [
      "Abra Conexões e veja qual número está desconectado.",
      "Use Conectar de novo e leia o QR Code com o celular do número.",
    ],
    observacao: "Enquanto o número está desconectado, nada que chega por ele é visto, e a IA não responde.",
  },
  {
    id: "conversas-da-equipe",
    titulo: "Ver as conversas que a IA passou para a equipe",
    palavras: ["passou", "equipe", "fila", "humano", "pessoa", "esperando", "transferiu"],
    href: "/app/inbox",
    papelMinimo: "agent",
    passos: [
      "Abra o Inbox e use a aba Fila: são as conversas que esperam uma pessoa.",
      "Os avisos de cada passagem, com o motivo, ficam em Alertas, a Central de avisos (o sino no topo).",
    ],
  },
  {
    id: "assumir-conversa",
    titulo: "Assumir ou devolver uma conversa para a IA",
    palavras: ["assumir", "devolver", "ia", "conversa", "atender", "pausar", "calar"],
    href: "/app/inbox",
    papelMinimo: "agent",
    passos: [
      "Abra a conversa no Inbox.",
      "Enquanto alguém da equipe está com a conversa, a IA fica calada.",
      "Para a IA voltar a atender, devolva a conversa para a IA pelo cabeçalho da conversa.",
    ],
  },
  {
    id: "marcar-perdido",
    titulo: "Marcar um negócio como perdido",
    palavras: ["perdido", "perder", "perda", "motivo", "negocio", "cancelar"],
    href: "/app/kanban",
    papelMinimo: "agent",
    passos: [
      "Abra Funis e o funil do negócio.",
      "Abra o cartão do negócio e use Marcar como perdido.",
      "Escolha o motivo. O motivo entra nos relatórios de perda.",
    ],
  },
  {
    id: "etapas-do-funil",
    titulo: "Criar ou mudar as etapas do funil",
    palavras: ["etapa", "etapas", "funil", "coluna", "pipeline", "criar"],
    href: "/app/settings/tenant/pipelines",
    papelMinimo: "manager",
    passos: [
      "Abra Etapas do funil.",
      "Escolha o funil e acrescente, renomeie ou reordene as etapas.",
    ],
  },
  {
    id: "importar-contatos",
    titulo: "Importar contatos de uma planilha",
    palavras: ["importar", "planilha", "csv", "excel", "contatos", "lista"],
    href: "/app/contacts",
    papelMinimo: "agent",
    passos: [
      "Abra Contatos e use Importar.",
      "Escolha a planilha e diga qual coluna é o quê (nome, telefone, e-mail).",
      "Confira o resumo e confirme. Nenhuma mensagem sai na importação.",
    ],
  },
  {
    id: "tarefas",
    titulo: "Criar e acompanhar tarefas",
    palavras: ["tarefa", "tarefas", "prazo", "atrasada", "lembrete", "fazer"],
    href: "/app/tasks",
    papelMinimo: "agent",
    passos: [
      "Abra Tarefas e use Nova tarefa.",
      "Dê o título, o prazo e o responsável; ligue a um negócio ou contato quando fizer sentido.",
      "As atrasadas aparecem destacadas, e quem é responsável recebe o lembrete.",
    ],
  },
  {
    id: "agenda",
    titulo: "Marcar um compromisso na agenda",
    palavras: ["agenda", "agendar", "marcar", "reuniao", "compromisso", "horario", "consulta"],
    href: "/app/agenda",
    papelMinimo: "agent",
    passos: [
      "Abra a Agenda e clique no horário livre.",
      "Escolha o tipo de agendamento, o contato e quem atende.",
    ],
    observacao: "Os tipos de agendamento (duração, onde acontece, quem atende) ficam em Tipos de agendamento.",
  },
  {
    id: "respostas-rapidas",
    titulo: "Criar respostas rápidas",
    palavras: ["resposta", "rapida", "script", "modelo", "atalho", "mensagem pronta"],
    href: "/app/templates",
    papelMinimo: "agent",
    passos: ["Abra Respostas rápidas e use Nova resposta rápida.", "Escreva o texto e salve. Ele aparece no compositor do Inbox."],
  },
  {
    id: "followup",
    titulo: "Mudar o texto de um follow-up",
    palavras: ["follow", "followup", "retomada", "regua", "cadencia", "mensagem"],
    href: "/app/ai/followups",
    papelMinimo: "manager",
    passos: [
      "Abra Follow-ups e escolha a régua.",
      "Edite o passo e publique.",
    ],
    observacao: "A mudança vale para as próximas inscrições; quem já está na régua segue a versão em que entrou.",
  },
  {
    id: "convidar-equipe",
    titulo: "Convidar alguém para a equipe",
    palavras: ["convidar", "convite", "usuario", "equipe", "acesso", "vendedor", "atendente"],
    href: "/app/team",
    papelMinimo: "admin",
    passos: [
      "Abra Equipe e use Convidar membros.",
      "Informe o e-mail e o papel. O convite chega por e-mail e vale por 15 dias.",
    ],
  },
  {
    id: "metas",
    titulo: "Definir a meta do mês",
    palavras: ["meta", "metas", "objetivo", "mes", "vendas", "alvo"],
    href: "/app/metrics",
    papelMinimo: "manager",
    passos: [
      "Abra Desempenho e vá até as metas do mês.",
      "Defina a meta da empresa ou de cada pessoa. O progresso é calculado pelo próprio funil.",
    ],
  },
  {
    id: "relatorios",
    titulo: "Montar um relatório",
    palavras: ["relatorio", "relatorios", "grafico", "painel", "numeros", "exportar"],
    href: "/app/relatorios",
    papelMinimo: "viewer",
    passos: [
      "Abra Relatórios e use Novo relatório.",
      "Escolha a fonte, o que medir e como agrupar. Cada pessoa vê só os números que já vê no CRM.",
    ],
  },
  {
    id: "etiquetas",
    titulo: "Criar etiquetas (tags)",
    palavras: ["etiqueta", "etiquetas", "tag", "tags", "marcador"],
    href: "/app/settings/tags",
    papelMinimo: "manager",
    passos: ["Abra Tags, em Configurações, e crie a etiqueta com o nome e a cor."],
  },
  {
    id: "central-de-avisos",
    titulo: "Central de avisos",
    palavras: ["aviso", "avisos", "sino", "notificacao", "central", "alerta"],
    href: "/app/ai/inbox",
    papelMinimo: "agent",
    passos: [
      "Clique no sino, no topo, para abrir a Central de avisos (Alertas).",
      "Cada aviso diz o que aconteceu e leva até onde se resolve. Resolva quando terminar.",
    ],
  },
  {
    id: "notificacoes",
    titulo: "Receber avisos no celular",
    palavras: ["celular", "notificacao", "push", "som", "avisar"],
    href: "/app/settings/notifications",
    papelMinimo: "viewer",
    passos: ["Abra Notificações e ligue os avisos neste aparelho."],
  },
];
