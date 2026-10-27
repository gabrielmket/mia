/**
 * FORK MIA (.93) — AS TRILHAS DO "ME MOSTRA COMO": o catálogo.
 *
 * Protótipo aprovado em 26/10/2026 ("o assistente ensina e faz", telas 1 e 2).
 * Uma TRILHA é um objetivo de vários passos ("Ligar o primeiro número"); um
 * GUIA CURTO é o manual de uma tela com o mesmo destaque ("Marcar um negócio
 * como perdido"). Os dois andam na tela de verdade:
 *
 *   - cada passo diz ONDE acontece (`tela`) e o que destacar (`alvo`, um
 *     `data-testid` que o sistema-base já usa nos testes, ou um marcador nosso,
 *     pequeno, marcado FORK MIA, onde faltava);
 *   - cada passo diz o que o assistente CONFERE (`conferencia`): a tela aberta,
 *     o campo preenchido, ou uma leitura do sistema com o login de quem usa
 *     (`leituras.ts`). Nunca o clique: o assistente não clica por ninguém;
 *   - a trilha fica FEITA quando o objetivo aparece no sistema (`feita`), não
 *     quando alguém aperta "concluir" (esse botão não existe).
 *
 * Nada aqui gasta IA: passos e conferências são fixos. Só a conversa livre
 * conta no limite de perguntas do dia.
 *
 * `tests/unit/assistente-trilhas-marcadores.test.ts` reprova a versão quando um
 * passo aponta para um marcador que sumiu do código ou para uma tela que não
 * existe mais. Trilha quebrada ensina errado, e ninguém percebe.
 *
 * Texto para o cliente: simples, sem jargão e sem travessão. Cada frase daqui
 * tem a tradução em `lib/i18n/dicionario-mia-trilhas.ts` (a cerca cobra).
 *
 * Módulo PURO: a tela, o servidor e o MCP importam daqui.
 */
import { roleAtLeast, type Role } from "@/lib/auth/types";

export const IDS_DAS_TRILHAS = [
  "numero",
  "agente",
  "funil",
  "followup",
  "horario",
  "equipe",
  "relatorio",
  "broadcast",
  "email",
  "importar",
  "respostas",
  "devolver",
  "perdido",
] as const;
export type IdDaTrilha = (typeof IDS_DAS_TRILHAS)[number];

export function ehIdDeTrilha(valor: unknown): valor is IdDaTrilha {
  return typeof valor === "string" && (IDS_DAS_TRILHAS as readonly string[]).includes(valor);
}

/** As leituras do sistema que conferem um passo ou o objetivo (`leituras.ts`). */
export const LEITURAS_DO_SISTEMA = [
  "numero_conectado",
  "numero_com_nome",
  "agente_criado",
  "agente_no_ar",
  "rascunho_com_horario",
  "horario_publicado",
  "equipe_com_mais_gente",
  "convite_enviado",
  "fluxo_criado",
  "fluxo_com_gatilho",
  "followup_publicado",
  "funil_criado",
  "funil_com_ganho_e_perda",
  "resposta_criada",
  "negocio_perdido",
  "relatorio_salvo",
  "campanha_criada",
  "campanha_saiu",
  "dominio_verificado",
  "email_teste_enviado",
  "email_saiu",
  "contatos_importados",
  "conversa_assumida",
  "conversa_devolvida",
] as const;
export type LeituraDoSistema = (typeof LEITURAS_DO_SISTEMA)[number];

/**
 * O que o assistente confere em cada passo.
 *
 *   tela        a pessoa está na tela (`rota`; `[id]` vale qualquer segmento)
 *   elemento    o marcador apareceu (a janela abriu, o resultado chegou)
 *   na_tela     o marcador está à vista (a pessoa rolou até ele)
 *   preenchido  o campo tem texto (`minimo` letras; `email` pede um e-mail)
 *   marcado     o marcador, ou algo dentro dele, está escolhido
 *   sistema     uma leitura do sistema, com o login de quem usa
 *   algum       qualquer uma das conferências
 *   seguir      passo de orientação: a pessoa diz que seguiu (o objetivo da
 *               trilha continua conferido pelo sistema no fim)
 */
export type Conferencia =
  | { ve: "tela"; rota: string }
  | { ve: "elemento"; alvo: string }
  | { ve: "na_tela"; alvo: string }
  | { ve: "preenchido"; alvo: string; minimo?: number; email?: boolean }
  | { ve: "marcado"; alvo: string }
  | { ve: "sistema"; leitura: LeituraDoSistema }
  | { ve: "algum"; de: Conferencia[] }
  | { ve: "seguir" };

export interface PassoDaTrilha {
  /** O que a pessoa faz, com o nome que a tela usa. */
  texto: string;
  /** A tela em que o passo acontece (`/app/ai/agents/[id]`). Sem ela, vale qualquer tela. */
  tela?: string;
  /** O "Me leva até lá" deste passo: um endereço fixo do app. Padrão: a `tela`, quando não tem `[id]`. */
  ir?: string;
  /**
   * O marcador que o destaque cerca: o `data-testid`. `{funil}` é trocado pelo
   * id que uma leitura anterior devolveu; terminar em `*` cerca o primeiro que
   * começa assim (a lista em que ainda não se sabe qual).
   */
  alvo?: string;
  /** O que o assistente confere, em palavras ("o número conectado em Conexões"). */
  confere: string;
  conferencia: Conferencia;
  /** O que aparece quando o passo é conferido (`{nome}` vem da leitura). */
  conferido?: string;
  /** O passo acontece fora do sistema (no celular): o assistente explica e fica olhando. */
  fora?: string;
  /** Clique só da pessoa (publicar, enviar): o assistente diz que não faz. */
  soVoce?: boolean;
  /**
   * Ao retomar uma trilha pausada neste passo, de onde seguir: o que estava
   * aberto e não foi salvo se perdeu (a janela fechou), e o passo que abre a
   * janela volta.
   */
  retomaEm?: number;
}

export type GrupoDaTrilha = "pe" | "vender" | "dia" | "guia";

