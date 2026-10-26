/**
 * FORK MIA (.88, ampliado na .89) — OS MANUAIS DO SISTEMA que o assistente usa no "como faço".
 *
 * O mapa das telas (`telas.ts`) responde ONDE fica. Isto responde COMO: os
 * passos de cada configuração e operação, na versão que está no ar. Três
 * listas, uma só régua:
 *
 *   - MANUAIS_DO_DIA_A_DIA (aqui): o que mais se pergunta na operação;
 *   - MANUAIS_DAS_TELAS (`manuais-das-telas.ts`): as telas que só a MIA tem e
 *     as que o guia de operação do upstream não alcança;
 *   - ROTEIROS (`roteiros.ts`): as tarefas que cruzam telas ("começar a atender
 *     um cliente novo", "ligar o Claude no CRM").
 *
 * O guia de operação do upstream (`guia-de-operacao.ts`) é a quarta fonte: ele
 * descreve o produto tela a tela; estes manuais dizem o passo a passo e onde a
 * MIA é diferente.
 *
 * Cada manual aponta para uma tela (o "Me leva lá"), e
 * `tests/unit/assistente-manuais.test.ts` reprova manual que aponte para tela
 * que não existe mais. `tests/unit/assistente-ajuda-cobre-todas-as-telas.test.ts`
 * reprova tela do app que nenhuma ajuda alcança.
 *
 * Mora no código, e não em `docs/`, por dois motivos medidos: a imagem do app
 * não carrega a pasta `docs/`, e o passo a passo muda junto com a tela que ele
 * descreve, no mesmo commit.
 *
 * ⚠️ Regra de escrita: só passo que existe na tela, com o nome que a tela usa.
 * Na dúvida, o manual diz a tela e o objetivo, e não inventa o botão. Texto
 * para o cliente: simples, sem jargão e sem travessão.
 *
 * Módulo PURO.
 */
import type { Role } from "@/lib/auth/types";

import { MANUAIS_DAS_TELAS } from "./manuais-das-telas";
import { ROTEIROS } from "./roteiros";

export interface Manual {
  id: string;
  titulo: string;
  /** Palavras que alguém usaria para perguntar isto. */
  palavras: string[];
  /** A tela onde se faz (o "Me leva lá"). */
  href: string;
  /** Quem consegue fazer (o assistente explica a todos e diz quem pode). */
  papelMinimo: Role;
  passos: string[];
  /** O cuidado que vale dizer junto. */
  observacao?: string;
  /**
   * Outras telas em que este manual vale: as subpáginas, as telas que só
   * redirecionam para a principal e a tela onde o recurso aparece. A busca dá
   * peso a elas quando a pessoa pergunta de dentro de uma delas.
   */
  telas?: string[];
  /**
   * Os manuais que a pessoa pode estar querendo no lugar deste. "MCP" é o
   * caso: o servidor externo que a IA consulta e o token para ferramentas de
   * fora mexerem no CRM são coisas diferentes com o mesmo nome.
   */
  vejaTambem?: string[];
  /** `roteiro` = tarefa que cruza telas. Ausente = manual de uma tela. */
  tipo?: "tela" | "roteiro";
  /**
   * Quem abre a tela quando a régua não é papel da empresa: o servidor
   * externo e a atualização são do dono da instalação (na MIA, a Time Company).
   */
  soDaPlataforma?: boolean;
}

