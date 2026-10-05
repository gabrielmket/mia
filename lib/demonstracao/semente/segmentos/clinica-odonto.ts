/**
 * FORK MIA · DEMONSTRAÇÃO · CLÍNICA ODONTOLÓGICA.
 *
 * A "Clínica Odontológica Modelo" (fictícia) faz avaliação, limpeza,
 * clareamento, implante, prótese, aparelho, alinhadores e lentes. O que a
 * demonstração mostra a quem tem clínica:
 *
 *  - o funil do paciente, do primeiro contato ao tratamento fechado, com a
 *    avaliação marcada, a avaliação feita e o plano com orçamento enviado;
 *  - a agenda de avaliações (uma marcada pela IA), sessões e retornos, com uma
 *    falta e um cancelamento;
 *  - o retorno e manutenção a cada seis meses como atividade recorrente: um
 *    atrasado, dois chegando e um em dia, com o histórico dos anteriores;
 *  - o orçamento assinado como documento, com um arquivo da paciente esperando
 *    confirmação;
 *  - os quatro follow-ups de clínica publicados, inclusive o de quem sumiu na
 *    marcação;
 *  - o catálogo de tratamentos com preço de referência e um convênio de empresa.
 *
 * Dados fictícios: telefone do DDD 00, e-mail `.invalid`, CNPJ que não existe.
 * Nenhum texto de follow-up nomeia procedimento (é o modelo do produto).
 */
import { MODULO_DOS_LEADS_DA_META } from "@/lib/leads-da-meta/modulo";

import type { SementeDeDemonstracao } from "../tipos";
import { cnpjFalso, escolha } from "./comum";

/** Status de ciclo de vida gravado (ver `ConversaDaSemente.status`): a conversa está com a IA. */
const CONVERSA_COM_A_IA = "ai_handling" as const;