/** O título de cada grupo, na ordem da lista (a tela traduz por esta tabela). */
export const TITULO_DO_GRUPO = {
  pe: "Pôr de pé",
  vender: "Vender mais",
  dia: "Dia a dia",
  guia: "Guias curtos",
} as const satisfies Record<GrupoDaTrilha, string>;

export const GRUPOS_DAS_TRILHAS: ReadonlyArray<{ grupo: Exclude<GrupoDaTrilha, "guia">; titulo: string }> = [
  { grupo: "pe", titulo: TITULO_DO_GRUPO.pe },
  { grupo: "vender", titulo: TITULO_DO_GRUPO.vender },
  { grupo: "dia", titulo: TITULO_DO_GRUPO.dia },
];

export interface Trilha {
  id: IdDaTrilha;
  grupo: GrupoDaTrilha;
  /** Guia curto: o manual de uma tela, com o destaque (não entra na contagem das trilhas). */
  curto?: boolean;
  titulo: string;
  objetivo: string;
  /** Quando fica feita, em palavras ("o número aparece conectado em Conexões, com nome"). */
  pronto: string;
  /** O que o assistente faz por você (com aprovação), ou "Nada". */
  euFaco: string;
  /** O que só a pessoa faz. */
  soVoce: string;
  tempo: string;
  /** O papel mínimo, o MESMO da tela (o assistente não dá poder novo a ninguém). */
  papel: Role;
  /**
   * As de pôr de pé são da EMPRESA: ficam feitas para todos quando o objetivo
   * aparece no sistema. As outras são de cada pessoa.
   */
  daEmpresa: boolean;
  /** Só faz sentido depois desta (o follow-up depois do agente). */
  depende?: IdDaTrilha;
  /** O módulo que a tela pede (o Broadcast e o e-mail se contratam à parte). */
  modulo?: "disparador" | "email_marketing";
  /** O objetivo, conferido no sistema. */
  feita: LeituraDoSistema;
  /** A próxima que o assistente sugere ao terminar. */
  proxima?: IdDaTrilha;
  /** Os manuais que ela ensina (o "Me mostra como" da resposta de "como faço"). */
  manuais: readonly string[];
  /** "De onde veio" do fim da trilha. */
  fontes: readonly string[];
  passos: readonly PassoDaTrilha[];
  /** A frase do fim (`{nome}` vem da leitura do objetivo). */
  fim: string;
}

const ABRIR = (tela: string, rota: string, extra = ""): PassoDaTrilha => ({
  texto: `Abra ${tela}, no menu.${extra ? ` ${extra}` : ""}`,
  tela: rota,
  ir: rota,
  confere: "a tela aberta",
  conferencia: { ve: "tela", rota },
  conferido: `Você está em ${tela}.`,
});

