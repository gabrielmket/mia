/**
 * FORK MIA · DEMONSTRAÇÃO · CONSTRUTORA E IMOBILIÁRIA.
 *
 * A "Construtora Modelo" (fictícia) vende o lançamento Vista Parque, na planta,
 * e as últimas unidades prontas do Bosque das Palmeiras. O que a demonstração
 * mostra a quem vende imóvel:
 *
 *  - o funil do lançamento, do interessado ao contrato assinado, passando pela
 *    visita ao decorado, pela simulação de financiamento e pela documentação;
 *  - o funil das unidades prontas (o quadro pronto de imobiliária do onboarding);
 *  - a agenda de visitas ao decorado, marcadas pela IA e pelos corretores;
 *  - a documentação do comprador como obrigações com vencimento: RG e CPF,
 *    comprovante de renda, extrato do FGTS, certidões, aprovação de crédito e,
 *    depois da assinatura, a parcela anual e o reajuste do contrato;
 *  - o catálogo das unidades por tipologia, com o estoque de cada uma;
 *  - os quatro follow-ups imobiliários publicados, com inscrições andando.
 *
 * Dados fictícios: telefone do DDD 00, e-mail `.invalid`, CNPJ que não existe.
 */
import { MODULO_DOS_LEADS_DA_META } from "@/lib/leads-da-meta/modulo";

import type { MotivoDePerdaDaSemente, SementeDeDemonstracao } from "../tipos";
import { cnpjFalso, escolha } from "./comum";

/** Status de ciclo de vida gravado (ver `ConversaDaSemente.status`): a conversa está com a IA. */
const CONVERSA_COM_A_IA = "ai_handling" as const;

const PERDAS_DO_LANCAMENTO: MotivoDePerdaDaSemente[] = [
  { label: "Crédito não aprovado", categoria: "Cliente" },
  { label: "Renda não comporta a parcela", categoria: "Cliente" },
  { label: "Comprou de outra construtora", categoria: "Concorrência" },
  { label: "Localização não atende", categoria: "Mérito" },
  { label: "Valor da entrada", categoria: "Nós" },
  { label: "Parou de responder", categoria: "Ausência" },
];

const VISTA_PARQUE = "Vista Parque · lançamento";
const BOSQUE = "Bosque das Palmeiras · pronto para morar";