export const CLINICA_ODONTO: SementeDeDemonstracao = {
  segmento: "clinica-odonto",
  rotulo: "Clínica odontológica",
  oQueMostra:
    "Uma clínica odontológica: avaliação marcada pela IA, plano de tratamento e orçamento, implante, alinhadores e clareamento, o retorno de seis meses como atividade recorrente e o follow-up de quem sumiu na marcação.",
  nome: "Demonstração · Clínica Odontológica",
  razaoSocial: "Clínica Odontológica Modelo Demonstração (fictícia)",
  slug: "demonstracao-clinica-odontologica",
  prefixoDosIds: "demo:clinica-odonto",
  sessaoDoCanal: "demonstracao-clinica-odontologica",
  telefoneDoCanal: "+5500900020000",
  modoDeVenda: "b2c",
  formularioDaMeta: "Formulário · Avaliação odontológica (demonstração)",
  enderecoFicticio: "Clínica Odontológica Modelo, sala 3 (endereço fictício)",
  equipe: [
    { chave: "lucia", nome: "Dra. Lúcia Arantes", papel: "manager", trilha: 1 },
    { chave: "ricardo", nome: "Dr. Ricardo Paes", papel: "agent", trilha: 2 },
    { chave: "mirela", nome: "Mirela Souto", papel: "agent", trilha: 3 },
    { chave: "joana", nome: "Joana Bittencourt", papel: "agent", trilha: 4 },
  ],
  gestor: "lucia",
  agente: {
    chave: "clara",
    nome: "Clara · Recepção da clínica (demonstração)",
    descricao:
      "Agente de exemplo da clínica de demonstração. Não tem versão publicada e o canal está arquivado: não atende ninguém de verdade.",
    prompt:
      "Você é a Clara, da recepção da Clínica Odontológica Modelo. Atende pelo WhatsApp quem quer marcar avaliação, tirar dúvida de tratamento ou remarcar. Entende o que a pessoa procura e oferece a avaliação com a dentista, que é o primeiro passo de todo tratamento. Fala o preço de referência da avaliação, da limpeza e do clareamento, que estão no catálogo; preço de implante, prótese e aparelho só depois da avaliação. Não dá diagnóstico e não promete resultado. Marca na agenda e passa para a coordenadora de orçamentos quem já fez a avaliação.",
  },
  modulos: ["disparador", MODULO_DOS_LEADS_DA_META],
  empresas: [
    {
      chave: "vertice",
      nome: "Grupo Vértice Logística",
      site: null,
      cidade: "Belo Horizonte",
      uf: "MG",
      setor: "Convênio empresarial",
      observacoes: "Convênio para os funcionários: avaliação e limpeza cobertas, os outros tratamentos com 15% de desconto.",
      tags: ["convenio"],
      cnpj: cnpjFalso(201),
      campos: { desconto: "15% nos tratamentos" },
    },
  ],
  contatos: [
    { chave: "larissa", nome: "Larissa Antunes", n: 201, comEmail: true, tags: ["paciente"] },
    { chave: "eduardo", nome: "Eduardo Paiva", n: 202, comEmail: true, tags: ["paciente"] },
    { chave: "sonia", nome: "Sônia Ferraz", n: 203, comEmail: false, tags: ["paciente"] },
    { chave: "kelly", nome: "Kelly Rocha", n: 204, comEmail: true, tags: ["paciente"] },
    { chave: "tiago", nome: "Tiago Bastos", n: 205, comEmail: true, tags: ["paciente"] },
    { chave: "renan", nome: "Renan Couto", n: 206, comEmail: false },
    { chave: "bruna", nome: "Bruna Salles", n: 207, comEmail: true },
    { chave: "manoel", nome: "Manoel Pires", n: 208, comEmail: false },
    { chave: "cecilia", nome: "Cecília Vargas", n: 209, comEmail: true },
    { chave: "heloisa", nome: "Heloísa Martins", n: 210, comEmail: true, tags: ["paciente"] },
    { chave: "jorge", nome: "Jorge Amaral", n: 211, comEmail: false },
    { chave: "flavia", nome: "Flávia Monteiro", n: 212, comEmail: true, tags: ["paciente"] },
    { chave: "antonio", nome: "Antônio Carlos Reis", n: 213, comEmail: false, tags: ["paciente"] },
    { chave: "mariana", nome: "Mariana Teles", n: 214, comEmail: true, tags: ["paciente"] },
    { chave: "vitor", nome: "Vítor Campos", n: 215, comEmail: false },
    { chave: "denise-vertice", nome: "Denise Albuquerque", n: 216, comEmail: true, empresa: "vertice", cargo: "Coordenadora de RH", setor: "Recursos humanos", decisor: true },
    { chave: "rogerio-vertice", nome: "Rogério Lima", n: 217, comEmail: false, empresa: "vertice", cargo: "Motorista", setor: "Operações", tags: ["paciente"] },
    { chave: "paula", nome: "Paula Brandão", n: 218, comEmail: true },
    { chave: "silvana", nome: "Silvana Duarte", n: 219, comEmail: true },
  ],
  funis: [
    {
      chave: "tratamentos",
      nome: "Pacientes · Avaliação e tratamento",
      descricao: "Do primeiro contato ao tratamento fechado: a avaliação é o primeiro passo, o plano e o orçamento vêm depois dela.",
      etapas: [
        { chave: "novo", nome: "Novo contato", passo: "new", probabilidade: 5, prazoHoras: 24 },
        { chave: "respondi", nome: "Já respondi", passo: "contacted", probabilidade: 10, prazoHoras: 24 },
        { chave: "caso", nome: "Entendendo o caso", passo: "qualifying", probabilidade: 20, prazoHoras: 48 },
        { chave: "avaliacao", nome: "Avaliação marcada", passo: "qualified", probabilidade: 35, prazoHoras: 120 },
        { chave: "avaliado", nome: "Avaliação feita", passo: null, probabilidade: 50, prazoHoras: 72 },
        { chave: "plano", nome: "Plano e orçamento enviados", passo: "negotiating", probabilidade: 65, prazoHoras: 168 },
        { chave: "fechado", nome: "Tratamento fechado", passo: "won", fim: "won" },
        { chave: "perdido", nome: "Não fechou", passo: "lost", fim: "lost" },
      ],
      nichoDeFollowup: "clinica",
      vocabulario: { lead: "Paciente", lead_plural: "Pacientes", deal: "Tratamento", deal_plural: "Tratamentos", won: "Tratamento fechado", lost: "Não fechou" },
      campos: [
        escolha("procedimento", "Tratamento de interesse", [
          "Avaliação",
          "Limpeza e prevenção",
          "Clareamento",
          "Implante",
          "Prótese protocolo",
          "Aparelho fixo",
          "Alinhadores",
          "Canal",
          "Lentes de contato dental",
        ]),
        escolha("pagamento", "Pagamento", ["Particular à vista", "Particular parcelado", "Convênio"]),
        { key: "convenio", label: "Convênio", type: "text" },
        { key: "plano_de_tratamento", label: "Plano de tratamento", type: "textarea" },
        { key: "dentista", label: "Dentista responsável", type: "text" },
        { key: "sessoes", label: "Sessões previstas", type: "number" },
        { key: "primeira_vez", label: "Primeira vez na clínica", type: "boolean" },
      ],
      motivosDePerda: [
        { label: "Fechou com outra clínica", categoria: "Concorrência" },
        { label: "Sem condições no momento", categoria: "Cliente" },
        { label: "Insegurança com o tratamento", categoria: "Cliente" },
        { label: "Não respondeu mais", categoria: "Ausência" },
        { label: "Convênio não cobre", categoria: "Mérito" },
        { label: "Valor do orçamento", categoria: "Nós" },
      ],
      motivosDeGanho: ["Avaliação convenceu", "Parcelamento", "Indicação de paciente", "Horário que serviu"],
      vitoriaEReceita: true,
      negocios: [
        { titulo: "Renan Couto · lentes de contato dental", passo: "novo", contato: "renan", valorReais: 8400, dono: "ia", origem: "meta_formulario", criadoHaDias: 0, naEtapaHaDias: 0, campos: { procedimento: "Lentes de contato dental", primeira_vez: true } },
        { titulo: "Bruna Salles · limpeza", passo: "respondi", contato: "bruna", valorReais: 220, dono: "ia", origem: "google", criadoHaDias: 1, naEtapaHaDias: 1, campos: { procedimento: "Limpeza e prevenção", pagamento: "Particular à vista" } },
        { titulo: "Manoel Pires · canal", passo: "caso", contato: "manoel", valorReais: 1100, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 1, naEtapaHaDias: 0, campos: { procedimento: "Canal" }, nota: "Pediu encaixe ainda esta semana." },
        { titulo: "Paula Brandão · clareamento", passo: "caso", contato: "paula", valorReais: 1200, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 4, naEtapaHaDias: 3, campos: { procedimento: "Clareamento", primeira_vez: true } },
        { titulo: "Larissa Antunes · clareamento", passo: "avaliacao", contato: "larissa", valorReais: 1200, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 2, naEtapaHaDias: 1, campos: { procedimento: "Clareamento", pagamento: "Particular parcelado", primeira_vez: true } },
        { titulo: "Jorge Amaral · prótese", passo: "avaliacao", contato: "jorge", valorReais: 6800, dono: "mirela", origem: "indicacao", criadoHaDias: 5, naEtapaHaDias: 2, campos: { procedimento: "Prótese protocolo" }, proximaAcao: { titulo: "Confirmar a avaliação de amanhã com o Jorge", emDias: 0 } },
        { titulo: "Tiago Bastos · implante", passo: "avaliado", contato: "tiago", valorReais: 4500, dono: "ricardo", origem: "google", criadoHaDias: 9, naEtapaHaDias: 2, campos: { procedimento: "Implante", dentista: "Dr. Ricardo Paes" }, proximaAcao: { titulo: "Ver se o Tiago marcou a tomografia", emDias: 1, prioridade: "high" } },
        { titulo: "Rogério Lima · limpeza pelo convênio", passo: "avaliado", contato: "rogerio-vertice", valorReais: 180, dono: "mirela", origem: "indicacao", criadoHaDias: 6, naEtapaHaDias: 1, campos: { procedimento: "Limpeza e prevenção", pagamento: "Convênio", convenio: "Convênio empresa · Grupo Vértice" }, proximaAcao: { titulo: "Conferir com o RH do Grupo Vértice se a limpeza está coberta", emDias: 1 } },
        { titulo: "Eduardo Paiva · implante de dois dentes", passo: "plano", contato: "eduardo", valorReais: 9800, dono: "joana", origem: "google", criadoHaDias: 15, naEtapaHaDias: 5, campos: { procedimento: "Implante", pagamento: "Particular parcelado", plano_de_tratamento: "Dois implantes com coroa na região inferior. Seis sessões em cerca de quatro meses.", dentista: "Dr. Ricardo Paes", sessoes: 6 }, proximaAcao: { titulo: "Mandar ao Eduardo as duas opções de parcelamento", emDias: 0, prioridade: "urgent" } },
        { titulo: "Kelly Rocha · alinhadores", passo: "plano", contato: "kelly", valorReais: 9800, dono: "joana", origem: "meta_formulario", criadoHaDias: 12, naEtapaHaDias: 4, campos: { procedimento: "Alinhadores", pagamento: "Particular parcelado", sessoes: 12 }, proximaAcao: { titulo: "Conferir o orçamento assinado e marcar o escaneamento", emDias: 1, prioridade: "high" } },
        { titulo: "Silvana Duarte · lentes de contato dental", passo: "plano", contato: "silvana", valorReais: 11200, dono: "joana", origem: "indicacao", criadoHaDias: 20, naEtapaHaDias: 9, campos: { procedimento: "Lentes de contato dental", pagamento: "Particular parcelado", sessoes: 4 }, proximaAcao: { titulo: "Ligar para a Silvana sobre o ensaio estético das lentes", emDias: 2 } },
        { titulo: "Sônia Ferraz · prótese protocolo", passo: "fechado", contato: "sonia", valorReais: 22000, dono: "joana", origem: "indicacao", criadoHaDias: 50, naEtapaHaDias: 20, campos: { procedimento: "Prótese protocolo", dentista: "Dr. Ricardo Paes", sessoes: 8 }, motivoDoGanho: "Avaliação convenceu" },
        { titulo: "Heloísa Martins · clareamento", passo: "fechado", contato: "heloisa", valorReais: 1200, dono: "mirela", origem: "meta_clique_whatsapp", criadoHaDias: 30, naEtapaHaDias: 12, campos: { procedimento: "Clareamento", pagamento: "Particular parcelado" }, motivoDoGanho: "Parcelamento" },
        { titulo: "Cecília Vargas · aparelho fixo", passo: "perdido", contato: "cecilia", valorReais: 4200, dono: "joana", origem: "google", criadoHaDias: 28, naEtapaHaDias: 15, campos: { procedimento: "Aparelho fixo" }, motivoDaPerda: "Fechou com outra clínica" },
        { titulo: "Vítor Campos · avaliação", passo: "perdido", contato: "vitor", valorReais: null, dono: "mirela", origem: "meta_formulario", criadoHaDias: 14, naEtapaHaDias: 2, campos: { procedimento: "Avaliação" }, motivoDaPerda: "Não respondeu mais", nota: "Faltou na avaliação e não respondeu aos convites para remarcar." },
      ],
    },
  ],
  funilPadrao: "tratamentos",
  conversas: [
    {
      chave: "larissa",
      contato: "larissa",
      comecouHaDias: 1,
      passo: "qualified",
      qualificacao: {
        authority: "Decide sozinha",
        need: "Clareamento antes das férias de dezembro",
        timeline: "Quer fazer em até dois meses",
      },
      proximaAcao: "Receber a Larissa na avaliação de quinta",
      ficha: {
        headline: "Clareamento · primeira vez · avaliação quinta 18h30",
        body:
          "Larissa quer clarear os dentes antes das férias de dezembro. Nunca fez clareamento. Avaliação marcada pela IA para quinta às 18h30 com a Dra. Lúcia.",
      },
      com: "ia",
      status: CONVERSA_COM_A_IA,
      etiquetas: ["Meta_ads", "clareamento"],
      mensagens: [
        { de: "cliente", texto: "Oi! Vi o anúncio do clareamento. Como funciona?", min: 0 },
        { de: "ia", texto: "Oi, Larissa! Aqui é a Clara, da recepção da clínica. O clareamento começa com uma avaliação com a dentista, que confere se está tudo certo e indica o melhor tipo. A avaliação é gratuita. Você já fez clareamento alguma vez?", min: 1 },
        { de: "cliente", texto: "Nunca fiz. Quero fazer antes das férias, em dezembro.", min: 6 },
        { de: "ia", texto: "Dá tempo com folga. Tenho avaliação na quinta às 18h30 ou na sexta às 9h. Qual fica melhor?", min: 7 },
        { de: "cliente", texto: "Quinta às 18h30.", min: 12 },
        { de: "ia", texto: "Marcado! Quinta às 18h30 com a Dra. Lúcia. Qualquer imprevisto, é só me avisar por aqui.", min: 13 },
      ],
    },
    {
      chave: "eduardo",
      contato: "eduardo",
      comecouHaDias: 1,
      passo: "negotiating",
      qualificacao: {
        budget: "Quer parcelar em 12 vezes",
        authority: "Decide sozinho",
        need: "Dois implantes na região inferior",
        timeline: "Começar ainda este mês",
      },
      proximaAcao: "Mandar as duas opções de parcelamento",
      ficha: {
        headline: "Dois implantes · quer 12x · começar este mês",
        body:
          "Eduardo recebeu o plano de dois implantes com coroa. Pediu parcelamento maior e quer começar ainda este mês. Falta devolver o orçamento assinado.",
      },
      com: "joana",
      status: "claimed",
      etiquetas: ["Google_ads", "implante"],
      mensagens: [
        { de: "cliente", texto: "Joana, recebi o orçamento dos implantes. Dá para parcelar em mais vezes?", min: 0 },
        { de: "equipe", texto: "Oi, Eduardo! Dá sim. No cartão fazemos em até 12x, e no boleto da clínica dá para dividir a parte da prótese ao longo do tratamento. Quer que eu monte as duas opções?", min: 20 },
        { de: "cliente", texto: "Quero, por favor. E quando seria a primeira sessão?", min: 34 },
        { de: "equipe", texto: "Assim que você aprovar, o Dr. Ricardo já tem horário na semana seguinte. Te mando as opções ainda hoje.", min: 41 },
      ],
    },
    {
      chave: "kelly",
      contato: "kelly",
      comecouHaDias: 0,
      passo: "negotiating",
      qualificacao: {
        budget: "Parcelado no cartão",
        authority: "Decide sozinha",
        need: "Alinhadores transparentes",
        timeline: "Começar no mês que vem",
      },
      proximaAcao: "Conferir o orçamento assinado e marcar o escaneamento",
      ficha: {
        headline: "Alinhadores · orçamento assinado enviado",
        body: "Kelly mandou o orçamento dos alinhadores assinado pelo WhatsApp. Falta a coordenação conferir e marcar o escaneamento.",
      },
      passagem: {
        titulo: "Kelly devolveu o orçamento assinado",
        resumo: "Arquivo recebido na conversa. Conferir, anexar ao tratamento e marcar o escaneamento.",
        ultimaFala: "Pronto, enviei o PDF.",
      },
      com: "joana",
      status: "open",
      etiquetas: ["Meta_ads", "alinhadores"],
      mensagens: [
        { de: "ia", texto: "Oi, Kelly! Aqui é a Clara. A Joana pediu para lembrar do orçamento dos alinhadores: se estiver de acordo, é só devolver assinado por aqui.", min: 0 },
        { de: "cliente", texto: "Oi! Assinei agora, vou mandar.", min: 50 },
        { de: "cliente", texto: "Pronto, enviei o PDF.", min: 52 },
        { de: "ia", texto: "Recebi, obrigada! Vou passar para a Joana conferir e já te chamo para marcar o escaneamento.", min: 53 },
      ],
    },
    {
      chave: "paula",
      contato: "paula",
      comecouHaDias: 3,
      passo: "qualifying",
      qualificacao: { need: "Clareamento", timeline: "Ainda vai ver a agenda" },
      proximaAcao: "Oferecer os horários de novo",
      ficha: {
        headline: "Clareamento · sumiu na hora de marcar",
        body: "Paula perguntou o preço do clareamento, gostou e ficou de ver a agenda. Não respondeu os horários oferecidos.",
      },
      com: "ia",
      status: CONVERSA_COM_A_IA,
      etiquetas: ["Meta_ads"],
      mensagens: [
        { de: "cliente", texto: "Quanto custa o clareamento?", min: 0 },
        { de: "ia", texto: "Oi, Paula! O clareamento em consultório sai a partir de R$ 1.200, em até 6x, e começa com uma avaliação gratuita. Quer que eu veja um horário para você nesta semana?", min: 1 },
        { de: "cliente", texto: "Quero sim, mas preciso ver minha agenda.", min: 9 },
        { de: "ia", texto: "Claro! Tenho terça às 17h ou quarta às 12h. Se outro horário for melhor, me diz.", min: 10 },
      ],
    },
    {
      chave: "vitor",
      contato: "vitor",
      comecouHaDias: 12,
      passo: "lost",
      qualificacao: { need: "Avaliação" },
      proximaAcao: null,
      ficha: {
        headline: "Faltou na avaliação · não respondeu para remarcar",
        body: "Vítor marcou a avaliação pela IA, faltou e não respondeu aos convites para remarcar.",
      },
      com: "ia",
      status: "resolved",
      mensagens: [
        { de: "cliente", texto: "Queria marcar uma avaliação.", min: 0 },
        { de: "ia", texto: "Oi, Vítor! Tenho segunda às 8h ou terça às 14h. Qual fica melhor?", min: 1 },
        { de: "cliente", texto: "Segunda às 8h.", min: 5 },
        { de: "ia", texto: "Marcado para segunda às 8h com o Dr. Ricardo. Até lá!", min: 6 },
      ],
    },
  ],
  tiposDeAgenda: [
    { slug: "avaliacao", nome: "Avaliação odontológica", categoria: "consulta", duracao: 40 },
    { slug: "sessao", nome: "Sessão de tratamento", categoria: "procedimento", duracao: 60 },
    { slug: "retorno", nome: "Retorno e manutenção", categoria: "retorno", duracao: 30 },
  ],
  compromissos: [
    { chave: "larissa-avaliacao", tipo: "avaliacao", titulo: "Avaliação · Larissa", contato: "larissa", dono: "lucia", emDias: 3, hora: "18:30", duracaoMin: 40, status: "confirmed", local: "in_person", criadoPor: "ai" },
    { chave: "jorge-avaliacao", tipo: "avaliacao", titulo: "Avaliação de prótese · Jorge", contato: "jorge", dono: "lucia", emDias: 1, hora: "10:00", duracaoMin: 40, status: "pending", local: "in_person", criadoPor: "user" },
    { chave: "rogerio-limpeza", tipo: "sessao", titulo: "Limpeza pelo convênio · Rogério", contato: "rogerio-vertice", dono: "lucia", emDias: 2, hora: "08:30", duracaoMin: 45, status: "confirmed", local: "in_person", criadoPor: "user" },
    { chave: "mariana-retorno", tipo: "retorno", titulo: "Retorno de seis meses · Mariana", contato: "mariana", dono: "lucia", emDias: 4, hora: "09:00", duracaoMin: 30, status: "confirmed", local: "in_person", criadoPor: "user" },
    { chave: "denise-convenio", tipo: "reuniao", titulo: "Renovação do convênio · Grupo Vértice", contato: "denise-vertice", dono: "lucia", emDias: 6, hora: "12:00", duracaoMin: 30, status: "pending", local: "phone", criadoPor: "user" },
    { chave: "sonia-prova", tipo: "sessao", titulo: "Prova da prótese · Sônia", contato: "sonia", dono: "ricardo", emDias: 5, hora: "14:00", duracaoMin: 60, status: "confirmed", local: "in_person", criadoPor: "user" },
    { chave: "eduardo-primeira-sessao", tipo: "sessao", titulo: "Primeira sessão de implante · Eduardo", contato: "eduardo", dono: "ricardo", emDias: 8, hora: "09:00", duracaoMin: 90, status: "pending", local: "in_person", criadoPor: "user", nota: "Depende da aprovação do orçamento." },
    { chave: "sonia-sessao", tipo: "sessao", titulo: "Sessão de prótese · Sônia", contato: "sonia", dono: "ricardo", emDias: -6, hora: "14:00", duracaoMin: 90, status: "completed", local: "in_person", criadoPor: "user" },
    { chave: "tiago-avaliacao", tipo: "avaliacao", titulo: "Avaliação de implante · Tiago", contato: "tiago", dono: "ricardo", emDias: -2, hora: "11:00", duracaoMin: 40, status: "completed", local: "in_person", criadoPor: "ai", nota: "A dentista pediu uma tomografia antes de fechar o plano." },
    { chave: "heloisa-clareamento", tipo: "sessao", titulo: "Clareamento · Heloísa", contato: "heloisa", dono: "lucia", emDias: -12, hora: "15:00", duracaoMin: 60, status: "completed", local: "in_person", criadoPor: "user" },
    { chave: "vitor-avaliacao", tipo: "avaliacao", titulo: "Avaliação · Vítor", contato: "vitor", dono: "ricardo", emDias: -10, hora: "08:00", duracaoMin: 40, status: "no_show", local: "in_person", criadoPor: "ai" },
    { chave: "cecilia-avaliacao", tipo: "avaliacao", titulo: "Avaliação de aparelho · Cecília", contato: "cecilia", dono: "lucia", emDias: -15, hora: "16:00", duracaoMin: 40, status: "cancelled", local: "in_person", criadoPor: "user", nota: "A paciente cancelou: fechou com outra clínica." },
  ],
  tarefas: [
    { chave: "orcamentos-semana", titulo: "Conferir os orçamentos assinados da semana", dono: "joana", emDias: 1, prioridade: "medium", status: "pending" },
    { chave: "retornos-atrasados", titulo: "Ligar para os pacientes com retorno atrasado", dono: "mirela", emDias: -2, prioridade: "high", status: "pending", descricao: "Atrasada de propósito: a lista de atrasadas precisa de exemplo." },
    { chave: "material-clareamento", titulo: "Repor o material de clareamento", dono: "lucia", emDias: 5, prioridade: "low", status: "in_progress" },
    { chave: "relatorio-convenio", titulo: "Mandar o relatório de atendimentos do convênio", dono: "mirela", emDias: -3, prioridade: "medium", status: "done", contato: "denise-vertice" },
    { chave: "tabela-2027", titulo: "Revisar a tabela de preços do ano que vem", dono: "lucia", emDias: null, prioridade: "low", status: "pending" },
    { chave: "fotos-site", titulo: "Atualizar as fotos da recepção no site", dono: "mirela", emDias: -8, prioridade: "low", status: "cancelled" },
  ],
  followups: [
    { modelo: "clinica-consulta-retomada", funil: "tratamentos", etapa: "respondi" },
    // O "exame" da odontologia: a dentista pediu radiografia ou tomografia na avaliação.
    { modelo: "clinica-exame-marcar", funil: "tratamentos", etapa: "avaliado" },
    // A "cirurgia": implante, prótese e lentes são decisões grandes, de semanas.
    { modelo: "clinica-cirurgia-decisao", funil: "tratamentos", etapa: "plano" },
    { modelo: "clinica-falta-remarcar", funil: "tratamentos", etapa: "avaliacao" },
  ],
  inscricoes: [
    { chave: "paula-retomada", modelo: "clinica-consulta-retomada", contato: "paula", status: "waiting_reply", no: "resposta-1", passos: 1, comecouHaDias: 2, proximaEmHoras: 20 },
    { chave: "tiago-exame", modelo: "clinica-exame-marcar", contato: "tiago", status: "active", no: "espera-2", passos: 2, comecouHaDias: 2, proximaEmHoras: 30 },
    { chave: "silvana-decisao", modelo: "clinica-cirurgia-decisao", contato: "silvana", status: "waiting_reply", no: "resposta-2", passos: 4, comecouHaDias: 9, proximaEmHoras: 96 },
    { chave: "kelly-decisao", modelo: "clinica-cirurgia-decisao", contato: "kelly", status: "completed", no: "fim-respondeu", passos: 3, comecouHaDias: 4, desfecho: "replied" },
    { chave: "vitor-falta", modelo: "clinica-falta-remarcar", contato: "vitor", status: "completed", no: "fim-esgotou", passos: 7, comecouHaDias: 10, desfecho: "exhausted" },
  ],
  obrigacoes: {
    funil: "tratamentos",
    segmento: "clinica",
    itens: [
      { chave: "orcamento-sonia", tipo: "Orçamento assinado", negocio: "Sônia Ferraz · prótese protocolo", responsavel: "joana", recebidoEmDias: -20 },
      { chave: "contrato-sonia", tipo: "Contrato de tratamento assinado", negocio: "Sônia Ferraz · prótese protocolo", responsavel: "joana", recebidoEmDias: -19 },
      { chave: "contrato-heloisa", tipo: "Contrato de tratamento assinado", negocio: "Heloísa Martins · clareamento", responsavel: "mirela", recebidoEmDias: -12 },
      { chave: "orcamento-eduardo", tipo: "Orçamento assinado", negocio: "Eduardo Paiva · implante de dois dentes", responsavel: "joana", pedidoEmDias: -5, prazoEmDias: -1 },
      {
        chave: "contrato-eduardo",
        tipo: "Contrato de tratamento assinado",
        negocio: "Eduardo Paiva · implante de dois dentes",
        responsavel: "joana",
        observacao: "Pedir junto com o orçamento assinado.",
      },
      {
        chave: "orcamento-kelly",
        tipo: "Orçamento assinado",
        negocio: "Kelly Rocha · alinhadores",
        responsavel: "joana",
        pedidoEmDias: -2,
        prazoEmDias: 3,
        proposta: { conversa: "kelly", arquivo: "orcamento-assinado.pdf" },
      },
      {
        chave: "retorno-flavia",
        tipo: "Retorno e manutenção",
        contato: "flavia",
        responsavel: "mirela",
        proximaEmDias: 9,
        feitaEmDias: -173,
        ciclos: [
          { proximaEmDias: -356, feitaEmDias: -355 },
          { proximaEmDias: -174, feitaEmDias: -173 },
        ],
      },
      {
        chave: "retorno-antonio",
        tipo: "Retorno e manutenção",
        contato: "antonio",
        responsavel: "mirela",
        proximaEmDias: -12,
        feitaEmDias: -194,
        observacao: "Não respondeu ao convite para o retorno.",
        ciclos: [{ proximaEmDias: -195, feitaEmDias: -194 }],
      },
      {
        chave: "retorno-mariana",
        tipo: "Retorno e manutenção",
        contato: "mariana",
        responsavel: "mirela",
        proximaEmDias: 4,
        feitaEmDias: -178,
        ciclos: [{ proximaEmDias: -180, feitaEmDias: -178 }],
      },
      { chave: "retorno-heloisa", tipo: "Retorno e manutenção", contato: "heloisa", responsavel: "mirela", proximaEmDias: 160, feitaEmDias: -20 },
    ],
  },
  produtos: [
    { codigo: "AVALIACAO", nome: "Avaliação odontológica", descricao: "Primeira consulta com a dentista: exame clínico, plano de tratamento e orçamento. Gratuita.", categoria: "Avaliação", precoReais: 0, controlaEstoque: false },
    { codigo: "LIMPEZA", nome: "Limpeza e prevenção", descricao: "Limpeza, polimento e aplicação de flúor. Coberta pelo convênio de empresa.", categoria: "Prevenção", precoReais: 220, controlaEstoque: false },
    { codigo: "CLAREAMENTO-CONSULTORIO", nome: "Clareamento em consultório", descricao: "Duas sessões de uma hora. Parcela em até 6x. Começa pela avaliação.", categoria: "Estética", precoReais: 1200, controlaEstoque: false },
    { codigo: "CLAREAMENTO-CASEIRO", nome: "Clareamento caseiro com moldeira", descricao: "Moldeira sob medida e gel para três semanas de uso em casa.", categoria: "Estética", precoReais: 890, controlaEstoque: false },
    { codigo: "LENTES-DENTE", nome: "Lente de contato dental (por dente)", descricao: "Valor por dente. O plano final sai depois da avaliação e do ensaio estético.", categoria: "Estética", precoReais: 1400, controlaEstoque: false },
    { codigo: "IMPLANTE-UNITARIO", nome: "Implante unitário com coroa", descricao: "Valor por dente: implante, componente e coroa. O plano final sai depois da avaliação e da tomografia.", categoria: "Implantes e próteses", precoReais: 4500, controlaEstoque: false },
    { codigo: "PROTESE-PROTOCOLO", nome: "Prótese protocolo (arcada)", descricao: "Prótese fixa sobre implantes para a arcada inteira. Parcela em até 18x.", categoria: "Implantes e próteses", precoReais: 22000, controlaEstoque: false },
    { codigo: "APARELHO-FIXO", nome: "Aparelho fixo (instalação)", descricao: "Instalação do aparelho metálico. A manutenção é mensal.", categoria: "Ortodontia", precoReais: 1500, controlaEstoque: false },
    { codigo: "APARELHO-MANUTENCAO", nome: "Manutenção do aparelho (mensal)", descricao: "Consulta mensal de ajuste do aparelho fixo.", categoria: "Ortodontia", precoReais: 180, controlaEstoque: false },
    { codigo: "ALINHADORES", nome: "Alinhadores transparentes (tratamento completo)", descricao: "Escaneamento, planejamento digital e as placas do tratamento inteiro. Parcela em até 12x.", categoria: "Ortodontia", precoReais: 9800, controlaEstoque: false },
    { codigo: "CANAL", nome: "Tratamento de canal", descricao: "Valor de referência para um dente. O plano depende da avaliação.", categoria: "Tratamentos", precoReais: 1100, controlaEstoque: false },
    { codigo: "RESTAURACAO", nome: "Restauração em resina", descricao: "Valor por face restaurada.", categoria: "Tratamentos", precoReais: 250, controlaEstoque: false },
  ],
};