export const TRILHAS: readonly Trilha[] = [
  // ── Pôr de pé ──────────────────────────────────────────────────────────────
  {
    id: "numero",
    grupo: "pe",
    titulo: "Ligar o primeiro número",
    objetivo: "Pôr o WhatsApp da empresa dentro do sistema, para o agente e a equipe atenderem por ele.",
    pronto: "o número aparece conectado em Conexões, com nome.",
    euFaco: "Nada: conectar número é sempre com você. Eu destaco cada passo e confiro.",
    soVoce: "Ler o código com o celular do número, ou entrar com o Facebook no número oficial.",
    tempo: "5 min",
    papel: "admin",
    daEmpresa: true,
    feita: "numero_com_nome",
    proxima: "horario",
    manuais: ["conectar-numero", "numero-desconectado"],
    fontes: ["Conexões"],
    passos: [
      ABRIR("Conexões", "/app/connections"),
      {
        texto: "Clique em Conectar novo WhatsApp.",
        tela: "/app/connections",
        alvo: "conectar-novo-whatsapp",
        confere: "a janela de conexão aberta",
        conferencia: { ve: "algum", de: [{ ve: "elemento", alvo: "janela-conectar-whatsapp" }, { ve: "sistema", leitura: "numero_conectado" }] },
        conferido: "A janela de conexão abriu.",
      },
      {
        texto: "Em Forma de conectar, deixe QR Code: é o WhatsApp do celular que já atende a empresa. O número oficial também serve, pela aba API Oficial (Meta).",
        tela: "/app/connections",
        alvo: "forma-qr-code",
        retomaEm: 1,
        confere: "a forma escolhida",
        conferencia: { ve: "algum", de: [{ ve: "marcado", alvo: "forma-qr-code" }, { ve: "sistema", leitura: "numero_conectado" }] },
        conferido: "Forma escolhida: QR Code.",
      },
      {
        texto: "No celular do número, abra o WhatsApp › Aparelhos conectados › Conectar um aparelho, e aponte a câmera para o código.",
        tela: "/app/connections",
        alvo: "qr-code-do-whatsapp",
        retomaEm: 1,
        fora: "Isto acontece no celular, fora do sistema. Eu fico olhando Conexões até o número aparecer conectado.",
        confere: "o estado do número em Conexões",
        conferencia: { ve: "sistema", leitura: "numero_conectado" },
        conferido: "Conferi em Conexões: {nome} conectado.",
      },
      {
        texto: "No cartão do número, clique em Renomear.",
        tela: "/app/connections",
        alvo: "renomear-numero",
        confere: "a janela do nome aberta",
        conferencia: { ve: "algum", de: [{ ve: "elemento", alvo: "nome-do-numero" }, { ve: "sistema", leitura: "numero_com_nome" }] },
        conferido: "A janela do nome abriu.",
      },
      {
        texto: "Escreva o nome que a equipe vê no Inbox (ex.: Recepção) e clique em Salvar.",
        tela: "/app/connections",
        alvo: "nome-do-numero",
        retomaEm: 4,
        confere: "o nome gravado",
        conferencia: { ve: "sistema", leitura: "numero_com_nome" },
        conferido: "Nome gravado: {nome}.",
      },
    ],
    fim: "Pronto. Conferi em Conexões: o número {nome} está conectado. O agente que está no ar passa a responder por ele, e as conversas chegam no Inbox.",
  },
  {
    id: "agente",
    grupo: "pe",
    titulo: "Montar o agente",
    objetivo: "Dar nome, jeito e conhecimento ao agente que atende no WhatsApp.",
    pronto: "o agente aparece no ar em Agentes.",
    euFaco: "O agente do modelo do seu segmento, em rascunho, para você aprovar.",
    soVoce: "Publicar: é o que põe o agente para falar com cliente de verdade.",
    tempo: "10 min",
    papel: "admin",
    daEmpresa: true,
    feita: "agente_no_ar",
    proxima: "horario",
    manuais: ["agente"],
    fontes: ["Agentes de IA"],
    passos: [
      ABRIR("Agentes", "/app/ai/agents", "Fica no grupo Agente MIA."),
      {
        texto: "Clique em Criar novo, ou em Editar no agente que já existe.",
        tela: "/app/ai/agents",
        alvo: "novo-agente",
        confere: "o agente aberto",
        conferencia: { ve: "tela", rota: "/app/ai/agents/[id]" },
        conferido: "O agente está aberto.",
      },
      {
        texto: "Na aba Conversa com o cliente, preencha Quem é este agente: o nome que o cliente vê.",
        tela: "/app/ai/agents/[id]",
        alvo: "nome-do-agente",
        retomaEm: 1,
        confere: "o nome escrito",
        conferencia: { ve: "preenchido", alvo: "nome-do-agente", minimo: 2 },
        conferido: "Nome escrito.",
      },
      {
        texto: "Escreva as instruções dele: o jeito de falar, o que ele faz e o que nunca faz.",
        tela: "/app/ai/agents/[id]",
        alvo: "instrucoes-do-agente",
        retomaEm: 1,
        confere: "as instruções escritas",
        conferencia: { ve: "preenchido", alvo: "instrucoes-do-agente", minimo: 20 },
        conferido: "Instruções escritas.",
      },
      {
        texto: "Em O que ele consulta antes de responder, marque os materiais: preços, endereço, convênios.",
        tela: "/app/ai/agents/[id]",
        alvo: "agente-bases",
        retomaEm: 1,
        confere: "nada aqui: os materiais são opcionais",
        conferencia: { ve: "seguir" },
      },
      {
        texto: "Clique em Criar agente, ou em Salvar rascunho.",
        tela: "/app/ai/agents/[id]",
        alvo: "salvar-agente",
        retomaEm: 1,
        confere: "o agente gravado",
        conferencia: { ve: "sistema", leitura: "agente_criado" },
        conferido: "Conferi em Agentes: {nome} gravado.",
      },
      {
        texto: "Converse com ele na aba Teste. Nada sai para ninguém.",
        tela: "/app/ai/agents/[id]",
        alvo: "aba-teste-do-agente",
        confere: "uma conversa de teste feita",
        conferencia: { ve: "algum", de: [{ ve: "elemento", alvo: "teste-verificacoes" }, { ve: "sistema", leitura: "agente_no_ar" }] },
        conferido: "Teste feito.",
      },
      {
        texto: "Clique em Publicar e confirme. Publicar é sempre clique seu: eu não publico.",
        tela: "/app/ai/agents/[id]",
        alvo: "publicar-agente",
        soVoce: true,
        confere: "a versão publicada",
        conferencia: { ve: "sistema", leitura: "agente_no_ar" },
        conferido: "Conferi: {nome} no ar.",
      },
    ],
    fim: "Pronto. Conferi em Agentes: {nome} está no ar. Ele responde pelo número escolhido nele.",
  },
  {
    id: "funil",
    grupo: "pe",
    titulo: "Criar um funil",
    objetivo: "Montar um funil novo com as etapas do seu jeito, com etapa de ganho e de perda.",
    pronto: "o funil novo aparece em Etapas do funil, com ganho e perda marcados.",
    euFaco: "O funil do quadro pronto do seu segmento, para aprovar.",
    soVoce: "Decidir as etapas: é o jeito de a equipe trabalhar.",
    tempo: "4 min",
    papel: "manager",
    daEmpresa: false,
    feita: "funil_com_ganho_e_perda",
    manuais: ["etapas-do-funil", "abrir-funil"],
    fontes: ["Funis"],
    passos: [
      ABRIR("Funis", "/app/kanban"),
      {
        texto: "Clique em Novo funil.",
        tela: "/app/kanban",
        alvo: "novo-funil",
        confere: "o formulário aberto",
        conferencia: { ve: "algum", de: [{ ve: "elemento", alvo: "form-novo-funil" }, { ve: "sistema", leitura: "funil_criado" }] },
        conferido: "O formulário do funil abriu.",
      },
      {
        texto: "Dê o nome do funil. Ex.: Retornos, para quem já é cliente.",
        tela: "/app/kanban",
        alvo: "nome-do-novo-funil",
        retomaEm: 1,
        confere: "o nome escrito",
        conferencia: { ve: "algum", de: [{ ve: "preenchido", alvo: "nome-do-novo-funil", minimo: 3 }, { ve: "sistema", leitura: "funil_criado" }] },
        conferido: "Nome escrito.",
      },
      {
        texto: "Clique em Criar funil. Ele já nasce com Novo, Em andamento, Ganho e Perdido.",
        tela: "/app/kanban",
        alvo: "confirmar-novo-funil",
        retomaEm: 1,
        confere: "o funil criado",
        conferencia: { ve: "sistema", leitura: "funil_criado" },
        conferido: "Conferi: o funil {nome} foi criado.",
      },
      {
        texto: "Agora as etapas: abra Etapas do funil.",
        tela: "/app/settings/tenant/pipelines",
        ir: "/app/settings/tenant/pipelines",
        confere: "a tela aberta",
        conferencia: { ve: "tela", rota: "/app/settings/tenant/pipelines" },
        conferido: "Você está em Etapas do funil.",
      },
      {
        texto: "No funil novo, escreva as etapas na ordem em que o cliente anda (Acrescentar etapa ao fim) e diga qual é ganho e qual é perda. É o que alimenta os relatórios.",
        tela: "/app/settings/tenant/pipelines",
        alvo: "etapas-{funil}",
        confere: "ganho e perda marcados no funil novo",
        conferencia: { ve: "sistema", leitura: "funil_com_ganho_e_perda" },
        conferido: "Conferi: {etapas} etapas, ganho e perda marcados.",
      },
    ],
    fim: "Pronto. Conferi em Etapas do funil: {nome} existe, com {etapas} etapas, ganho e perda marcados. Ele já aparece em Funis.",
  },
  {
    id: "followup",
    grupo: "pe",
    titulo: "Configurar o follow-up",
    objetivo: "Voltar a falar com quem parou de responder, no tempo certo.",
    pronto: "o follow-up aparece publicado em Follow-ups.",
    euFaco: "O follow-up do modelo do seu segmento, em rascunho, para aprovar.",
    soVoce: "Publicar: é o que faz as mensagens saírem.",
    tempo: "6 min",
    papel: "manager",
    daEmpresa: false,
    depende: "agente",
    feita: "followup_publicado",
    manuais: ["followup"],
    fontes: ["Follow-ups"],
    passos: [
      ABRIR("Follow-ups", "/app/ai/followups", "Fica no grupo Agente MIA."),
      {
        texto: "Clique em Novo fluxo, dê o nome e clique em Criar fluxo. Se preferir, use Começar de um modelo.",
        tela: "/app/ai/followups",
        alvo: "novo-fluxo",
        confere: "o fluxo criado",
        conferencia: { ve: "sistema", leitura: "fluxo_criado" },
        conferido: "Conferi: o fluxo {nome} foi criado.",
      },
      {
        texto: "Abra o fluxo novo, na lista.",
        tela: "/app/ai/followups",
        alvo: "abrir-fluxo-{fluxo}",
        confere: "o fluxo aberto",
        conferencia: { ve: "tela", rota: "/app/ai/followups/[id]" },
        conferido: "O fluxo está aberto.",
      },
      {
        texto: "Em Gatilho, escolha quando ele começa (por exemplo, 24 horas de silêncio) e salve.",
        tela: "/app/ai/followups/[id]",
        alvo: "trigger-config-button",
        retomaEm: 2,
        confere: "o gatilho gravado",
        conferencia: { ve: "sistema", leitura: "fluxo_com_gatilho" },
        conferido: "Gatilho gravado.",
      },
      {
        texto: "Monte as mensagens e as esperas pela paleta (Mensagem e Aguardar) e escreva cada texto.",
        tela: "/app/ai/followups/[id]",
        alvo: "node-palette",
        retomaEm: 2,
        confere: "nada aqui: no fim eu confiro o fluxo publicado",
        conferencia: { ve: "seguir" },
      },
      {
        texto: "Clique em Publicar. É o que faz as mensagens saírem: o clique é seu.",
        tela: "/app/ai/followups/[id]",
        alvo: "publish-button",
        retomaEm: 2,
        soVoce: true,
        confere: "o fluxo publicado",
        conferencia: { ve: "sistema", leitura: "followup_publicado" },
        conferido: "Conferi: {nome} publicado.",
      },
    ],
    fim: "Pronto. Conferi em Follow-ups: {nome} está publicado. Para ele entrar em ação, o agente precisa estar com o fluxo marcado em Follow-up (quem administra marca e publica o agente). Ele só manda em horário comercial.",
  },
  {
    id: "horario",
    grupo: "pe",
    titulo: "Configurar o horário da IA",
    objetivo: "Dizer em que horário o agente atende. Fora dele, a conversa fica com a equipe.",
    pronto: "a versão publicada do agente está \"ativa só no horário\", com as faixas de cada dia.",
    euFaco: "Nada: mudar o agente no ar é publicar, e publicar é clique seu.",
    soVoce: "Publicar.",
    tempo: "3 min",
    papel: "admin",
    daEmpresa: true,
    depende: "agente",
    feita: "horario_publicado",
    proxima: "followup",
    manuais: ["horario-da-ia"],
    fontes: ["Agentes de IA"],
    passos: [
      ABRIR("Agentes", "/app/ai/agents", "Fica no grupo Agente MIA."),
      {
        texto: "Clique em Editar no agente que atende.",
        tela: "/app/ai/agents",
        alvo: "editar-agente",
        confere: "o agente aberto",
        conferencia: { ve: "tela", rota: "/app/ai/agents/[id]" },
        conferido: "O agente está aberto.",
      },
      {
        texto: "Na aba Configuração, em Conversa com o cliente, desça até Horário de atendimento da IA.",
        tela: "/app/ai/agents/[id]",
        alvo: "horario-da-ia",
        retomaEm: 1,
        confere: "o horário à vista",
        conferencia: { ve: "na_tela", alvo: "horario-da-ia" },
        conferido: "Horário de atendimento da IA à vista.",
      },
      {
        texto: "Escolha Ativa só no horário abaixo e confira o fuso horário.",
        tela: "/app/ai/agents/[id]",
        alvo: "horario-so-no-horario",
        retomaEm: 1,
        confere: "o modo escolhido",
        conferencia: { ve: "algum", de: [{ ve: "marcado", alvo: "horario-so-no-horario" }, { ve: "sistema", leitura: "horario_publicado" }] },
        conferido: "Modo: ativa só no horário.",
      },
      {
        texto: "Em cada dia, escolha Ativa nos horários, Ativa o dia todo ou Inativa o dia todo, e preencha as faixas (ex.: 08:00 até 18:00).",
        tela: "/app/ai/agents/[id]",
        alvo: "horario-dias",
        retomaEm: 1,
        confere: "nada aqui: as faixas eu confiro depois de salvar",
        conferencia: { ve: "seguir" },
      },
      {
        texto: "Clique em Salvar rascunho.",
        tela: "/app/ai/agents/[id]",
        alvo: "salvar-agente",
        retomaEm: 1,
        confere: "o rascunho com o horário",
        conferencia: { ve: "algum", de: [{ ve: "sistema", leitura: "rascunho_com_horario" }, { ve: "sistema", leitura: "horario_publicado" }] },
        conferido: "Rascunho gravado com o horário.",
      },
      {
        texto: "Clique em Publicar e confirme. O horário vale a partir da publicação. Publicar é sempre clique seu: eu não publico.",
        tela: "/app/ai/agents/[id]",
        alvo: "publicar-agente",
        retomaEm: 1,
        soVoce: true,
        confere: "a versão publicada",
        conferencia: { ve: "sistema", leitura: "horario_publicado" },
        conferido: "Conferi: {nome} publicado com o horário.",
      },
    ],
    fim: "Pronto. Conferi em Agentes: a versão publicada de {nome} está ativa só no horário. Fora dele, a conversa fica com a equipe.",
  },
  {
    id: "equipe",
    grupo: "pe",
    titulo: "Convidar a equipe",
    objetivo: "Pôr quem atende e quem vende dentro do sistema, cada um com o papel certo.",
    pronto: "o convite aparece em Equipe, pendente, e vale por 15 dias.",
    euFaco: "Nada: convite, usuário e papel são sempre com você.",
    soVoce: "Convidar e escolher o papel.",
    tempo: "2 min",
    papel: "admin",
    daEmpresa: true,
    feita: "equipe_com_mais_gente",
    manuais: ["convidar-equipe"],
    fontes: ["Equipe"],
    passos: [
      ABRIR("Equipe", "/app/team", "Fica em Configurações."),
      {
        texto: "Clique em Convidar membros.",
        tela: "/app/team",
        alvo: "convidar-membros",
        confere: "a tela do convite aberta",
        conferencia: { ve: "tela", rota: "/app/team/invite" },
        conferido: "A tela do convite abriu.",
      },
      {
        texto: "Escreva o e-mail da pessoa. Para mais de uma, um e-mail por linha.",
        tela: "/app/team/invite",
        alvo: "emails-do-convite",
        retomaEm: 1,
        confere: "um e-mail válido",
        conferencia: { ve: "algum", de: [{ ve: "preenchido", alvo: "emails-do-convite", email: true }, { ve: "sistema", leitura: "convite_enviado" }] },
        conferido: "E-mail escrito.",
      },
      {
        texto: "Escolha o papel: Administrador vê e muda tudo; Gerente vê a equipe inteira; Atendente vê o que é dele; Somente leitura só vê.",
        tela: "/app/team/invite",
        alvo: "papel-do-convite",
        retomaEm: 1,
        confere: "nada aqui: o papel aparece no convite",
        conferencia: { ve: "seguir" },
      },
      {
        texto: "Clique em Enviar convites.",
        tela: "/app/team/invite",
        alvo: "enviar-convites",
        retomaEm: 1,
        confere: "o convite pendente",
        conferencia: { ve: "sistema", leitura: "convite_enviado" },
        conferido: "Conferi em Equipe: convite pendente para {nome}.",
      },
    ],
    fim: "Pronto. Conferi em Equipe: o convite está pendente e vale por 15 dias. Quando a pessoa entrar, ela vê só o que o papel dela permite.",
  },

  // ── Vender mais ────────────────────────────────────────────────────────────
  {
    id: "relatorio",
    grupo: "vender",
    titulo: "Montar um relatório",
    objetivo: "Responder uma pergunta do negócio com os números do próprio sistema.",
    pronto: "o relatório aparece salvo em Relatórios.",
    euFaco: "Nada por enquanto: eu explico cada escolha da tela.",
    soVoce: "Nada: cada pessoa vê só os números que já vê no CRM.",
    tempo: "4 min",
    papel: "viewer",
    daEmpresa: false,
    feita: "relatorio_salvo",
    manuais: ["relatorios"],
    fontes: ["Relatórios"],
    passos: [
      ABRIR("Relatórios", "/app/relatorios", "Fica no MIA Insights."),
      {
        texto: "Clique em Novo relatório.",
        tela: "/app/relatorios",
        alvo: "novo-relatorio",
        confere: "a escolha da fonte aberta",
        conferencia: { ve: "tela", rota: "/app/relatorios/novo" },
        conferido: "A escolha da fonte abriu.",
      },
      {
        texto: "Escolha a fonte: negócios, conversas, contatos, agenda ou follow-up.",
        tela: "/app/relatorios/novo",
        alvo: "fontes-do-relatorio",
        retomaEm: 1,
        confere: "o editor aberto",
        conferencia: { ve: "tela", rota: "/app/relatorios/editor" },
        conferido: "O editor do relatório abriu.",
      },
      {
        texto: "Escolha o que medir, como agrupar (ex.: por origem) e o período.",
        tela: "/app/relatorios/editor",
        alvo: "medida-do-relatorio",
        retomaEm: 1,
        confere: "nada aqui: no fim eu confiro o relatório salvo",
        conferencia: { ve: "seguir" },
      },
      {
        texto: "Dê o nome e clique em Salvar. Para a equipe ver, use Compartilhar (gestor).",
        tela: "/app/relatorios/editor",
        alvo: "salvar-relatorio",
        retomaEm: 1,
        confere: "o relatório salvo",
        conferencia: { ve: "sistema", leitura: "relatorio_salvo" },
        conferido: "Conferi em Relatórios: {nome} salvo.",
      },
    ],
    fim: "Pronto. Conferi em Relatórios: {nome} está salvo. Para pôr num painel, use Painéis.",
  },
  {
    id: "broadcast",
    grupo: "vender",
    titulo: "Fazer uma campanha de Broadcast",
    objetivo: "Mandar uma mensagem para uma lista de contatos pelo WhatsApp, com créditos.",
    pronto: "a campanha aparece agendada ou enviada em Broadcast.",
    euFaco: "Escrevo o texto aqui na conversa, para você revisar e colar. Não crio nem envio campanha.",
    soVoce: "Agendar e enviar.",
    tempo: "8 min",
    papel: "manager",
    daEmpresa: false,
    depende: "numero",
    modulo: "disparador",
    feita: "campanha_saiu",
    manuais: ["broadcast-oficial", "broadcast-qr"],
    fontes: ["Broadcast"],
    passos: [
      ABRIR("Broadcast", "/app/broadcast"),
      {
        texto: "Clique em Novo disparo.",
        tela: "/app/broadcast",
        alvo: "novo-disparo",
        confere: "a escolha do canal aberta",
        conferencia: { ve: "tela", rota: "/app/broadcast/novo" },
        conferido: "A escolha do canal abriu.",
      },
      {
        texto: "Escolha o número: o oficial manda um modelo aprovado pela Meta; o do QR Code manda texto livre.",
        tela: "/app/broadcast/novo",
        alvo: "canais-do-disparo",
        retomaEm: 1,
        confere: "o formulário da campanha aberto",
        conferencia: { ve: "algum", de: [{ ve: "elemento", alvo: "formulario-do-oficial" }, { ve: "tela", rota: "/app/campaigns/new" }] },
        conferido: "O formulário da campanha abriu.",
      },
      {
        texto: "Dê o nome, escolha o público pelos filtros e a mensagem. Quem pediu para não receber fica de fora sozinho. Confira a prévia e o custo em créditos, e salve.",
        retomaEm: 1,
        confere: "a campanha gravada",
        conferencia: { ve: "sistema", leitura: "campanha_criada" },
        conferido: "Conferi: a campanha {nome} foi gravada.",
      },
      {
        texto: "Agende ou envie. Enviar é sempre clique seu.",
        soVoce: true,
        confere: "a campanha agendada ou enviada",
        conferencia: { ve: "sistema", leitura: "campanha_saiu" },
        conferido: "Conferi: {nome} {situacao}.",
      },
    ],
    fim: "Pronto. Conferi em Broadcast: a campanha {nome} está {situacao}. O resultado aparece na própria campanha.",
  },
  {
    id: "email",
    grupo: "vender",
    titulo: "Fazer uma campanha de e-mail",
    objetivo: "Mandar um e-mail para a base, pelo domínio da empresa, com descadastro.",
    pronto: "a campanha aparece agendada ou enviada em Broadcast.",
    euFaco: "Escrevo o assunto e o texto aqui na conversa. Não crio nem envio campanha.",
    soVoce: "Verificar o domínio, agendar e enviar.",
    tempo: "10 min",
    papel: "manager",
    daEmpresa: false,
    modulo: "email_marketing",
    feita: "email_saiu",
    manuais: ["email-marketing-campanha", "email-marketing-configurar"],
    fontes: ["Broadcast"],
    passos: [
      {
        texto: "Confira se o domínio da empresa está verificado, em Configurações › E-mail marketing (o administrador verifica).",
        tela: "/app/settings/email-marketing",
        ir: "/app/settings/email-marketing",
        confere: "o domínio verificado",
        conferencia: { ve: "sistema", leitura: "dominio_verificado" },
        conferido: "Conferi: o domínio {nome} está verificado.",
      },
      {
        texto: "Abra Broadcast e clique em Novo disparo.",
        tela: "/app/broadcast",
        ir: "/app/broadcast",
        alvo: "novo-disparo",
        confere: "a escolha do canal aberta",
        conferencia: { ve: "tela", rota: "/app/broadcast/novo" },
        conferido: "A escolha do canal abriu.",
      },
      {
        texto: "No cartão do e-mail, clique em Usar o e-mail, dê o nome e clique em Criar o rascunho.",
        tela: "/app/broadcast/novo",
        alvo: "cartao-do-email",
        retomaEm: 1,
        confere: "a campanha aberta",
        conferencia: { ve: "tela", rota: "/app/broadcast/email/[id]" },
        conferido: "A campanha está aberta.",
      },
      {
        texto: "Na aba Público, escolha quem recebe e a base legal, e salve. Quem se descadastrou fica de fora sozinho.",
        tela: "/app/broadcast/email/[id]",
        retomaEm: 2,
        confere: "nada aqui: no fim eu confiro a campanha",
        conferencia: { ve: "seguir" },
      },
      {
        texto: "Na aba Mensagem, escolha o remetente e o assunto, monte o e-mail pelos blocos e mande um teste para você.",
        tela: "/app/broadcast/email/[id]",
        retomaEm: 2,
        confere: "o teste enviado",
        conferencia: { ve: "sistema", leitura: "email_teste_enviado" },
        conferido: "Conferi: o teste saiu.",
      },
      {
        texto: "Na aba Enviar, escolha Começar agora ou Agendar, revise e confirme. Enviar é sempre clique seu.",
        tela: "/app/broadcast/email/[id]",
        retomaEm: 2,
        soVoce: true,
        confere: "a campanha agendada ou enviada",
        conferencia: { ve: "sistema", leitura: "email_saiu" },
        conferido: "Conferi: {nome} {situacao}.",
      },
    ],
    fim: "Pronto. Conferi: a campanha de e-mail {nome} está {situacao}. Os resultados aparecem na aba Resultados.",
  },
  {
    id: "importar",
    grupo: "vender",
    titulo: "Importar contatos",
    objetivo: "Trazer a lista de clientes de uma planilha, sem mandar mensagem a ninguém.",
    pronto: "os contatos aparecem em Contatos, com o resumo de quantos entraram.",
    euFaco: "Nada: a planilha é sua. Eu explico cada aviso do resumo.",
    soVoce: "Escolher a planilha e confirmar.",
    tempo: "5 min",
    papel: "agent",
    daEmpresa: false,
    feita: "contatos_importados",
    manuais: ["importar-contatos"],
    fontes: ["Contatos"],
    passos: [
      ABRIR("Contatos", "/app/contacts"),
      {
        texto: "Clique em Importar CSV.",
        tela: "/app/contacts",
        alvo: "importar-contatos",
        confere: "a janela da importação aberta",
        conferencia: { ve: "elemento", alvo: "arquivo-de-contatos" },
        conferido: "A janela da importação abriu.",
      },
      {
        texto: "Escolha a planilha (CSV). O sistema reconhece nome, telefone e e-mail pelo cabeçalho de cada coluna.",
        tela: "/app/contacts",
        alvo: "arquivo-de-contatos",
        retomaEm: 1,
        confere: "a planilha escolhida",
        conferencia: { ve: "algum", de: [{ ve: "preenchido", alvo: "arquivo-de-contatos", minimo: 1 }, { ve: "sistema", leitura: "contatos_importados" }] },
        conferido: "Planilha escolhida.",
      },
      {
        texto: "Clique em Importar e confira o resumo: quantos entraram, repetidos e com erro. Nenhuma mensagem sai na importação.",
        tela: "/app/contacts",
        alvo: "confirmar-importacao",
        retomaEm: 1,
        confere: "os contatos importados",
        conferencia: { ve: "sistema", leitura: "contatos_importados" },
        conferido: "Conferi em Contatos: {quantos} contatos entraram.",
      },
    ],
    fim: "Pronto. Conferi em Contatos: {quantos} contatos entraram pela planilha. Nenhuma mensagem saiu.",
  },

  // ── Dia a dia (decisão 8: as duas que não estavam na lista pedida) ────────
  {
    id: "respostas",
    grupo: "dia",
    titulo: "Criar uma resposta rápida",
    objetivo: "Guardar um texto que você manda sempre, para usar no Inbox com uma barra.",
    pronto: "a resposta aparece em Respostas rápidas e no Inbox, ao digitar /.",
    euFaco: "Nada por enquanto: eu destaco cada campo e confiro.",
    soVoce: "Nada.",
    tempo: "2 min",
    papel: "agent",
    daEmpresa: false,
    feita: "resposta_criada",
    manuais: ["respostas-rapidas"],
    fontes: ["Respostas rápidas"],
    passos: [
      ABRIR("Respostas rápidas", "/app/templates"),
      {
        texto: "Clique em Nova resposta rápida.",
        tela: "/app/templates",
        alvo: "nova-resposta-rapida",
        confere: "o formulário aberto",
        conferencia: { ve: "elemento", alvo: "texto-da-resposta" },
        conferido: "O formulário abriu.",
      },
      {
        texto: "Dê um título e escreva o texto que vai sair na conversa.",
        tela: "/app/templates",
        alvo: "texto-da-resposta",
        retomaEm: 1,
        confere: "o texto escrito",
        conferencia: { ve: "algum", de: [{ ve: "preenchido", alvo: "texto-da-resposta", minimo: 10 }, { ve: "sistema", leitura: "resposta_criada" }] },
        conferido: "Texto escrito.",
      },
      {
        texto: "Escreva o atalho: a palavra que você digita depois da barra, na conversa do Inbox. Ex.: endereco.",
        tela: "/app/templates",
        alvo: "atalho-da-resposta",
        retomaEm: 1,
        confere: "o atalho escrito",
        conferencia: { ve: "algum", de: [{ ve: "preenchido", alvo: "atalho-da-resposta", minimo: 2 }, { ve: "sistema", leitura: "resposta_criada" }] },
        conferido: "Atalho escrito.",
      },
      {
        texto: "Clique em Criar resposta rápida.",
        tela: "/app/templates",
        alvo: "salvar-resposta-rapida",
        retomaEm: 1,
        confere: "a resposta salva",
        conferencia: { ve: "sistema", leitura: "resposta_criada" },
        conferido: "Conferi em Respostas rápidas: {nome} salva.",
      },
    ],
    fim: "Pronto. Conferi em Respostas rápidas: {nome} está salva. No Inbox, digite / na conversa e escolha.",
  },
  {
    id: "devolver",
    grupo: "dia",
    titulo: "Assumir e devolver uma conversa para a IA",
    objetivo: "Entrar numa conversa quando precisa, e devolver para o agente quando acabar.",
    pronto: "a conversa aparece de novo com a IA.",
    euFaco: "Nada: atender é com você.",
    soVoce: "Assumir e devolver.",
    tempo: "2 min",
    papel: "agent",
    daEmpresa: false,
    feita: "conversa_devolvida",
    manuais: ["assumir-conversa", "conversas-da-equipe"],
    fontes: ["Caixa de entrada"],
    passos: [
      {
        texto: "Abra o Inbox, na aba Fila: são as conversas que esperam uma pessoa.",
        tela: "/app/inbox",
        ir: "/app/inbox",
        alvo: "aba-fila",
        confere: "a fila aberta",
        conferencia: { ve: "marcado", alvo: "aba-fila" },
        conferido: "A Fila está aberta.",
      },
      {
        texto: "Abra uma conversa.",
        tela: "/app/inbox",
        alvo: "conversa-da-lista*",
        confere: "a conversa aberta",
        conferencia: { ve: "algum", de: [{ ve: "elemento", alvo: "assumir-conversa" }, { ve: "elemento", alvo: "devolver-ao-automatico" }] },
        conferido: "A conversa está aberta.",
      },
      {
        texto: "Clique em Assumir. Enquanto você está nela, a IA fica calada.",
        tela: "/app/inbox",
        alvo: "assumir-conversa",
        retomaEm: 1,
        confere: "a conversa com você",
        conferencia: { ve: "sistema", leitura: "conversa_assumida" },
        conferido: "Conferi: a conversa está com você.",
      },
      {
        texto: "Responda o cliente no campo de baixo.",
        tela: "/app/inbox",
        alvo: "campo-da-mensagem",
        retomaEm: 1,
        confere: "nada aqui: responder é com você",
        conferencia: { ve: "seguir" },
      },
      {
        texto: "Devolva para a IA: clique em Devolver ao automático, no cabeçalho da conversa.",
        tela: "/app/inbox",
        alvo: "devolver-ao-automatico",
        retomaEm: 1,
        confere: "a conversa de volta com a IA",
        conferencia: { ve: "sistema", leitura: "conversa_devolvida" },
        conferido: "Conferi: a conversa voltou para a IA.",
      },
    ],
    fim: "Pronto. Conferi no Inbox: a conversa voltou para a IA, que responde de novo a partir da próxima mensagem do cliente.",
  },

  // ── Guias curtos (o manual de uma tela, com o mesmo destaque) ─────────────
  {
    id: "perdido",
    grupo: "guia",
    curto: true,
    titulo: "Marcar um negócio como perdido",
    objetivo: "O guia curto do manual \"Marcar um negócio como perdido\".",
    pronto: "o negócio aparece como perdido, com o motivo.",
    euFaco: "Nada.",
    soVoce: "Marcar.",
    tempo: "1 min",
    papel: "agent",
    daEmpresa: false,
    feita: "negocio_perdido",
    manuais: ["marcar-perdido"],
    fontes: ["Funis", "Manual do sistema"],
    passos: [
      ABRIR("Funis", "/app/kanban"),
      {
        texto: "Abra o funil do negócio, pelo nome dele na lista.",
        tela: "/app/kanban",
        confere: "o quadro do funil aberto",
        conferencia: { ve: "tela", rota: "/app/pipelines/[id]" },
        conferido: "O quadro do funil está aberto.",
      },
      {
        texto: "Abra o cartão do negócio que você quer marcar.",
        tela: "/app/pipelines/[id]",
        alvo: "cartao-do-negocio*",
        retomaEm: 1,
        confere: "o cartão aberto",
        conferencia: { ve: "elemento", alvo: "cartao-aberto" },
        conferido: "O cartão do negócio abriu.",
      },
      {
        texto: "Clique em Perdido.",
        tela: "/app/pipelines/[id]",
        alvo: "marcar-perdido",
        retomaEm: 2,
        confere: "o pedido de motivo",
        conferencia: { ve: "elemento", alvo: "motivo-da-perda" },
        conferido: "Pedindo o motivo.",
      },
      {
        texto: "Escolha o motivo. Ele entra no relatório de perdas.",
        tela: "/app/pipelines/[id]",
        alvo: "motivo-da-perda",
        retomaEm: 2,
        confere: "o motivo escolhido",
        conferencia: { ve: "marcado", alvo: "motivo-da-perda" },
        conferido: "Motivo escolhido.",
      },
      {
        texto: "Clique em Confirmar.",
        tela: "/app/pipelines/[id]",
        alvo: "confirmar-perda",
        retomaEm: 2,
        confere: "o negócio perdido",
        conferencia: { ve: "sistema", leitura: "negocio_perdido" },
        conferido: "Conferi em Funis: {nome} perdido.",
      },
    ],
    fim: "Pronto. Conferi em Funis: o negócio {nome} está como perdido, motivo \"{motivo}\". O motivo entra no relatório de perdas. Se foi engano, reabra o negócio no cartão.",
  },
];

