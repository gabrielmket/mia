/**
 * FORK MIA · DEMONSTRAÇÃO · ACADEMIA.
 *
 * A "Academia Modelo" (fictícia) tem musculação, funcional, pilates e aulas
 * coletivas. O que a demonstração mostra a quem tem academia ou estúdio:
 *
 *  - o funil de matrícula, do primeiro contato à aula experimental marcada pela
 *    IA, à escolha do plano e à matrícula;
 *  - o funil de renovação e retenção: o plano vencendo, o aluno em risco por
 *    ter parado de vir, a reavaliação antes de renovar e quem cancelou;
 *  - a renovação do plano e a reavaliação física a cada três meses como
 *    atividades recorrentes, com uma atrasada de quem não voltou;
 *  - os planos e serviços no catálogo, com o plano empresa;
 *  - os quatro follow-ups de academia publicados, inclusive o de quem faltou na
 *    aula experimental e o de quem sumiu.
 *
 * Nenhum texto fala de peso, corpo ou saúde de ninguém nem promete resultado de
 * treino. Dados fictícios: telefone do DDD 00, e-mail `.invalid`, CNPJ que não
 * existe.
 */
import { MODULO_DOS_LEADS_DA_META } from "@/lib/leads-da-meta/modulo";

import type { SementeDeDemonstracao } from "../tipos";
import { cnpjFalso, escolha } from "./comum";

/** Status de ciclo de vida gravado (ver `ConversaDaSemente.status`): a conversa está com a IA. */
const CONVERSA_COM_A_IA = "ai_handling" as const;

const PLANOS = ["Mensal", "Trimestral", "Semestral", "Anual"];