export const CONSTRUTORA: SementeDeDemonstracao = {
  segmento: "construtora",
  rotulo: "Construtora e imobiliária",
  oQueMostra:
    "Uma construtora com um lançamento na planta e unidades prontas: visita ao decorado na agenda, simulação de financiamento, documentação do comprador com vencimento e o funil até o contrato assinado.",
  nome: "Demonstração · Construtora",
  razaoSocial: "Construtora Modelo Demonstração (fictícia)",
  slug: "demonstracao-construtora",
  prefixoDosIds: "demo:construtora",
  sessaoDoCanal: "demonstracao-construtora",
  telefoneDoCanal: "+5500900010000",
  modoDeVenda: "b2c",
  formularioDaMeta: "Formulário · Lançamento Vista Parque (demonstração)",
  enderecoFicticio: "Estande de vendas do Vista Parque (endereço fictício)",
  equipe: [
    { chave: "silvia", nome: "Sílvia Marques", papel: "manager", trilha: 1 },
    { chave: "diogo", nome: "Diogo Prates", papel: "agent", trilha: 2 },
    { chave: "luciana", nome: "Luciana Brito", papel: "agent", trilha: 3 },
    { chave: "helio", nome: "Hélio Duarte", papel: "agent", trilha: 4 },
  ],
  gestor: "silvia",
  agente: {
    chave: "livia",
    nome: "Lívia · Atendimento Vista Parque (demonstração)",
    descricao:
      "Agente de exemplo da construtora de demonstração. Não tem versão publicada e o canal está arquivado: não atende ninguém de verdade.",
    prompt:
      "Você é a Lívia, do atendimento da Construtora Modelo. Atende pelo WhatsApp quem se interessa pelo lançamento Vista Parque, na planta, e pelas unidades prontas do Bosque das Palmeiras. Entende a tipologia que a pessoa procura, a renda familiar, se vai usar FGTS e financiamento e o prazo para mudar. Marca a visita ao decorado na agenda e passa para o corretor quem já tem perfil. Fala o preço de tabela das unidades do catálogo, mas nunca promete aprovação de crédito nem valor de parcela: a simulação é feita pelo analista de crédito. Fala de forma simples e cordial.",
  },
  modulos: ["disparador", MODULO_DOS_LEADS_DA_META],
  empresas: [
    {
      chave: "alameda",
      nome: "Alameda Imóveis",
      site: null,
      cidade: "Campinas",
      uf: "SP",
      setor: "Imobiliária parceira",
      observacoes: "Vende as unidades do Vista Parque com a tabela de comissão de parceiro.",
      tags: ["parceira", "imobiliaria"],
      cnpj: cnpjFalso(101),
      campos: { comissao: "4% sobre o valor da unidade" },
    },
    {
      chave: "credito-certo",
      nome: "Crédito Certo Correspondente",
      site: "https://creditocerto.exemplo.invalid",
      cidade: "Campinas",
      uf: "SP",
      setor: "Correspondente bancário",
      observacoes: "Faz a análise de crédito e a simulação com o banco para os compradores.",
      tags: ["parceira", "credito"],
      cnpj: cnpjFalso(102),
    },
  ],
  contatos: [
    // Parceiros: imobiliária e correspondente bancário, com mais de uma pessoa.
    { chave: "rodrigo-alameda", nome: "Rodrigo Valença", n: 101, comEmail: true, empresa: "alameda", cargo: "Gerente da imobiliária", setor: "Diretoria", decisor: true },
    { chave: "talita-alameda", nome: "Talita Nunes", n: 102, comEmail: true, empresa: "alameda", cargo: "Corretora parceira", setor: "Vendas" },
    { chave: "everton-alameda", nome: "Everton Lacerda", n: 103, comEmail: false, empresa: "alameda", cargo: "Corretor parceiro", setor: "Vendas" },
    { chave: "monica-credito", nome: "Mônica Freire", n: 104, comEmail: true, empresa: "credito-certo", cargo: "Analista de crédito", setor: "Crédito", decisor: true },
    { chave: "saulo-credito", nome: "Saulo Teixeira", n: 105, comEmail: false, empresa: "credito-certo", cargo: "Atendimento", setor: "Crédito" },
    // Compradores.
    { chave: "camila", nome: "Camila Rezende", n: 111, comEmail: true },
    { chave: "andre", nome: "André Luiz Fonseca", n: 112, comEmail: true },
    { chave: "juliana", nome: "Juliana Peixoto", n: 113, comEmail: true },
    { chave: "marcos", nome: "Marcos Aurélio Dantas", n: 114, comEmail: false },
    { chave: "bianca", nome: "Bianca Salgado", n: 115, comEmail: true },
    { chave: "felipe", nome: "Felipe Arruda", n: 116, comEmail: true },
    { chave: "lorena", nome: "Lorena Campos", n: 117, comEmail: true },
    { chave: "gustavo", nome: "Gustavo Rangel", n: 118, comEmail: false },
    { chave: "patricia", nome: "Patrícia Damasceno", n: 119, comEmail: true },
    { chave: "wesley", nome: "Wesley Barbosa", n: 120, comEmail: false },
    { chave: "aline", nome: "Aline Cordeiro", n: 121, comEmail: true },
    { chave: "roberto", nome: "Roberto Siqueira", n: 122, comEmail: true },
    { chave: "fernanda", nome: "Fernanda Quaresma", n: 123, comEmail: false },
    { chave: "claudio", nome: "Cláudio Menezes", n: 124, comEmail: true },
    { chave: "sabrina", nome: "Sabrina Toledo", n: 125, comEmail: true },
    { chave: "hugo", nome: "Hugo Matias", n: 126, comEmail: true },
    { chave: "daniela", nome: "Daniela Fontes", n: 127, comEmail: false },
    { chave: "igor", nome: "Igor Batista", n: 128, comEmail: true },
    { chave: "viviane", nome: "Viviane Arantes", n: 129, comEmail: true },
  ],
  funis: [
    {
      chave: "lancamento",
      nome: "Lançamento · Vista Parque",
      descricao:
        "Lançamento na planta, duas torres, entrega prevista para 2028. Do interessado ao contrato assinado, com a visita ao decorado, a simulação e a documentação.",
      etapas: [
        { chave: "novo", nome: "Novo interessado", passo: "new", probabilidade: 5, prazoHoras: 24 },
        { chave: "contato", nome: "Primeiro contato", passo: "contacted", probabilidade: 10, prazoHoras: 48 },
        { chave: "perfil", nome: "Perfil e renda entendidos", passo: "qualifying", probabilidade: 20, prazoHoras: 72 },
        { chave: "visita", nome: "Visita ao decorado", passo: "qualified", probabilidade: 35, prazoHoras: 120 },
        { chave: "simulacao", nome: "Simulação de financiamento", passo: "negotiating", probabilidade: 55, prazoHoras: 120 },
        { chave: "documentacao", nome: "Documentação e crédito", passo: null, probabilidade: 75, prazoHoras: 240 },
        { chave: "assinado", nome: "Contrato assinado", passo: "won", fim: "won" },
        { chave: "desistiu", nome: "Desistiu", passo: "lost", fim: "lost" },
      ],
      nichoDeFollowup: "imobiliario",
      vocabulario: { lead: "Interessado", lead_plural: "Interessados", deal: "Negociação", deal_plural: "Negociações", won: "Contrato assinado", lost: "Desistiu" },
      campos: [
        escolha("empreendimento", "Empreendimento", [VISTA_PARQUE, BOSQUE]),
        escolha("tipologia", "Tipologia", ["Studio", "2 quartos", "2 quartos com suíte", "3 quartos", "Cobertura"]),
        escolha("faixa_de_renda", "Renda familiar", ["Até R$ 4.700", "R$ 4.700 a R$ 8.600", "R$ 8.600 a R$ 12.000", "Acima de R$ 12.000"]),
        escolha("pagamento", "Forma de pagamento", ["Financiamento bancário", "FGTS e financiamento", "Direto com a construtora", "À vista"]),
        { key: "usa_fgts", label: "Vai usar FGTS", type: "boolean" },
        { key: "unidade", label: "Unidade escolhida", type: "text" },
        { key: "entrada", label: "Entrada prevista (R$)", type: "number" },
      ],
      motivosDePerda: PERDAS_DO_LANCAMENTO,
      motivosDeGanho: ["Condição de entrada", "Visita ao decorado", "Subsídio e FGTS", "Localização"],
      vitoriaEReceita: true,
      negocios: [
        { titulo: "Bianca Salgado · 2 quartos", passo: "novo", contato: "bianca", valorReais: 389000, dono: "ia", origem: "meta_formulario", criadoHaDias: 0, naEtapaHaDias: 0, campos: { empreendimento: VISTA_PARQUE, tipologia: "2 quartos" } },
        { titulo: "Felipe Arruda · studio para investir", passo: "contato", contato: "felipe", valorReais: 265000, dono: "ia", origem: "google", criadoHaDias: 5, naEtapaHaDias: 4, campos: { empreendimento: VISTA_PARQUE, tipologia: "Studio", pagamento: "À vista" } },
        { titulo: "Marcos Aurélio Dantas · 3 quartos", passo: "perfil", contato: "marcos", valorReais: 569000, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 4, naEtapaHaDias: 2, campos: { empreendimento: VISTA_PARQUE, tipologia: "3 quartos", faixa_de_renda: "R$ 8.600 a R$ 12.000", usa_fgts: true } },
        { titulo: "Juliana Peixoto · 2 quartos com suíte", passo: "visita", contato: "juliana", valorReais: 452000, dono: "diogo", origem: "meta_formulario", criadoHaDias: 6, naEtapaHaDias: 2, campos: { empreendimento: VISTA_PARQUE, tipologia: "2 quartos com suíte", faixa_de_renda: "R$ 8.600 a R$ 12.000", pagamento: "FGTS e financiamento", usa_fgts: true }, proximaAcao: { titulo: "Confirmar a visita ao decorado de sábado", emDias: 1, prioridade: "high" } },
        { titulo: "Viviane Arantes · 2 quartos", passo: "visita", contato: "viviane", valorReais: 389000, dono: "luciana", origem: "indicacao", criadoHaDias: 7, naEtapaHaDias: 3, campos: { empreendimento: VISTA_PARQUE, tipologia: "2 quartos" }, proximaAcao: { titulo: "Mandar a planta do 2 quartos antes da visita remarcada", emDias: 0 }, nota: "Faltou na primeira visita; remarcou depois do lembrete." },
        { titulo: "André Luiz Fonseca · 2 quartos com suíte", passo: "simulacao", contato: "andre", valorReais: 452000, dono: "diogo", origem: "google", criadoHaDias: 10, naEtapaHaDias: 3, campos: { empreendimento: VISTA_PARQUE, tipologia: "2 quartos com suíte", faixa_de_renda: "R$ 4.700 a R$ 8.600", pagamento: "FGTS e financiamento", usa_fgts: true, entrada: 45000 }, proximaAcao: { titulo: "Levar a simulação com subsídio na reunião", emDias: 2, prioridade: "high" } },
        { titulo: "Wesley Barbosa · 3 quartos", passo: "simulacao", contato: "wesley", valorReais: 569000, dono: "luciana", origem: "meta_clique_whatsapp", criadoHaDias: 12, naEtapaHaDias: 6, campos: { empreendimento: VISTA_PARQUE, tipologia: "3 quartos", pagamento: "Financiamento bancário" }, proximaAcao: { titulo: "Pedir o extrato do FGTS para refazer a simulação", emDias: 1 } },
        { titulo: "Camila Rezende · 2 quartos, Torre B", passo: "documentacao", contato: "camila", valorReais: 389000, dono: "helio", origem: "meta_formulario", criadoHaDias: 18, naEtapaHaDias: 5, campos: { empreendimento: VISTA_PARQUE, unidade: "Torre B · apto 1204", tipologia: "2 quartos", pagamento: "FGTS e financiamento", usa_fgts: true, entrada: 38000 }, proximaAcao: { titulo: "Conferir as certidões que a Camila mandou", emDias: 0, prioridade: "urgent" } },
        { titulo: "Igor Batista · cobertura", passo: "documentacao", contato: "igor", valorReais: 890000, dono: "helio", origem: "indicacao", criadoHaDias: 25, naEtapaHaDias: 7, campos: { empreendimento: VISTA_PARQUE, unidade: "Torre A · cobertura 2", tipologia: "Cobertura", pagamento: "Financiamento bancário", entrada: 180000 }, proximaAcao: { titulo: "Pedir a aprovação de crédito ao banco", emDias: 2, prioridade: "high" } },
        { titulo: "Lorena Campos · 2 quartos, Torre A", passo: "assinado", contato: "lorena", valorReais: 389000, dono: "diogo", origem: "google", criadoHaDias: 40, naEtapaHaDias: 9, campos: { empreendimento: VISTA_PARQUE, unidade: "Torre A · apto 803", tipologia: "2 quartos", pagamento: "FGTS e financiamento", usa_fgts: true }, motivoDoGanho: "Subsídio e FGTS" },
        { titulo: "Patrícia Damasceno · 3 quartos, Torre B", passo: "assinado", contato: "patricia", valorReais: 569000, dono: "luciana", origem: "indicacao", criadoHaDias: 400, naEtapaHaDias: 353, campos: { empreendimento: VISTA_PARQUE, unidade: "Torre B · apto 1501", tipologia: "3 quartos", pagamento: "Direto com a construtora" }, motivoDoGanho: "Visita ao decorado", nota: "Comprou no pré-lançamento, com parcelas anuais direto com a construtora." },
        { titulo: "Gustavo Rangel · 2 quartos", passo: "desistiu", contato: "gustavo", valorReais: 389000, dono: "diogo", origem: "meta_formulario", criadoHaDias: 30, naEtapaHaDias: 12, campos: { empreendimento: VISTA_PARQUE, tipologia: "2 quartos" }, motivoDaPerda: "Crédito não aprovado" },
      ],
    },
    {
      chave: "prontos",
      nome: "Prontos para morar · Bosque das Palmeiras",
      descricao: "As últimas unidades prontas, para quem precisa mudar já. O quadro pronto de imobiliária do produto.",
      pacote: "imobiliaria",
      nichoDeFollowup: "imobiliario",
      vocabulario: { lead: "Interessado", lead_plural: "Interessados", deal: "Negociação", deal_plural: "Negociações", won: "Contrato assinado", lost: "Desistiu" },
      campos: [
        escolha("tipologia", "Tipologia", ["2 quartos", "2 quartos garden", "3 quartos"]),
        { key: "andar", label: "Andar ou posição", type: "text" },
        escolha("vagas", "Vagas de garagem", ["1 vaga", "2 vagas"]),
        escolha("pagamento", "Forma de pagamento", ["Financiamento bancário", "FGTS e financiamento", "À vista"]),
        { key: "mudanca_em", label: "Precisa mudar em", type: "text" },
      ],
      motivosDePerda: [
        { label: "Comprou de outra construtora", categoria: "Concorrência" },
        { label: "Crédito não aprovado", categoria: "Cliente" },
        { label: "Preferiu esperar o lançamento", categoria: "Cliente" },
        { label: "Valor da unidade", categoria: "Nós" },
        { label: "Parou de responder", categoria: "Ausência" },
      ],
      motivosDeGanho: ["Mudança imediata", "Condição de pagamento", "Visita à unidade"],
      vitoriaEReceita: true,
      negocios: [
        { titulo: "Aline Cordeiro · pronto para morar", passo: "new", contato: "aline", valorReais: 410000, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 1, naEtapaHaDias: 1, campos: { mudanca_em: "Até o fim do ano" } },
        { titulo: "Roberto Siqueira · 3 quartos", passo: "contacted", contato: "roberto", valorReais: 598000, dono: "ia", origem: "google", criadoHaDias: 1, naEtapaHaDias: 1, campos: { tipologia: "3 quartos" } },
        { titulo: "Fernanda Quaresma · 2 quartos garden", passo: "qualifying", contato: "fernanda", valorReais: 435000, dono: "ia", origem: "site", criadoHaDias: 3, naEtapaHaDias: 1, campos: { tipologia: "2 quartos garden", andar: "Térreo com quintal" } },
        { titulo: "Cláudio Menezes · 3 quartos andar alto", passo: "qualified", contato: "claudio", valorReais: 615000, dono: "luciana", origem: "indicacao", criadoHaDias: 6, naEtapaHaDias: 2, campos: { tipologia: "3 quartos", andar: "Acima do 10º", vagas: "2 vagas" }, proximaAcao: { titulo: "Separar as duas unidades de andar alto para a visita", emDias: 1 } },
        { titulo: "Sabrina Toledo · 2 quartos", passo: "negotiating", contato: "sabrina", valorReais: 405000, dono: "luciana", origem: "meta_formulario", criadoHaDias: 9, naEtapaHaDias: 3, campos: { tipologia: "2 quartos", pagamento: "À vista" }, proximaAcao: { titulo: "Responder a contraproposta da Sabrina", emDias: 0, prioridade: "urgent" }, nota: "Fez proposta de R$ 395 mil à vista, com FGTS." },
        { titulo: "Hugo Matias · 2 quartos", passo: "won", contato: "hugo", valorReais: 410000, dono: "diogo", origem: "google", criadoHaDias: 28, naEtapaHaDias: 8, campos: { tipologia: "2 quartos", pagamento: "Financiamento bancário" }, motivoDoGanho: "Mudança imediata" },
        { titulo: "Daniela Fontes · 3 quartos", passo: "lost", contato: "daniela", valorReais: 598000, dono: "diogo", origem: "meta_clique_whatsapp", criadoHaDias: 21, naEtapaHaDias: 10, campos: { tipologia: "3 quartos" }, motivoDaPerda: "Preferiu esperar o lançamento" },
      ],
    },
  ],
  funilPadrao: "lancamento",
  conversas: [
    {
      chave: "juliana",
      contato: "juliana",
      comecouHaDias: 3,
      passo: "qualified",
      qualificacao: {
        budget: "Renda familiar de R$ 9 mil, FGTS e financiamento",
        authority: "Decide com o marido",
        need: "2 quartos com suíte no Vista Parque",
        timeline: "Quer mudar quando o prédio ficar pronto",
      },
      proximaAcao: "Receber o casal no decorado no sábado às 10h",
      ficha: {
        headline: "2 quartos com suíte · renda R$ 9 mil · FGTS · visita sábado",
        body:
          "Juliana e o marido procuram 2 quartos com suíte no Vista Parque. Renda familiar de cerca de R$ 9 mil, vão usar FGTS e financiamento. Visita ao decorado marcada pela IA para sábado às 10h com o Diogo.",
      },
      passagem: {
        titulo: "Juliana marcou visita ao decorado",
        resumo:
          "Qualificada pela IA: 2 quartos com suíte, renda familiar de R$ 9 mil, FGTS e financiamento, decide com o marido. Visita marcada no sábado às 10h.",
        ultimaFala: "Sábado às 10h dá certo para nós dois.",
        reconhecidaPor: "diogo",
      },
      com: "diogo",
      status: "claimed",
      etiquetas: ["Meta_ads", "Formulario_Meta"],
      mensagens: [
        { de: "ia", texto: "Oi, Juliana! Aqui é a Lívia, da Construtora Modelo. Vi que você se cadastrou para saber do Vista Parque. Posso te fazer umas perguntas rápidas para te mostrar as opções certas?", min: 0 },
        { de: "cliente", texto: "Pode sim! Quero saber do apartamento de 2 quartos com suíte.", min: 12 },
        { de: "ia", texto: "Ótima escolha, é a planta mais procurada. Vocês pensam em usar FGTS e financiamento, ou outra forma de pagamento?", min: 13 },
        { de: "cliente", texto: "FGTS e financiamento. Eu e meu marido somamos uns 9 mil de renda.", min: 20 },
        { de: "ia", texto: "Com essa renda dá para montar uma boa simulação. O melhor jeito de conhecer é visitando o decorado, com a planta de 2 quartos com suíte montada. Sábado de manhã funciona para vocês?", min: 21 },
        { de: "cliente", texto: "Sábado às 10h dá certo para nós dois.", min: 30 },
        { de: "ia", texto: "Marcado! Sábado às 10h no decorado do Vista Parque. O Diogo, nosso corretor, vai receber vocês e já leva uma simulação inicial.", min: 31 },
        { de: "equipe", texto: "Oi, Juliana! Aqui é o Diogo. Já separei a planta e uma simulação com FGTS para sábado. Se puderem, tragam um holerite de cada um que eu adianto a análise.", min: 140 },
        { de: "cliente", texto: "Combinado, levamos sim!", min: 165 },
      ],
    },
    {
      chave: "andre",
      contato: "andre",
      comecouHaDias: 2,
      passo: "negotiating",
      qualificacao: {
        budget: "Entrada de R$ 45 mil parcelada, com FGTS",
        authority: "Decide sozinho",
        need: "2 quartos com suíte",
        timeline: "Quer assinar ainda este mês",
      },
      proximaAcao: "Levar duas opções de entrada na reunião de quinta",
      ficha: {
        headline: "2 quartos com suíte · entrada R$ 45 mil · quer parcelar mais",
        body:
          "André já visitou o decorado e recebeu a simulação com subsídio e FGTS. A entrada fica perto de R$ 45 mil até a entrega das chaves; ele pediu para parcelar em mais vezes. Reunião marcada para quinta.",
      },
      com: "diogo",
      status: "claimed",
      etiquetas: ["Google_ads"],
      mensagens: [
        { de: "cliente", texto: "Oi, Diogo, conseguiu ver a simulação com o subsídio?", min: 0 },
        { de: "equipe", texto: "Oi, André! Consegui sim. Com a renda de vocês e o FGTS, a entrada fica em torno de R$ 45 mil, parcelada até a entrega das chaves. A parcela do banco depende da aprovação, e o Hélio te explica no detalhe.", min: 25 },
        { de: "cliente", texto: "Dá para parcelar a entrada em mais vezes?", min: 40 },
        { de: "equipe", texto: "Dá para estudar. Vou levar duas opções na nossa reunião de quinta.", min: 52 },
      ],
    },
    {
      chave: "camila",
      contato: "camila",
      comecouHaDias: 0,
      passo: "negotiating",
      qualificacao: {
        budget: "Entrada de R$ 38 mil, FGTS e financiamento",
        authority: "Decide sozinha",
        need: "Torre B, apartamento 1204",
        timeline: "Assinar assim que o banco aprovar",
      },
      proximaAcao: "Conferir as certidões e anexar ao processo de crédito",
      ficha: {
        headline: "Torre B 1204 · documentação · certidões enviadas",
        body:
          "Camila está na fase de documentação da unidade 1204 da Torre B. Mandou as certidões atualizadas pelo WhatsApp hoje. Ainda falta o extrato do FGTS para fechar o pacote do banco.",
      },
      passagem: {
        titulo: "Camila mandou as certidões",
        resumo: "Arquivo recebido na conversa. Conferir e anexar ao processo de crédito; o extrato do FGTS segue pendente.",
        ultimaFala: "Segue o arquivo com as certidões.",
      },
      com: "helio",
      status: "open",
      etiquetas: ["documentacao"],
      mensagens: [
        { de: "ia", texto: "Oi, Camila! Aqui é a Lívia. O Hélio pediu para lembrar: faltam as certidões atualizadas para o banco seguir com a análise. Consegue mandar por aqui?", min: 0 },
        { de: "cliente", texto: "Oi! Tirei hoje de manhã, vou mandar o PDF.", min: 45 },
        { de: "cliente", texto: "Segue o arquivo com as certidões.", min: 47 },
        { de: "ia", texto: "Recebi, obrigada! Vou deixar com o Hélio para conferir e anexar ao seu processo.", min: 48 },
      ],
    },
    {
      chave: "aline",
      contato: "aline",
      comecouHaDias: 1,
      passo: "contacted",
      qualificacao: { need: "Apartamento pronto para mudar até o fim do ano" },
      proximaAcao: "Perguntar se vai financiar ou usar FGTS",
      ficha: null,
      com: "ia",
      status: CONVERSA_COM_A_IA,
      etiquetas: ["Meta_ads"],
      mensagens: [
        { de: "cliente", texto: "Boa noite, vocês têm apartamento pronto para morar? Preciso mudar até o fim do ano.", min: 0 },
        { de: "ia", texto: "Boa noite, Aline! Temos sim, no Bosque das Palmeiras: unidades de 2 e 3 quartos prontas para mudar. Para eu te mostrar as certas, você pretende financiar ou usar FGTS?", min: 1 },
      ],
    },
    {
      chave: "gustavo",
      contato: "gustavo",
      comecouHaDias: 12,
      passo: "lost",
      qualificacao: { budget: "Financiamento negado pelo banco", need: "2 quartos" },
      proximaAcao: null,
      ficha: {
        headline: "Crédito negado · refazer a análise em alguns meses",
        body: "O banco não aprovou o financiamento do Gustavo. Ele pediu para ser procurado de novo quando completar mais tempo de registro em carteira.",
      },
      com: "diogo",
      status: "resolved",
      mensagens: [
        { de: "cliente", texto: "Oi, Diogo, o banco negou o crédito. Acho que vou ter que deixar para depois.", min: 0 },
        { de: "equipe", texto: "Poxa, Gustavo, sinto muito. Se quiser, daqui a uns meses a gente refaz a análise com o Hélio. Às vezes muda com mais tempo de registro em carteira.", min: 15 },
        { de: "cliente", texto: "Pode ser, obrigado pela atenção.", min: 40 },
      ],
    },
  ],
  tiposDeAgenda: [
    { slug: "visita-decorado", nome: "Visita ao decorado", categoria: "visita", duracao: 90 },
    { slug: "visita-unidade", nome: "Visita à unidade pronta", categoria: "visita", duracao: 60 },
    { slug: "assinatura", nome: "Assinatura do contrato", categoria: "outro", duracao: 60 },
  ],
  compromissos: [
    { chave: "juliana-decorado", tipo: "visita-decorado", titulo: "Visita ao decorado · Juliana e marido", contato: "juliana", dono: "diogo", emDias: 3, hora: "10:00", duracaoMin: 90, status: "confirmed", local: "in_person", criadoPor: "ai" },
    { chave: "viviane-decorado", tipo: "visita-decorado", titulo: "Visita ao decorado remarcada · Viviane", contato: "viviane", dono: "luciana", emDias: 2, hora: "15:00", duracaoMin: 90, status: "pending", local: "in_person", criadoPor: "user" },
    { chave: "viviane-faltou", tipo: "visita-decorado", titulo: "Visita ao decorado · Viviane", contato: "viviane", dono: "luciana", emDias: -2, hora: "10:00", duracaoMin: 90, status: "no_show", local: "in_person", criadoPor: "ai" },
    { chave: "andre-simulacao", tipo: "reuniao", titulo: "Reunião de simulação · André", contato: "andre", dono: "diogo", emDias: 2, hora: "17:00", duracaoMin: 45, status: "confirmed", local: "in_person", criadoPor: "user" },
    { chave: "claudio-unidades", tipo: "visita-unidade", titulo: "Visita às unidades de andar alto · Cláudio", contato: "claudio", dono: "luciana", emDias: 1, hora: "11:00", duracaoMin: 60, status: "confirmed", local: "in_person", criadoPor: "user" },
    { chave: "credito-alinhamento", tipo: "reuniao", titulo: "Alinhamento dos processos de crédito · Crédito Certo", contato: "monica-credito", dono: "helio", emDias: 1, hora: "09:00", duracaoMin: 30, status: "pending", local: "phone", criadoPor: "user" },
    { chave: "camila-assinatura", tipo: "assinatura", titulo: "Assinatura do contrato · Camila", contato: "camila", dono: "helio", emDias: 8, hora: "14:00", duracaoMin: 60, status: "pending", local: "in_person", criadoPor: "user", nota: "Depende da aprovação do banco." },
    { chave: "lorena-assinatura", tipo: "assinatura", titulo: "Assinatura do contrato · Lorena", contato: "lorena", dono: "diogo", emDias: -9, hora: "14:00", duracaoMin: 60, status: "completed", local: "in_person", criadoPor: "user" },
    { chave: "hugo-unidade", tipo: "visita-unidade", titulo: "Visita à unidade · Hugo", contato: "hugo", dono: "diogo", emDias: -12, hora: "16:00", duracaoMin: 60, status: "completed", local: "in_person", criadoPor: "user" },
    { chave: "daniela-unidade", tipo: "visita-unidade", titulo: "Visita à unidade · Daniela", contato: "daniela", dono: "diogo", emDias: -6, hora: "15:00", duracaoMin: 60, status: "cancelled", local: "in_person", criadoPor: "user", nota: "A cliente cancelou: vai esperar o lançamento." },
    { chave: "marcos-ligacao", tipo: "reuniao", titulo: "Ligação para entender a renda · Marcos", contato: "marcos", dono: "luciana", emDias: 4, hora: "18:00", duracaoMin: 20, status: "pending", local: "whatsapp", criadoPor: "ai" },
  ],
  tarefas: [
    { chave: "espelho-torre-b", titulo: "Atualizar o espelho de vendas da Torre B", dono: "silvia", emDias: 2, prioridade: "medium", status: "pending" },
    { chave: "relatorio-mes", titulo: "Fechar o relatório de vendas do mês", dono: "silvia", emDias: -1, prioridade: "high", status: "pending", descricao: "Atrasada de propósito: a lista de atrasadas precisa de exemplo." },
    { chave: "decorado-fim-de-semana", titulo: "Preparar o decorado para o fim de semana", dono: "luciana", emDias: 3, prioridade: "low", status: "in_progress" },
    { chave: "tabela-parceiras", titulo: "Mandar a tabela do mês para as imobiliárias parceiras", dono: "diogo", emDias: 0, prioridade: "medium", status: "pending", contato: "rodrigo-alameda" },
    { chave: "contrato-lorena", titulo: "Conferir o contrato assinado da Lorena", dono: "helio", emDias: -7, prioridade: "high", status: "done", contato: "lorena" },
    { chave: "estande-shopping", titulo: "Renegociar o estande do shopping", dono: "silvia", emDias: -15, prioridade: "low", status: "cancelled" },
  ],
  followups: [
    { modelo: "imobiliario-retomada", funil: "lancamento", etapa: "contato" },
    { modelo: "imobiliario-visita", funil: "lancamento", etapa: "perfil" },
    { modelo: "imobiliario-proposta", funil: "lancamento", etapa: "simulacao" },
    { modelo: "imobiliario-falta", funil: "lancamento", etapa: "visita" },
  ],
  inscricoes: [
    { chave: "aline-retomada", modelo: "imobiliario-retomada", contato: "aline", status: "waiting_reply", no: "resposta-1", passos: 1, comecouHaDias: 0, proximaEmHoras: 30 },
    { chave: "felipe-retomada", modelo: "imobiliario-retomada", contato: "felipe", status: "waiting_reply", no: "resposta-2", passos: 3, comecouHaDias: 3, proximaEmHoras: 20 },
    { chave: "marcos-visita", modelo: "imobiliario-visita", contato: "marcos", status: "active", no: "espera-2", passos: 2, comecouHaDias: 2, proximaEmHoras: 22 },
    { chave: "wesley-proposta", modelo: "imobiliario-proposta", contato: "wesley", status: "waiting_reply", no: "resposta-1", passos: 2, comecouHaDias: 5, proximaEmHoras: 48 },
    { chave: "viviane-falta", modelo: "imobiliario-falta", contato: "viviane", status: "completed", no: "fim-marcou", passos: 3, comecouHaDias: 2, desfecho: "converted" },
    { chave: "daniela-retomada", modelo: "imobiliario-retomada", contato: "daniela", status: "cancelled", no: "resposta-1", passos: 1, comecouHaDias: 15, motivoDoCancelamento: "A cliente respondeu: vai esperar o lançamento." },
  ],
  obrigacoes: {
    funil: "lancamento",
    segmento: "imobiliaria",
    itens: [
      { chave: "rg-camila", tipo: "RG e CPF", contato: "camila", responsavel: "helio", recebidoEmDias: -12 },
      {
        chave: "renda-camila",
        tipo: "Comprovante de renda",
        negocio: "Camila Rezende · 2 quartos, Torre B",
        responsavel: "helio",
        recebidoEmDias: -80,
        validoAteEmDias: 10,
        observacao: "Holerite de julho. O banco aceita no máximo 90 dias.",
      },
      { chave: "fgts-camila", tipo: "Extrato do FGTS", negocio: "Camila Rezende · 2 quartos, Torre B", responsavel: "helio", pedidoEmDias: -8, prazoEmDias: -1 },
      {
        chave: "certidoes-camila",
        tipo: "Certidões (validade curta)",
        negocio: "Camila Rezende · 2 quartos, Torre B",
        responsavel: "helio",
        recebidoEmDias: -33,
        validoAteEmDias: -3,
        pedidoEmDias: -4,
        prazoEmDias: 1,
        proposta: { conversa: "camila", arquivo: "certidoes-atualizadas.pdf" },
      },
      { chave: "renda-igor", tipo: "Comprovante de renda", negocio: "Igor Batista · cobertura", responsavel: "helio", recebidoEmDias: -20, validoAteEmDias: 70 },
      {
        chave: "credito-igor",
        tipo: "Aprovação de crédito",
        negocio: "Igor Batista · cobertura",
        responsavel: "helio",
        observacao: "Pedir ao banco quando o comprovante de renda novo chegar.",
      },
      { chave: "rg-lorena", tipo: "RG e CPF", contato: "lorena", responsavel: "helio", recebidoEmDias: -45 },
      { chave: "credito-lorena", tipo: "Aprovação de crédito", negocio: "Lorena Campos · 2 quartos, Torre A", responsavel: "helio", recebidoEmDias: -30, validoAteEmDias: 150 },
      {
        chave: "parcela-patricia",
        tipo: "Parcela anual",
        negocio: "Patrícia Damasceno · 3 quartos, Torre B",
        responsavel: "silvia",
        proximaEmDias: 12,
        feitaEmDias: -353,
        ciclos: [{ proximaEmDias: -353, feitaEmDias: -353 }],
      },
      {
        chave: "reajuste-patricia",
        tipo: "Reajuste do contrato",
        negocio: "Patrícia Damasceno · 3 quartos, Torre B",
        responsavel: "silvia",
        proximaEmDias: 40,
        feitaEmDias: -325,
        ciclos: [{ proximaEmDias: -325, feitaEmDias: -325 }],
      },
    ],
  },
  produtos: [
    { codigo: "VP-STUDIO-32", nome: "Vista Parque · Studio 32 m²", descricao: "Studio com varanda, 32 m², vaga rotativa. Entrega prevista para o segundo semestre de 2028. Aceita FGTS.", marca: "Construtora Modelo", categoria: "Lançamento Vista Parque", precoReais: 265000, controlaEstoque: true, quantidade: 6 },
    { codigo: "VP-2Q-52", nome: "Vista Parque · 2 quartos 52 m²", descricao: "Dois quartos, varanda gourmet, uma vaga. Entrega prevista para 2028. Aceita FGTS e subsídio.", marca: "Construtora Modelo", categoria: "Lançamento Vista Parque", precoReais: 389000, controlaEstoque: true, quantidade: 14 },
    { codigo: "VP-2QS-61", nome: "Vista Parque · 2 quartos com suíte 61 m²", descricao: "Dois quartos, um deles suíte, varanda gourmet e uma vaga. A planta mais procurada.", marca: "Construtora Modelo", categoria: "Lançamento Vista Parque", precoReais: 452000, controlaEstoque: true, quantidade: 9 },
    { codigo: "VP-3Q-74", nome: "Vista Parque · 3 quartos 74 m²", descricao: "Três quartos com suíte, varanda gourmet e duas vagas.", marca: "Construtora Modelo", categoria: "Lançamento Vista Parque", precoReais: 569000, controlaEstoque: true, quantidade: 5 },
    { codigo: "VP-COB-128", nome: "Vista Parque · Cobertura duplex 128 m²", descricao: "Cobertura com terraço, piscina privativa e três vagas. Só duas unidades.", marca: "Construtora Modelo", categoria: "Lançamento Vista Parque", precoReais: 890000, controlaEstoque: true, quantidade: 2 },
    { codigo: "BP-2Q-58", nome: "Bosque das Palmeiras · 2 quartos 58 m² (pronto)", descricao: "Pronto para morar, com uma vaga. Aceita FGTS e financiamento.", marca: "Construtora Modelo", categoria: "Prontos Bosque das Palmeiras", precoReais: 410000, controlaEstoque: true, quantidade: 4 },
    { codigo: "BP-2QG-58", nome: "Bosque das Palmeiras · 2 quartos garden 58 m²", descricao: "Térreo com quintal privativo de 40 m². Última unidade.", marca: "Construtora Modelo", categoria: "Prontos Bosque das Palmeiras", precoReais: 435000, controlaEstoque: true, quantidade: 1 },
    { codigo: "BP-3Q-80", nome: "Bosque das Palmeiras · 3 quartos 80 m² (pronto)", descricao: "Pronto para morar, com suíte e duas vagas.", marca: "Construtora Modelo", categoria: "Prontos Bosque das Palmeiras", precoReais: 598000, controlaEstoque: true, quantidade: 3 },
    { codigo: "AD-VAGA-EXTRA", nome: "Vaga de garagem extra", descricao: "Vaga coberta adicional, vendida junto com a unidade.", marca: "Construtora Modelo", categoria: "Adicionais", precoReais: 35000, controlaEstoque: true, quantidade: 8 },
    { codigo: "AD-KIT-ACABAMENTO", nome: "Kit de acabamento (piso e armários)", descricao: "Piso vinílico nos quartos e armários na cozinha, contratado na assinatura.", marca: "Construtora Modelo", categoria: "Adicionais", precoReais: 28000, controlaEstoque: false },
  ],
};