const POR_ID = new Map<IdDaTrilha, Trilha>(TRILHAS.map((t) => [t.id, t]));

export function trilhaPorId(id: string): Trilha | null {
  return ehIdDeTrilha(id) ? (POR_ID.get(id) ?? null) : null;
}

/** As trilhas (sem os guias curtos), na ordem da lista. */
export const SO_TRILHAS: readonly Trilha[] = TRILHAS.filter((t) => !t.curto);
export const GUIAS_CURTOS: readonly Trilha[] = TRILHAS.filter((t) => t.curto);

/** A pessoa faz esta trilha? O MESMO papel mínimo da tela. */
export function papelFaz(trilha: Pick<Trilha, "papel">, papel: Role | string | null | undefined): boolean {
  return roleAtLeast((papel ?? null) as Role | null, trilha.papel);
}

/** "Quem pode", em palavras, para quem não tem o papel. */
export function rotuloDoPapelDaTrilha(papel: Role): string {
  if (papel === "admin") return "Administrador";
  if (papel === "manager") return "Gestor e administrador";
  return "Todos os papéis";
}

/** A trilha que ensina um manual (o "Me mostra como" da resposta de "como faço"). */
export function trilhaDoManual(manualId: string): Trilha | null {
  return TRILHAS.find((t) => t.manuais.includes(manualId)) ?? null;
}