export const MANUAIS_DO_DIA_A_DIA: readonly Manual[] = [
  {
    id: "horario-da-ia",
    titulo: "Horário de atendimento da IA",
    palavras: ["horario", "hora", "expediente", "noite", "madrugada", "fim de semana", "ativa", "inativa", "ia responde", "24 horas", "horario comercial"],
    href: "/app/ai/agents",
    papelMinimo: "admin",
    passos: [
      "Abra Agentes (no grupo Agente MIA) e escolha o agente.",
      "Na aba Configuração, em Conversa com o cliente, vá até o cartão Quando ele entra em ação e ache Horário de atendimento da IA.",
      "Escolha Ativa só no horário abaixo e confira o Fuso horário.",
      "Em cada dia, escolha Ativa nos horários, Ativa o dia todo ou Inativa o dia todo, e preencha as faixas (por exemplo 08:30 até 18:00). Use + faixa para mais de uma faixa no dia e Copiar a segunda para terça a sexta para repetir.",
      "Clique em Salvar rascunho e depois em Publicar. O horário vale a partir da publicação.",
    ],
    observacao:
      "Fora do horário a IA fica inativa: não responde o que chegar, nem depois, e a conversa fica com a equipe. Até 6 faixas por dia; para o fim do dia use 24:00. Se a IA ficar ativa de madrugada, a tela avisa da janela de resposta do número, e o administrador pode usar Abrir as respostas 24h neste número.",
  },
  {
    id: "conectar-numero",
    titulo: "Conectar um número de WhatsApp",
    palavras: ["conectar", "numero", "whatsapp", "qr", "code", "oficial", "conexao", "celular", "parear", "codigo de pareamento"],
    href: "/app/connections",
    papelMinimo: "admin",
    passos: [
      "Abra Conexões (no grupo Canais).",
      "Na aba Números por QR, use Conectar novo WhatsApp.",
      "Em Forma de conectar, escolha QR Code e leia o código com o WhatsApp do celular, em Aparelhos conectados. Se preferir, use Conectar por código e digite o código de pareamento no celular.",
      "Para o número oficial da Meta, use a aba API Oficial (Meta) e Conectar com o Facebook. Se a tela pedir, avise a Time Company: o número aparece depois que a Meta confirmar.",
    ],
    observacao: "Só o administrador conecta número. Depois de conectar, diga em Agentes por qual número cada agente atende.",
  },
  {
    id: "numero-desconectado",
    titulo: "Número desconectado",
    palavras: ["desconectado", "caiu", "parou", "numero", "reconectar", "qr", "saude"],
    href: "/app/connections",
    papelMinimo: "admin",
    passos: [
      "Abra Conexões e veja qual número está com o ponto de saúde vermelho.",
      "Use Reconectar e leia o novo QR Code com o celular do número.",
    ],
    observacao: "Enquanto o número está desconectado, nada que chega por ele é visto, e a IA não responde.",
  },
  {
    id: "inbox",
    titulo: "Atender as conversas no Inbox",
    palavras: ["inbox", "conversas", "minhas conversas", "responder cliente", "caixa de entrada", "nova conversa", "transferir", "nota interna", "encerrar"],
    href: "/app/inbox",
    papelMinimo: "agent",
    passos: [
      "Abra o Inbox. A aba Minhas tem as conversas com você; a Fila, as que esperam alguém; Todas, o resto que você pode ver.",
      "Clique na conversa e responda no campo de baixo. Para falar só com o time, use Nota interna.",
      "Para passar a outra pessoa, use Transferir. Ao terminar, use Encerrar demanda.",
      "Para falar com alguém que ainda não escreveu, use Nova conversa (Iniciar conversa).",
    ],
    observacao: "Fora da janela de 24 horas do número oficial, só um modelo aprovado chega ao cliente.",
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
    palavras: ["assumir", "devolver", "ia", "conversa", "atender", "pausar", "calar", "automatico", "pausar ia"],
    href: "/app/inbox",
    papelMinimo: "agent",
    passos: [
      "Abra a conversa no Inbox.",
      "Use Assumir (ou Assumir e responder) para atender você. Enquanto alguém da equipe está com a conversa, a IA fica calada.",
      "Para a IA voltar a atender, use Devolver ao automático no cabeçalho da conversa.",
    ],
    observacao:
      "Se o agente aceitar comandos pelo celular, quem atende pelo WhatsApp do número pode digitar #off para pausar e #on para devolver.",
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
    observacao: "Os motivos de perda de cada funil se cadastram em Etapas do funil.",
  },
  {
    id: "etapas-do-funil",
    titulo: "Criar um funil ou mudar as etapas do funil",
    palavras: ["etapa", "etapas", "funil", "coluna", "pipeline", "criar funil", "novo funil", "motivos de perda"],
    href: "/app/settings/tenant/pipelines",
    papelMinimo: "manager",
    passos: [
      "Abra Etapas do funil (no hub Ver tudo no CRM).",
      "Para um funil novo, use Novo funil e dê o Nome do novo funil.",
      "Escolha o funil e acrescente (Nome da nova etapa), renomeie ou reordene as etapas.",
      "Ali também ficam os Motivos de perda e os Motivos de ganho, separados por vírgula.",
    ],
  },
  {
    id: "importar-contatos",
    titulo: "Importar contatos de uma planilha",
    palavras: ["importar", "planilha", "csv", "excel", "contatos", "lista", "subir base"],
    href: "/app/contacts",
    papelMinimo: "agent",
    passos: [
      "Abra Contatos e use Importar (Importar contatos de planilha).",
      "Escolha a planilha e diga qual coluna é o quê (nome, telefone, e-mail).",
      "Confira o resumo e confirme. Nenhuma mensagem sai na importação.",
    ],
  },
  {
    id: "tarefas",
    titulo: "Criar e acompanhar tarefas",
    palavras: ["tarefa", "tarefas", "prazo", "atrasada", "lembrete", "fazer", "pendencia"],
    href: "/app/tasks",
    papelMinimo: "agent",
    passos: [
      "Abra Tarefas e use Nova tarefa.",
      "Dê o título, o prazo e o responsável; ligue a um negócio ou contato quando fizer sentido.",
      "As atrasadas aparecem destacadas, e quem é responsável recebe o lembrete.",
    ],
    observacao: "Para uma sequência de tarefas que se repete em todo negócio, monte um Plano de tarefa.",
  },
  {
    id: "agenda",
    titulo: "Marcar um compromisso na agenda",
    palavras: ["agenda", "agendar", "marcar", "reuniao", "compromisso", "horario", "consulta", "visita"],
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
    titulo: "Criar ou mudar um follow-up (retomada de quem parou de responder)",
    palavras: ["follow", "followup", "retomada", "regua", "cadencia", "mensagem", "sumiu", "parou de responder", "silencio"],
    href: "/app/ai/followups",
    papelMinimo: "manager",
    passos: [
      "Abra Follow-ups (no grupo Agente MIA).",
      "Para um novo, use Novo fluxo de follow-up e, se quiser, Começar de um modelo. Para mudar um que existe, abra o fluxo.",
      "Monte os passos (o tempo de espera e a mensagem de cada um) e publique.",
      "No agente, em Agentes, deixe ligado Habilitar gatilhos automáticos de follow-up e escolha os fluxos que ele usa.",
    ],
    observacao:
      "A mudança vale para as próximas inscrições; quem já está na régua segue a versão em que entrou. Depois de 24 horas sem resposta do cliente, só um modelo aprovado no WhatsApp chega até ele.",
  },
  {
    id: "convidar-equipe",
    titulo: "Convidar alguém para a equipe",
    palavras: ["convidar", "convite", "usuario", "equipe", "acesso", "vendedor", "atendente", "novo membro", "login"],
    href: "/app/team",
    papelMinimo: "admin",
    passos: [
      "Abra Equipe (em Configurações) e use Convidar membros.",
      "Informe o e-mail e o Papel e use Enviar convites. O convite chega por e-mail e vale por 15 dias.",
      "Se o e-mail não chegar, use Copiar link do convite e mande o link para a pessoa.",
    ],
    observacao: "Os papéis são Administrador, Gerente, Atendente e Somente leitura. Quem recebe cada cliente novo se ajusta em Distribuição de atendimento.",
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
    id: "etiquetas",
    titulo: "Criar etiquetas (tags)",
    palavras: ["etiqueta", "etiquetas", "tag", "tags", "marcador", "renomear", "juntar"],
    href: "/app/settings/tags",
    papelMinimo: "manager",
    passos: [
      "Abra Tags, em Configurações.",
      "Crie a etiqueta com o nome e a cor. Na mesma tela dá para ver onde cada uma é usada e renomear, juntar ou excluir.",
    ],
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
    titulo: "Escolher por onde receber avisos",
    palavras: ["celular", "notificacao", "push", "som", "avisar", "e-mail"],
    href: "/app/settings/notifications",
    papelMinimo: "viewer",
    passos: [
      "Abra Notificações, em Configurações.",
      "Escolha sobre o que quer ser avisado e por onde, e ligue os avisos neste aparelho.",
    ],
    observacao: "No celular, instale o sistema pela tela App no celular antes de ligar os avisos.",
  },
];

/** Todos os manuais, na ordem em que a busca os desempata. */
export const MANUAIS: readonly Manual[] = [...MANUAIS_DO_DIA_A_DIA, ...MANUAIS_DAS_TELAS, ...ROTEIROS];