export const ACADEMIA: SementeDeDemonstracao = {
  segmento: "academia",
  rotulo: "Academia",
  oQueMostra:
    "Uma academia: aula experimental marcada pela IA, escolha do plano e matrícula, a renovação e a reavaliação física como atividades recorrentes e o follow-up de quem faltou ou parou de vir.",
  nome: "Demonstração · Academia",
  razaoSocial: "Academia Modelo Demonstração (fictícia)",
  slug: "demonstracao-academia",
  prefixoDosIds: "demo:academia",
  sessaoDoCanal: "demonstracao-academia",
  telefoneDoCanal: "+5500900040000",
  modoDeVenda: "b2c",
  formularioDaMeta: "Formulário · Aula experimental grátis (demonstração)",
  enderecoFicticio: "Academia Modelo, recepção (endereço fictício)",
  equipe: [
    { chave: "juliano", nome: "Juliano Prestes", papel: "manager", trilha: 1 },
    { chave: "bianca", nome: "Bianca Lemos", papel: "agent", trilha: 2 },
    { chave: "eder", nome: "Éder Campos", papel: "agent", trilha: 3 },
    { chave: "nayara", nome: "Nayara Pontes", papel: "agent", trilha: 4 },
  ],
  gestor: "juliano",
  agente: {
    chave: "duda",
    nome: "Duda · Atendimento da academia (demonstração)",
    descricao:
      "Agente de exemplo da academia de demonstração. Não tem versão publicada e o canal está arquivado: não atende ninguém de verdade.",
    prompt:
      "Você é a Duda, do atendimento da Academia Modelo. Responde pelo WhatsApp quem quer conhecer a academia, saber de planos e horários ou voltar a treinar. Entende o objetivo, a rotina e a modalidade, oferece a aula experimental gratuita e marca na agenda. Fala dos planos e valores do catálogo, sem prometer resultado de treino e sem comentar o corpo ou a saúde de ninguém. Quem já escolheu o plano vai para a consultora fechar a matrícula.",
  },
  modulos: ["disparador", MODULO_DOS_LEADS_DA_META],
  empresas: [
    {
      chave: "prisma",
      nome: "Contabilidade Prisma",
      site: "https://prisma.exemplo.invalid",
      cidade: "Curitiba",
      uf: "PR",
      setor: "Plano empresa",
      observacoes: "Plano corporativo: 10% de desconto no plano anual para os funcionários.",
      tags: ["plano-empresa"],
      cnpj: cnpjFalso(401),
      campos: { desconto: "10% no plano anual", funcionarios_matriculados: 6 },
    },
  ],
  contatos: [
    { chave: "leticia", nome: "Letícia Moraes", n: 401, comEmail: true },
    { chave: "pedro", nome: "Pedro Lucas Alves", n: 402, comEmail: false },
    { chave: "sandra", nome: "Sandra Melo", n: 403, comEmail: true },
    { chave: "lucas", nome: "Lucas Ferraz", n: 404, comEmail: true },
    { chave: "gisele", nome: "Gisele Rocha", n: 405, comEmail: true },
    { chave: "matheus", nome: "Matheus Correia", n: 406, comEmail: false },
    { chave: "tatiana", nome: "Tatiana Vieira", n: 407, comEmail: true, tags: ["aluno"] },
    { chave: "rodrigo", nome: "Rodrigo Almeida", n: 408, comEmail: true, tags: ["aluno"] },
    { chave: "fernanda", nome: "Fernanda Castro", n: 409, comEmail: true },
    { chave: "nelson", nome: "Nelson Batista", n: 410, comEmail: false },
    { chave: "carla", nome: "Carla Mendes", n: 411, comEmail: true, tags: ["aluno"] },
    { chave: "alexandre", nome: "Alexandre Brito", n: 412, comEmail: true, tags: ["aluno"] },
    { chave: "patricia", nome: "Patrícia Gomes", n: 413, comEmail: true, tags: ["aluno"] },
    { chave: "fabio", nome: "Fábio Nogueira", n: 414, comEmail: false, tags: ["aluno"] },
    { chave: "simone", nome: "Simone Araújo", n: 415, comEmail: true },
    { chave: "renata-prisma", nome: "Renata Coelho", n: 416, comEmail: true, empresa: "prisma", cargo: "Coordenadora de RH", setor: "Recursos humanos", decisor: true },
    { chave: "gustavo-prisma", nome: "Gustavo Pimenta", n: 417, comEmail: true, empresa: "prisma", cargo: "Analista contábil", setor: "Contabilidade", tags: ["aluno"] },
    { chave: "ana-clara", nome: "Ana Clara Duarte", n: 418, comEmail: true, tags: ["aluno"] },
    { chave: "wilson", nome: "Wilson Teixeira", n: 419, comEmail: false, tags: ["aluno"] },
  ],
  funis: [
    {
      chave: "matriculas",
      nome: "Matrículas · Novos alunos",
      descricao: "Do primeiro contato à matrícula, passando pela aula experimental e pela escolha do plano.",
      etapas: [
        { chave: "novo", nome: "Novo contato", passo: "new", probabilidade: 10, prazoHoras: 24 },
        { chave: "respondi", nome: "Já respondi", passo: "contacted", probabilidade: 20, prazoHoras: 24 },
        { chave: "objetivo", nome: "Entendendo o objetivo", passo: "qualifying", probabilidade: 30, prazoHoras: 48 },
        { chave: "experimental", nome: "Aula experimental marcada", passo: "qualified", probabilidade: 50, prazoHoras: 72 },
        { chave: "plano", nome: "Escolhendo o plano", passo: "negotiating", probabilidade: 70, prazoHoras: 72 },
        { chave: "matriculado", nome: "Matriculado", passo: "won", fim: "won" },
        { chave: "nao", nome: "Não se matriculou", passo: "lost", fim: "lost" },
      ],
      nichoDeFollowup: "academia",
      vocabulario: { lead: "Aluno", lead_plural: "Alunos", deal: "Matrícula", deal_plural: "Matrículas", won: "Matriculado", lost: "Não se matriculou" },
      campos: [
        escolha("objetivo", "Objetivo", ["Emagrecer", "Ganhar massa", "Condicionamento", "Qualidade de vida", "Voltar a treinar"]),
        escolha("modalidade", "Modalidade", ["Musculação", "Funcional", "Pilates", "Spinning", "Lutas"]),
        escolha("plano", "Plano de interesse", [...PLANOS, "Plano empresa"]),
        escolha("horario", "Horário preferido", ["Manhã cedo", "Almoço", "Tarde", "Noite"]),
        { key: "fez_experimental", label: "Fez a aula experimental", type: "boolean" },
        { key: "indicado_por", label: "Indicado por", type: "text" },
      ],
      motivosDePerda: [
        { label: "Achou caro", categoria: "Nós" },
        { label: "Matriculou em outra academia", categoria: "Concorrência" },
        { label: "Horário não encaixou", categoria: "Cliente" },
        { label: "Mudou de bairro", categoria: "Cliente" },
        { label: "Parou de responder", categoria: "Ausência" },
      ],
      motivosDeGanho: ["Aula experimental", "Plano anual com desconto", "Horário", "Indicação de aluno", "Plano empresa"],
      vitoriaEReceita: true,
      negocios: [
        { titulo: "Letícia Moraes · plano anual", passo: "novo", contato: "leticia", valorReais: 1188, dono: "ia", origem: "meta_formulario", criadoHaDias: 0, naEtapaHaDias: 0, campos: { objetivo: "Condicionamento", plano: "Anual" } },
        { titulo: "Pedro Lucas Alves · musculação à noite", passo: "respondi", contato: "pedro", valorReais: 129.9, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 4, naEtapaHaDias: 3, campos: { modalidade: "Musculação", horario: "Noite" } },
        { titulo: "Sandra Melo · pilates", passo: "objetivo", contato: "sandra", valorReais: 280, dono: "ia", origem: "google", criadoHaDias: 4, naEtapaHaDias: 3, campos: { modalidade: "Pilates", objetivo: "Qualidade de vida", horario: "Manhã cedo" }, proximaAcao: { titulo: "Oferecer à Sandra a aula experimental de pilates", emDias: 1 } },
        { titulo: "Lucas Ferraz · aula experimental", passo: "experimental", contato: "lucas", valorReais: 129.9, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 1, naEtapaHaDias: 1, campos: { modalidade: "Musculação", objetivo: "Ganhar massa", horario: "Noite" }, proximaAcao: { titulo: "Confirmar a aula experimental de amanhã", emDias: 0 } },
        { titulo: "Nelson Batista · aula experimental", passo: "experimental", contato: "nelson", valorReais: 129.9, dono: "bianca", origem: "google", criadoHaDias: 7, naEtapaHaDias: 5, campos: { modalidade: "Funcional", horario: "Manhã cedo" }, nota: "Faltou na aula experimental de terça." },
        { titulo: "Gisele Rocha · escolhendo o plano", passo: "plano", contato: "gisele", valorReais: 659.4, dono: "bianca", origem: "site", criadoHaDias: 5, naEtapaHaDias: 2, campos: { objetivo: "Emagrecer", modalidade: "Funcional", plano: "Semestral", fez_experimental: true }, proximaAcao: { titulo: "Mandar a comparação entre o semestral, o anual e o plano família", emDias: 0, prioridade: "high" } },
        { titulo: "Matheus Correia · plano trimestral", passo: "plano", contato: "matheus", valorReais: 359.7, dono: "bianca", origem: "meta_formulario", criadoHaDias: 7, naEtapaHaDias: 3, campos: { plano: "Trimestral", fez_experimental: true }, proximaAcao: { titulo: "Perguntar ao Matheus se ficou dúvida sobre o trimestral", emDias: 1 } },
        { titulo: "Tatiana Vieira · plano anual", passo: "matriculado", contato: "tatiana", valorReais: 1188, dono: "bianca", origem: "indicacao", criadoHaDias: 15, naEtapaHaDias: 5, campos: { plano: "Anual", modalidade: "Musculação", fez_experimental: true, indicado_por: "Rodrigo Almeida" }, motivoDoGanho: "Indicação de aluno" },
        { titulo: "Gustavo Pimenta · plano empresa", passo: "matriculado", contato: "gustavo-prisma", valorReais: 1069.2, dono: "bianca", origem: "indicacao", criadoHaDias: 10, naEtapaHaDias: 3, campos: { plano: "Plano empresa", modalidade: "Musculação" }, motivoDoGanho: "Plano empresa" },
        { titulo: "Fernanda Castro · não se matriculou", passo: "nao", contato: "fernanda", valorReais: 129.9, dono: "ia", origem: "google", criadoHaDias: 20, naEtapaHaDias: 12, campos: { modalidade: "Spinning" }, motivoDaPerda: "Achou caro" },
      ],
    },
    {
      chave: "renovacoes",
      nome: "Renovações e retenção",
      descricao: "Os alunos com plano vencendo e os que pararam de vir: o contato de renovação, a reavaliação e quem cancelou.",
      etapas: [
        { chave: "vencendo", nome: "Plano vencendo", passo: null, probabilidade: 60, prazoHoras: 240 },
        { chave: "contato", nome: "Contato de renovação", passo: null, probabilidade: 70, prazoHoras: 120 },
        { chave: "reavaliacao", nome: "Reavaliação marcada", passo: null, probabilidade: 80, prazoHoras: 120 },
        { chave: "renovou", nome: "Renovou", passo: null, fim: "won" },
        { chave: "cancelou", nome: "Cancelou", passo: null, fim: "lost" },
      ],
      nichoDeFollowup: "academia",
      vocabulario: { lead: "Aluno", lead_plural: "Alunos", deal: "Renovação", deal_plural: "Renovações", won: "Renovou", lost: "Cancelou" },
      campos: [
        escolha("plano_atual", "Plano atual", PLANOS),
        { key: "treinos_no_mes", label: "Treinos no último mês", type: "number" },
        escolha("risco", "Risco de cancelar", ["Baixo", "Médio", "Alto"]),
        { key: "motivo_do_risco", label: "O que pode fazer cancelar", type: "text" },
      ],
      motivosDePerda: [
        { label: "Mudou de bairro", categoria: "Cliente" },
        { label: "Parou de treinar", categoria: "Cliente" },
        { label: "Foi para outra academia", categoria: "Concorrência" },
        { label: "Achou caro renovar", categoria: "Nós" },
        { label: "Parou de responder", categoria: "Ausência" },
      ],
      motivosDeGanho: ["Reavaliação mostrou evolução", "Desconto de renovação", "Turma de que gosta"],
      vitoriaEReceita: true,
      negocios: [
        { titulo: "Carla Mendes · renovação do anual", passo: "vencendo", contato: "carla", valorReais: 1188, dono: "bianca", origem: "indicacao", criadoHaDias: 3, naEtapaHaDias: 3, campos: { plano_atual: "Anual", treinos_no_mes: 14, risco: "Baixo" }, proximaAcao: { titulo: "Oferecer à Carla o desconto de renovação antecipada", emDias: 2 } },
        { titulo: "Alexandre Brito · renovação do semestral", passo: "contato", contato: "alexandre", valorReais: 659.4, dono: "bianca", origem: "site", criadoHaDias: 8, naEtapaHaDias: 2, campos: { plano_atual: "Semestral", treinos_no_mes: 4, risco: "Alto", motivo_do_risco: "Treinou só quatro vezes no último mês: mudou de turno no trabalho." }, proximaAcao: { titulo: "Mostrar ao Alexandre os horários depois das 21h", emDias: 0, prioridade: "high" } },
        { titulo: "Ana Clara Duarte · parou de vir", passo: "contato", contato: "ana-clara", valorReais: 129.9, dono: "ia", origem: "site", criadoHaDias: 20, naEtapaHaDias: 1, campos: { plano_atual: "Mensal", treinos_no_mes: 0, risco: "Alto", motivo_do_risco: "Não aparece há três semanas." } },
        { titulo: "Patrícia Gomes · reavaliação antes de renovar", passo: "reavaliacao", contato: "patricia", valorReais: 1188, dono: "eder", origem: "indicacao", criadoHaDias: 12, naEtapaHaDias: 3, campos: { plano_atual: "Anual", treinos_no_mes: 11, risco: "Médio" }, proximaAcao: { titulo: "Mostrar a evolução na reavaliação e propor a renovação", emDias: 2, prioridade: "high" } },
        { titulo: "Fábio Nogueira · renovou o anual", passo: "renovou", contato: "fabio", valorReais: 1188, dono: "bianca", origem: "indicacao", criadoHaDias: 30, naEtapaHaDias: 6, campos: { plano_atual: "Anual", treinos_no_mes: 16, risco: "Baixo" }, motivoDoGanho: "Reavaliação mostrou evolução" },
        { titulo: "Simone Araújo · cancelou", passo: "cancelou", contato: "simone", valorReais: 359.7, dono: "bianca", origem: "google", criadoHaDias: 25, naEtapaHaDias: 10, campos: { plano_atual: "Trimestral", treinos_no_mes: 2, risco: "Alto" }, motivoDaPerda: "Mudou de bairro" },
      ],
    },
  ],
  funilPadrao: "matriculas",
  conversas: [
    {
      chave: "lucas",
      contato: "lucas",
      comecouHaDias: 1,
      passo: "qualified",
      qualificacao: { need: "Musculação à noite para ganhar massa", timeline: "Quer começar esta semana" },
      proximaAcao: "Receber o Lucas na aula experimental de amanhã às 19h",
      ficha: {
        headline: "Musculação · treina à noite · aula experimental amanhã",
        body: "Lucas quer ganhar massa e só consegue treinar depois das 18h. A IA marcou a aula experimental para amanhã às 19h com o Éder.",
      },
      com: "ia",
      status: CONVERSA_COM_A_IA,
      etiquetas: ["Meta_ads"],
      mensagens: [
        { de: "cliente", texto: "Oi, quanto está a mensalidade? Quero treinar à noite.", min: 0 },
        { de: "ia", texto: "Oi, Lucas! Aqui é a Duda, da Academia Modelo. O plano mensal sai R$ 129,90 e o anual fica R$ 99 por mês. Antes de te indicar o melhor: qual é o seu objetivo?", min: 1 },
        { de: "cliente", texto: "Ganhar massa. Saio do trabalho às 18h.", min: 6 },
        { de: "ia", texto: "Boa! À noite temos professor na musculação até as 22h30. Que tal uma aula experimental gratuita para conhecer? Amanhã às 19h tem vaga.", min: 7 },
        { de: "cliente", texto: "Fechado, amanhã às 19h.", min: 11 },
        { de: "ia", texto: "Marcado! Leve roupa confortável e uma garrafinha de água. O Éder vai te receber.", min: 12 },
      ],
    },
    {
      chave: "gisele",
      contato: "gisele",
      comecouHaDias: 2,
      passo: "negotiating",
      qualificacao: {
        budget: "Entre o semestral e o anual",
        authority: "Decide com o marido",
        need: "Funcional de manhã",
        timeline: "Quer começar na semana que vem",
      },
      proximaAcao: "Mandar a comparação dos planos com o plano família",
      ficha: {
        headline: "Funcional · semestral ou anual · talvez com o marido",
        body: "Gisele fez a aula experimental de funcional e gostou. Está entre o semestral e o anual e quer ver o desconto do plano família para fazer com o marido.",
      },
      passagem: {
        titulo: "Gisele quer fechar o plano com o marido",
        resumo:
          "Fez a aula experimental de funcional e gostou. Está entre o semestral e o anual e quer o desconto do plano família para treinar com o marido.",
        ultimaFala: "Quero. E tem desconto para casal? Meu marido quer fazer junto.",
        reconhecidaPor: "bianca",
      },
      com: "bianca",
      status: "claimed",
      mensagens: [
        { de: "cliente", texto: "Oi! Fiz a aula de funcional ontem e gostei muito. Qual a diferença do semestral para o anual?", min: 0 },
        { de: "ia", texto: "Que bom que gostou, Gisele! O semestral sai R$ 659,40 em até 6x e o anual sai R$ 1.188 em até 12x, que dá R$ 99 por mês. No anual, a reavaliação física a cada três meses já vem inclusa. Quer que a Bianca, nossa consultora, monte a melhor opção para você?", min: 1 },
        { de: "cliente", texto: "Quero. E tem desconto para casal? Meu marido quer fazer junto.", min: 8 },
        { de: "ia", texto: "Tem sim, no plano família. Vou passar para a Bianca te explicar e fechar com vocês.", min: 9 },
        { de: "equipe", texto: "Oi, Gisele! Aqui é a Bianca. No plano família a segunda pessoa sai com 20% de desconto. Te mando a comparação certinha ainda hoje.", min: 60 },
      ],
    },
    {
      chave: "gustavo",
      contato: "gustavo-prisma",
      comecouHaDias: 0,
      passo: "won",
      qualificacao: { authority: "Decide sozinho", need: "Plano empresa da Contabilidade Prisma" },
      proximaAcao: "Conferir o contrato assinado e liberar o acesso",
      ficha: {
        headline: "Plano empresa · contrato assinado enviado",
        body: "Gustavo se matriculou pelo plano empresa da Contabilidade Prisma e mandou o contrato assinado pelo WhatsApp. Falta a recepção conferir e liberar o acesso.",
      },
      com: "nayara",
      status: "open",
      etiquetas: ["plano-empresa"],
      mensagens: [
        { de: "ia", texto: "Oi, Gustavo! Aqui é a Duda. Para concluir sua matrícula pelo plano empresa, falta o contrato assinado. Pode mandar por aqui mesmo.", min: 0 },
        { de: "cliente", texto: "Assinei, segue o PDF.", min: 40 },
        { de: "ia", texto: "Recebido, obrigada! A Nayara confere e libera o seu acesso ainda hoje.", min: 41 },
      ],
    },
    {
      chave: "nelson",
      contato: "nelson",
      comecouHaDias: 6,
      passo: "qualified",
      qualificacao: { need: "Funcional de manhã cedo" },
      proximaAcao: "Remarcar a aula experimental",
      ficha: {
        headline: "Funcional · faltou na aula experimental",
        body: "Nelson marcou a aula experimental de funcional para terça às 7h e não apareceu. O follow-up de falta está oferecendo outro horário.",
      },
      com: "bianca",
      status: "open",
      mensagens: [
        { de: "ia", texto: "Oi, Nelson! Aqui é a Duda. Sua aula experimental de funcional está confirmada para terça às 7h. Te esperamos!", min: 0 },
        { de: "cliente", texto: "Combinado!", min: 30 },
      ],
    },
    {
      chave: "ana-clara",
      contato: "ana-clara",
      comecouHaDias: 1,
      passo: "contacted",
      qualificacao: { need: "Voltar a treinar num horário que encaixe" },
      proximaAcao: "Oferecer um horário novo",
      ficha: null,
      com: "ia",
      status: CONVERSA_COM_A_IA,
      etiquetas: ["retencao"],
      mensagens: [
        { de: "ia", texto: "Oi, Ana Clara! Aqui é a Duda, da Academia Modelo. Sentimos sua falta nas aulas. Quer que eu veja um horário novo que encaixe melhor na sua rotina?", min: 0 },
      ],
    },
    {
      chave: "alexandre",
      contato: "alexandre",
      comecouHaDias: 2,
      passo: "negotiating",
      qualificacao: {
        authority: "Decide sozinho",
        need: "Treinar depois das 21h",
        timeline: "O plano vence na semana que vem",
      },
      proximaAcao: "Fazer a reavaliação na quinta e propor a renovação",
      ficha: {
        headline: "Renovação em risco · mudou de turno · reavaliação quinta",
        body: "Alexandre treinou só quatro vezes no último mês porque mudou de turno no trabalho. Agora só consegue depois das 21h. Reavaliação marcada com o Éder para quinta às 21h.",
      },
      com: "bianca",
      status: "claimed",
      etiquetas: ["renovacao"],
      mensagens: [
        { de: "equipe", texto: "Oi, Alexandre! Aqui é a Bianca. Seu plano semestral vence na semana que vem. Vi que a rotina apertou este mês: quer marcar uma reavaliação com o Éder e ver um horário que encaixe melhor?", min: 0 },
        { de: "cliente", texto: "Oi, Bianca. Mudei de turno no trabalho, só consigo depois das 21h agora.", min: 95 },
        { de: "equipe", texto: "Temos musculação até as 22h30. Posso marcar a reavaliação na quinta às 21h?", min: 110 },
        { de: "cliente", texto: "Pode marcar.", min: 130 },
      ],
    },
    {
      chave: "fernanda",
      contato: "fernanda",
      comecouHaDias: 12,
      passo: "lost",
      qualificacao: { budget: "Achou o valor alto para agora" },
      proximaAcao: null,
      ficha: {
        headline: "Achou caro · quer saber da próxima campanha",
        body: "Fernanda achou o valor alto para agora e pediu para ser avisada na próxima campanha de matrícula.",
      },
      com: "ia",
      status: "resolved",
      mensagens: [
        { de: "cliente", texto: "Achei o valor um pouco alto para mim agora.", min: 0 },
        { de: "ia", texto: "Entendo, Fernanda. Obrigada por avisar. Se quiser, te aviso quando tiver campanha de matrícula com desconto.", min: 2 },
        { de: "cliente", texto: "Pode avisar sim.", min: 20 },
      ],
    },
  ],
  tiposDeAgenda: [
    { slug: "aula-experimental", nome: "Aula experimental", categoria: "outro", duracao: 60 },
    { slug: "avaliacao-fisica", nome: "Avaliação física", categoria: "consulta", duracao: 45 },
    { slug: "reavaliacao", nome: "Reavaliação física", categoria: "retorno", duracao: 45 },
  ],
  compromissos: [
    { chave: "lucas-experimental", tipo: "aula-experimental", titulo: "Aula experimental · Lucas", contato: "lucas", dono: "eder", emDias: 1, hora: "19:00", duracaoMin: 60, status: "confirmed", local: "in_person", criadoPor: "ai" },
    { chave: "patricia-reavaliacao", tipo: "reavaliacao", titulo: "Reavaliação · Patrícia", contato: "patricia", dono: "eder", emDias: 2, hora: "08:00", duracaoMin: 45, status: "confirmed", local: "in_person", criadoPor: "user" },
    { chave: "alexandre-reavaliacao", tipo: "reavaliacao", titulo: "Reavaliação · Alexandre", contato: "alexandre", dono: "eder", emDias: 3, hora: "21:00", duracaoMin: 45, status: "confirmed", local: "in_person", criadoPor: "user" },
    { chave: "carla-reavaliacao", tipo: "reavaliacao", titulo: "Reavaliação · Carla", contato: "carla", dono: "eder", emDias: 6, hora: "07:00", duracaoMin: 45, status: "pending", local: "in_person", criadoPor: "ai" },
    { chave: "prisma-reuniao", tipo: "reuniao", titulo: "Plano empresa · Contabilidade Prisma", contato: "renata-prisma", dono: "juliano", emDias: 5, hora: "12:30", duracaoMin: 30, status: "pending", local: "phone", criadoPor: "user" },
    { chave: "nelson-experimental", tipo: "aula-experimental", titulo: "Aula experimental de funcional · Nelson", contato: "nelson", dono: "eder", emDias: -4, hora: "07:00", duracaoMin: 60, status: "no_show", local: "in_person", criadoPor: "ai" },
    { chave: "gisele-experimental", tipo: "aula-experimental", titulo: "Aula experimental de funcional · Gisele", contato: "gisele", dono: "eder", emDias: -3, hora: "18:00", duracaoMin: 60, status: "completed", local: "in_person", criadoPor: "ai" },
    { chave: "tatiana-avaliacao", tipo: "avaliacao-fisica", titulo: "Avaliação física de entrada · Tatiana", contato: "tatiana", dono: "eder", emDias: -4, hora: "19:00", duracaoMin: 45, status: "completed", local: "in_person", criadoPor: "user" },
    { chave: "tatiana-matricula", tipo: "atendimento", titulo: "Matrícula · Tatiana", contato: "tatiana", dono: "bianca", emDias: -5, hora: "19:30", duracaoMin: 30, status: "completed", local: "in_person", criadoPor: "user" },
    { chave: "fabio-reavaliacao", tipo: "reavaliacao", titulo: "Reavaliação · Fábio", contato: "fabio", dono: "eder", emDias: -8, hora: "07:30", duracaoMin: 45, status: "completed", local: "in_person", criadoPor: "user" },
    { chave: "simone-reavaliacao", tipo: "reavaliacao", titulo: "Reavaliação · Simone", contato: "simone", dono: "eder", emDias: -11, hora: "08:00", duracaoMin: 45, status: "cancelled", local: "in_person", criadoPor: "user", nota: "A aluna cancelou: mudou de bairro." },
  ],
  tarefas: [
    { chave: "campanha-novembro", titulo: "Lançar a campanha de matrícula de novembro", dono: "juliano", emDias: 4, prioridade: "medium", status: "pending" },
    { chave: "planos-vencendo", titulo: "Ligar para os alunos com plano vencendo esta semana", dono: "bianca", emDias: 0, prioridade: "high", status: "pending" },
    { chave: "relatorio-cancelamentos", titulo: "Fechar o relatório de cancelamentos do mês", dono: "juliano", emDias: -1, prioridade: "high", status: "pending", descricao: "Atrasada de propósito: a lista de atrasadas precisa de exemplo." },
    { chave: "grade-verao", titulo: "Montar a grade de horários do verão", dono: "eder", emDias: 10, prioridade: "low", status: "in_progress" },
    { chave: "conferir-tatiana", titulo: "Conferir a matrícula da Tatiana", dono: "nayara", emDias: -5, prioridade: "medium", status: "done", contato: "tatiana" },
    { chave: "painel-recepcao", titulo: "Trocar o painel de horários da recepção", dono: "juliano", emDias: -12, prioridade: "low", status: "cancelled" },
  ],
  followups: [
    { modelo: "academia-retomada", funil: "matriculas", etapa: "respondi" },
    { modelo: "academia-aula-experimental", funil: "matriculas", etapa: "objetivo" },
    { modelo: "academia-matricula", funil: "matriculas", etapa: "plano" },
    { modelo: "academia-falta", funil: "matriculas", etapa: "experimental" },
  ],
  inscricoes: [
    { chave: "ana-clara-retomada", modelo: "academia-retomada", contato: "ana-clara", status: "waiting_reply", no: "resposta-1", passos: 1, comecouHaDias: 0, proximaEmHoras: 26 },
    { chave: "pedro-retomada", modelo: "academia-retomada", contato: "pedro", status: "waiting_reply", no: "resposta-2", passos: 3, comecouHaDias: 3, proximaEmHoras: 20 },
    { chave: "sandra-experimental", modelo: "academia-aula-experimental", contato: "sandra", status: "active", no: "espera-2", passos: 2, comecouHaDias: 3, proximaEmHoras: 30 },
    { chave: "nelson-falta", modelo: "academia-falta", contato: "nelson", status: "waiting_reply", no: "resposta-2", passos: 4, comecouHaDias: 4, proximaEmHoras: 30 },
    { chave: "matheus-matricula", modelo: "academia-matricula", contato: "matheus", status: "waiting_reply", no: "resposta-1", passos: 2, comecouHaDias: 3, proximaEmHoras: 50 },
    { chave: "tatiana-matricula", modelo: "academia-matricula", contato: "tatiana", status: "completed", no: "fim-marcou", passos: 3, comecouHaDias: 10, desfecho: "converted" },
  ],
  obrigacoes: {
    funil: "matriculas",
    segmento: "academia",
    itens: [
      { chave: "contrato-tatiana", tipo: "Contrato do plano", negocio: "Tatiana Vieira · plano anual", responsavel: "nayara", recebidoEmDias: -5 },
      {
        chave: "contrato-gustavo",
        tipo: "Contrato do plano",
        negocio: "Gustavo Pimenta · plano empresa",
        responsavel: "nayara",
        pedidoEmDias: -3,
        prazoEmDias: 2,
        proposta: { conversa: "gustavo", arquivo: "contrato-do-plano-assinado.pdf" },
      },
      { chave: "contrato-gisele", tipo: "Contrato do plano", negocio: "Gisele Rocha · escolhendo o plano", responsavel: "bianca", observacao: "Mandar junto com o link de pagamento." },
      {
        chave: "renovacao-carla",
        tipo: "Renovação do plano",
        contato: "carla",
        responsavel: "bianca",
        proximaEmDias: 8,
        feitaEmDias: -357,
        ciclos: [{ proximaEmDias: -357, feitaEmDias: -357 }],
      },
      {
        chave: "renovacao-alexandre",
        tipo: "Renovação do plano",
        contato: "alexandre",
        responsavel: "bianca",
        proximaEmDias: 5,
        feitaEmDias: -360,
        observacao: "Risco alto: mudou de turno no trabalho.",
        ciclos: [{ proximaEmDias: -360, feitaEmDias: -360 }],
      },
      { chave: "renovacao-fabio", tipo: "Renovação do plano", contato: "fabio", responsavel: "bianca", proximaEmDias: 335, feitaEmDias: -30, ciclos: [{ proximaEmDias: -30, feitaEmDias: -30 }] },
      {
        chave: "reavaliacao-patricia",
        tipo: "Reavaliação física",
        contato: "patricia",
        responsavel: "eder",
        proximaEmDias: 2,
        feitaEmDias: -88,
        ciclos: [
          { proximaEmDias: -180, feitaEmDias: -179 },
          { proximaEmDias: -89, feitaEmDias: -88 },
        ],
      },
      {
        chave: "reavaliacao-wilson",
        tipo: "Reavaliação física",
        contato: "wilson",
        responsavel: "eder",
        proximaEmDias: -9,
        feitaEmDias: -100,
        observacao: "Não marcou a reavaliação e não aparece há duas semanas.",
        ciclos: [{ proximaEmDias: -100, feitaEmDias: -100 }],
      },
      { chave: "reavaliacao-carla", tipo: "Reavaliação física", contato: "carla", responsavel: "eder", proximaEmDias: 6, feitaEmDias: -84, ciclos: [{ proximaEmDias: -85, feitaEmDias: -84 }] },
      { chave: "reavaliacao-tatiana", tipo: "Reavaliação física", contato: "tatiana", responsavel: "eder", proximaEmDias: 86, feitaEmDias: -4 },
    ],
  },
  produtos: [
    { codigo: "PLANO-MENSAL", nome: "Plano mensal", descricao: "Musculação e aulas coletivas todos os dias. Sem fidelidade.", categoria: "Planos", precoReais: 129.9, controlaEstoque: false },
    { codigo: "PLANO-TRIMESTRAL", nome: "Plano trimestral", descricao: "R$ 119,90 por mês, em até 3x.", categoria: "Planos", precoReais: 359.7, controlaEstoque: false },
    { codigo: "PLANO-SEMESTRAL", nome: "Plano semestral", descricao: "R$ 109,90 por mês, em até 6x.", categoria: "Planos", precoReais: 659.4, controlaEstoque: false },
    { codigo: "PLANO-ANUAL", nome: "Plano anual", descricao: "R$ 99 por mês, em até 12x. A reavaliação física a cada três meses já vem inclusa.", categoria: "Planos", precoReais: 1188, controlaEstoque: false },
    { codigo: "PLANO-FAMILIA", nome: "Plano família (segunda pessoa)", descricao: "A segunda pessoa da mesma família sai com 20% de desconto em qualquer plano. Valor do mensal.", categoria: "Planos", precoReais: 103.9, controlaEstoque: false },
    { codigo: "PLANO-EMPRESA", nome: "Plano empresa (anual, por funcionário)", descricao: "10% de desconto no plano anual para funcionários de empresa conveniada.", categoria: "Planos", precoReais: 1069.2, controlaEstoque: false },
    { codigo: "PILATES-2X", nome: "Pilates duas vezes por semana", descricao: "Turmas de até 4 alunos. Valor mensal.", categoria: "Modalidades", precoReais: 280, controlaEstoque: false },
    { codigo: "AVALIACAO-FISICA", nome: "Avaliação física avulsa", descricao: "Para quem não tem o plano anual.", categoria: "Serviços", precoReais: 80, controlaEstoque: false },
    { codigo: "PERSONAL-8", nome: "Personal trainer · pacote com 8 aulas", descricao: "Aulas individuais de uma hora, para usar em até 45 dias.", categoria: "Serviços", precoReais: 640, controlaEstoque: false },
    { codigo: "DIARIA", nome: "Diária avulsa", descricao: "Um dia de academia, para visitante.", categoria: "Serviços", precoReais: 35, controlaEstoque: false },
  ],
};