/**
 * A trilha que ensina cada item "preciso confirmar" do "o que falta" (.91): o
 * número, o agente (o ensaio é ver o agente atender) e a equipe. O plano não
 * tem trilha: é cobrança, e o caminho é a tela de Plano e cobrança.
 */
export const TRILHA_DO_ITEM_DO_QUE_FALTA: Readonly<Record<string, IdDaTrilha>> = {
  whatsapp: "numero",
  agente: "agente",
  ensaio: "agente",
  funil: "funil",
  followup: "followup",
  equipe: "equipe",
};

/** A rota do passo bate com o caminho? `[id]` vale um segmento qualquer. */
export function rotaCasa(caminho: string, rota: string): boolean {
  const limpo = (caminho.split(/[?#]/)[0] ?? "").replace(/\/+$/, "") || "/";
  const partes = limpo.split("/");
  const molde = rota.replace(/\/+$/, "").split("/");
  if (partes.length !== molde.length) return false;
  return molde.every((m, i) => (m.startsWith("[") && m.endsWith("]") ? (partes[i] ?? "").length > 0 : m === partes[i]));
}

/** O endereço do "Me leva até lá" de um passo, quando ele tem um. */
export function irDoPasso(passo: PassoDaTrilha): string | null {
  if (passo.ir) return passo.ir;
  if (passo.tela && !passo.tela.includes("[")) return passo.tela;
  return null;
}

/** As leituras do sistema que uma conferência usa (para o servidor saber o que pode rodar). */
export function leiturasDaConferencia(c: Conferencia): LeituraDoSistema[] {
  if (c.ve === "sistema") return [c.leitura];
  if (c.ve === "algum") return c.de.flatMap(leiturasDaConferencia);
  return [];
}

/** Os marcadores que um passo usa (o destaque e as conferências). Para a cerca. */
export function marcadoresDoPasso(passo: PassoDaTrilha): string[] {
  const daConferencia = (c: Conferencia): string[] => {
    if (c.ve === "algum") return c.de.flatMap(daConferencia);
    if ("alvo" in c) return [c.alvo];
    return [];
  };
  return [...(passo.alvo ? [passo.alvo] : []), ...daConferencia(passo.conferencia)];
}

/** Troca `{nome}` pelos valores. Valor ausente vira vazio, sem deixar a chave à mostra. */
export function encaixar(texto: string, vars: Readonly<Record<string, string>> | undefined): string {
  return texto.replace(/\{([a-z_]+)\}/g, (_, chave: string) => vars?.[chave] ?? "").replace(/\s{2,}/g, " ").trim();
}

/** As trilhas que têm passo nesta tela ("O que dá para fazer nesta tela?"). */
export function trilhasDaTela(caminho: string): Trilha[] {
  return TRILHAS.filter((t) => t.passos.some((p) => p.tela && rotaCasa(caminho, p.tela)));
}
