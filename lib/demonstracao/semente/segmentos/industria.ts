/**
 * FORK MIA · DEMONSTRAÇÃO · INDÚSTRIA E DISTRIBUIÇÃO B2B.
 *
 * A "Indústria Modelo" (fictícia) fabrica materiais elétricos e iluminação e
 * vende para revendas, distribuidores, instaladores e construtoras, com
 * representante comercial por região e um catálogo grande, com código. O que a
 * demonstração mostra a quem vende de fábrica:
 *
 *  - as empresas clientes com várias pessoas e papéis (quem compra, quem
 *    decide, quem cuida do financeiro), com a tabela de preço e o representante
 *    na ficha;
 *  - o funil de pedidos (o quadro pronto de indústria): do contato à cotação
 *    enviada, com número da cotação e prazo de pagamento, até o pedido fechado;
 *  - a recompra: o funil da carteira ativa e o pedido de reposição de cada
 *    cliente como atividade mensal, com o histórico das compras, uma reposição
 *    atrasada e uma chegando;
 *  - o cadastro da revenda como documentos com vencimento: ficha cadastral,
 *    contrato social, alvará, certidão negativa e contrato de revenda (com o
 *    arquivo do cliente esperando confirmação);
 *  - o catálogo com código, preço de tabela revenda, custo e estoque, e a
 *    política das tabelas por tipo de cliente no agente;
 *  - a agenda do representante e os quatro follow-ups do segmento novo.
 *
 * Tudo fictício e genérico: nenhum dado, produto ou nome de cliente real.
 * Telefone do DDD 00, e-mail `.invalid`, CNPJ que não existe.
 */
import { MODULO_DOS_LEADS_DA_META } from "@/lib/leads-da-meta/modulo";

import type { SementeDeDemonstracao } from "../tipos";
import { cnpjFalso, escolha } from "./comum";

/** Status de ciclo de vida gravado (ver `ConversaDaSemente.status`): a conversa está com a IA. */
const CONVERSA_COM_A_IA = "ai_handling" as const;

const REVENDA = "Tabela revenda";
const DISTRIBUIDOR = "Tabela distribuidor";
const PROFISSIONAL = "Tabela profissional";

/** Toda descrição de produto lembra a política de preço: o catálogo traz a tabela revenda. */
const POLITICA = "Preço da tabela revenda; distribuidor 12% abaixo, instalador e construtora 8% acima.";

export const INDUSTRIA: SementeDeDemonstracao = {
  segmento: "industria",
  rotulo: "Indústria e distribuição B2B",
  oQueMostra:
    "Uma fábrica que vende para revendas e profissionais: empresas clientes com comprador, decisor e financeiro, cotação com número e prazo, tabela de preço por tipo de cliente, catálogo com código, cadastro da revenda com vencimento e a recompra mensal de cada cliente.",
  nome: "Demonstração · Indústria",
  razaoSocial: "Indústria Modelo Demonstração (fictícia)",
  slug: "demonstracao-industria",
  prefixoDosIds: "demo:industria",
  sessaoDoCanal: "demonstracao-industria",
  telefoneDoCanal: "+5500900030000",
  modoDeVenda: "b2b",
  formularioDaMeta: "Formulário · Seja uma revenda (demonstração)",
  enderecoFicticio: "Loja ou obra do cliente (endereço fictício)",
  equipe: [
    { chave: "teresa", nome: "Teresa Arruda", papel: "manager", trilha: 1 },
    { chave: "wellington", nome: "Wellington Sá", papel: "agent", trilha: 2 },
    { chave: "clarice", nome: "Clarice Fontoura", papel: "agent", trilha: 3 },
    { chave: "murilo", nome: "Murilo Assunção", papel: "agent", trilha: 4 },
  ],
  gestor: "teresa",
  agente: {
    chave: "bento",
    nome: "Bento · Atendimento comercial (demonstração)",
    descricao:
      "Agente de exemplo da indústria de demonstração. Não tem versão publicada e o canal está arquivado: não atende ninguém de verdade.",
    prompt:
      "Você é o Bento, do atendimento comercial da Indústria Modelo, fabricante de materiais elétricos e iluminação. Atende pelo WhatsApp revendas, distribuidores, instaladores e construtoras. Entende quem é o cliente (revenda, distribuidor, instalador ou construtora), a cidade, as linhas de interesse e o volume, consulta o catálogo pelo código e passa para o representante da região quem quer cotar. O preço do catálogo é a tabela revenda: distribuidor tem 12% de desconto sobre ela, e instalador ou construtora compram pela tabela profissional, 8% acima. O pedido mínimo para faturar é de R$ 1.500; abaixo disso, indique a revenda mais próxima. Nunca prometa prazo de entrega nem estoque sem confirmar com o comercial.",
  },
  modulos: ["disparador", MODULO_DOS_LEADS_DA_META],
  empresas: [
    {
      chave: "ponto-forte",
      nome: "Elétrica Ponto Forte",
      site: "https://pontoforte.exemplo.invalid",
      cidade: "Campinas",
      uf: "SP",
      setor: "Revenda de material elétrico",
      observacoes: "Compra todo mês. O sócio aprova pedido acima de R$ 20 mil.",
      tags: ["revenda", "carteira-ativa"],
      cnpj: cnpjFalso(301),
      campos: { tabela: REVENDA, representante: "Wellington Sá", limite_de_credito: 60000, ciclo_de_compra_dias: 30 },
    },
    {
      chave: "luz-do-vale",
      nome: "Distribuidora Luz do Vale",
      site: null,
      cidade: "Taubaté",
      uf: "SP",
      setor: "Distribuidor regional",
      observacoes: "Atende 40 lojas na região. Compra por cotação, com prazo de 30/60/90 dias.",
      tags: ["distribuidor", "carteira-ativa", "conta-chave"],
      cnpj: cnpjFalso(302),
      campos: { tabela: DISTRIBUIDOR, representante: "Wellington Sá", limite_de_credito: 250000, ciclo_de_compra_dias: 30 },
    },
    {
      chave: "casa-eletricista",
      nome: "Casa do Eletricista Avenida",
      site: null,
      cidade: "Uberlândia",
      uf: "MG",
      setor: "Revenda de material elétrico",
      observacoes: "Loja de bairro. Compra pelo representante, uma vez por mês.",
      tags: ["revenda", "carteira-ativa"],
      cnpj: cnpjFalso(303),
      campos: { tabela: REVENDA, representante: "Murilo Assunção", limite_de_credito: 35000, ciclo_de_compra_dias: 30 },
    },
    {
      chave: "bom-lar",
      nome: "Materiais de Construção Bom Lar",
      site: "https://bomlar.exemplo.invalid",
      cidade: "Londrina",
      uf: "PR",
      setor: "Home center",
      observacoes: "Primeira compra em andamento. Cadastro em análise.",
      tags: ["revenda", "novo-cliente"],
      cnpj: cnpjFalso(304),
      campos: { tabela: REVENDA, representante: "Clarice Fontoura" },
    },
    {
      chave: "faisca",
      nome: "Faísca Instalações Elétricas",
      site: null,
      cidade: "Belo Horizonte",
      uf: "MG",
      setor: "Instaladora",
      observacoes: "Compra por obra. Quem aprova é o engenheiro responsável.",
      tags: ["profissional", "instaladora"],
      cnpj: cnpjFalso(305),
      campos: { tabela: PROFISSIONAL, representante: "Murilo Assunção" },
    },
    {
      chave: "alicerce",
      nome: "Construtora Alicerce Norte",
      site: null,
      cidade: "Goiânia",
      uf: "GO",
      setor: "Construtora",
      observacoes: "Duas obras residenciais em andamento. Compra por etapa da obra.",
      tags: ["construtora"],
      cnpj: cnpjFalso(306),
      campos: { tabela: PROFISSIONAL, representante: "Murilo Assunção" },
    },
    {
      chave: "tres-irmaos",
      nome: "Elétrica Três Irmãos",
      site: null,
      cidade: "Ribeirão Preto",
      uf: "SP",
      setor: "Revenda de material elétrico",
      observacoes: "Parou de comprar há dois meses.",
      tags: ["revenda"],
      cnpj: cnpjFalso(307),
      campos: { tabela: REVENDA, representante: "Wellington Sá" },
    },
  ],
  contatos: [
    // Revendas e distribuidores: quem compra, quem decide e quem cuida do financeiro.
    { chave: "sergio-ponto", nome: "Sérgio Bandeira", n: 301, comEmail: true, empresa: "ponto-forte", cargo: "Sócio", setor: "Diretoria", decisor: true },
    { chave: "katia-ponto", nome: "Kátia Lemos", n: 302, comEmail: true, empresa: "ponto-forte", cargo: "Compradora", setor: "Compras" },
    { chave: "neide-ponto", nome: "Neide Carvalho", n: 303, comEmail: false, empresa: "ponto-forte", cargo: "Financeiro", setor: "Financeiro" },
    { chave: "alberto-luz", nome: "Alberto Guimarães", n: 304, comEmail: true, empresa: "luz-do-vale", cargo: "Diretor comercial", setor: "Diretoria", decisor: true },
    { chave: "fabiana-luz", nome: "Fabiana Rezende", n: 305, comEmail: true, empresa: "luz-do-vale", cargo: "Compradora", setor: "Compras" },
    { chave: "leonardo-luz", nome: "Leonardo Pires", n: 306, comEmail: true, empresa: "luz-do-vale", cargo: "Financeiro e crédito", setor: "Financeiro" },
    { chave: "gilberto-casa", nome: "Gilberto Souza", n: 307, comEmail: false, empresa: "casa-eletricista", cargo: "Proprietário", setor: "Diretoria", decisor: true },
    { chave: "rita-casa", nome: "Rita de Cássia Lima", n: 308, comEmail: true, empresa: "casa-eletricista", cargo: "Compradora", setor: "Compras" },
    { chave: "douglas-bomlar", nome: "Douglas Ferreira", n: 309, comEmail: true, empresa: "bom-lar", cargo: "Gerente de compras", setor: "Compras", decisor: true },
    { chave: "marisa-bomlar", nome: "Marisa Okada", n: 310, comEmail: true, empresa: "bom-lar", cargo: "Cadastro e crédito", setor: "Financeiro" },
    { chave: "paulo-faisca", nome: "Paulo Vasconcelos", n: 311, comEmail: true, empresa: "faisca", cargo: "Engenheiro responsável", setor: "Engenharia", decisor: true },
    { chave: "tania-faisca", nome: "Tânia Ribeiro", n: 312, comEmail: true, empresa: "faisca", cargo: "Compras", setor: "Compras" },
    { chave: "ronaldo-alicerce", nome: "Ronaldo Bastos", n: 313, comEmail: true, empresa: "alicerce", cargo: "Engenheiro de obras", setor: "Engenharia", decisor: true },
    { chave: "cristina-alicerce", nome: "Cristina Paes", n: 314, comEmail: true, empresa: "alicerce", cargo: "Suprimentos", setor: "Compras" },
    { chave: "osvaldo-tres", nome: "Osvaldo Nunes", n: 315, comEmail: false, empresa: "tres-irmaos", cargo: "Sócio", setor: "Diretoria", decisor: true },
    // Profissionais autônomos e quem ainda vai virar revenda.
    { chave: "jefferson", nome: "Jefferson Lima", n: 321, comEmail: false, tags: ["eletricista"] },
    { chave: "cleber", nome: "Cleber Santos", n: 322, comEmail: false, tags: ["eletricista"] },
    { chave: "marcia", nome: "Márcia Fontes", n: 323, comEmail: true, tags: ["quer-ser-revenda"] },
    { chave: "valter", nome: "Valter Rocha", n: 324, comEmail: true, tags: ["quer-ser-revenda"] },
  ],
  funis: [
    {
      chave: "pedidos",
      nome: "Pedidos · Revendas e profissionais",
      descricao: "O quadro pronto de indústria: do contato à cotação enviada e ao pedido fechado, para revendas, distribuidores, instaladores e construtoras.",
      pacote: "industria",
      nichoDeFollowup: "industria_b2b",
      vocabulario: { lead: "Cliente", lead_plural: "Clientes", deal: "Cotação", deal_plural: "Cotações", won: "Pedido fechado", lost: "Não fechou" },
      campos: [
        escolha("tipo_de_cliente", "Tipo de cliente", ["Revenda", "Distribuidor", "Instalador ou eletricista", "Construtora"]),
        escolha("tabela", "Tabela de preço", [REVENDA, DISTRIBUIDOR, PROFISSIONAL]),
        escolha("linha", "Linha principal", ["Fios e cabos", "Disjuntores e quadros", "Tomadas e interruptores", "Iluminação LED", "Mix completo"]),
        { key: "numero_da_cotacao", label: "Número da cotação", type: "text" },
        escolha("prazo_de_pagamento", "Prazo de pagamento", ["À vista", "28 dias", "28/56 dias", "30/60/90 dias"]),
        { key: "representante", label: "Representante", type: "text" },
        { key: "primeira_compra", label: "Primeira compra", type: "boolean" },
      ],
      motivosDePerda: [
        { label: "Comprou de outro fabricante", categoria: "Concorrência" },
        { label: "Prazo de entrega não atendeu", categoria: "Nós" },
        { label: "Crédito não aprovado", categoria: "Cliente" },
        { label: "Abaixo do pedido mínimo", categoria: "Mérito" },
        { label: "Parou de responder", categoria: "Ausência" },
      ],
      motivosDeGanho: ["Prazo de entrega", "Condição de pagamento", "Visita do representante", "Mix de produtos"],
      vitoriaEReceita: true,
      negocios: [
        { titulo: "Márcia Fontes · quer ser revenda", passo: "new", contato: "marcia", valorReais: 12000, dono: "ia", origem: "meta_formulario", criadoHaDias: 0, naEtapaHaDias: 0, campos: { tipo_de_cliente: "Revenda", primeira_compra: true } },
        { titulo: "Jefferson Lima · cabos para obra", passo: "contacted", contato: "jefferson", valorReais: 2800, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 1, naEtapaHaDias: 1, campos: { tipo_de_cliente: "Instalador ou eletricista", tabela: PROFISSIONAL, linha: "Fios e cabos" } },
        { titulo: "Bom Lar · primeira compra do mix elétrico", passo: "qualifying", contato: "douglas-bomlar", valorReais: 18500, dono: "clarice", origem: "google", criadoHaDias: 5, naEtapaHaDias: 2, campos: { tipo_de_cliente: "Revenda", tabela: REVENDA, linha: "Mix completo", primeira_compra: true, representante: "Clarice Fontoura" }, proximaAcao: { titulo: "Levar o catálogo e a sugestão de primeiro pedido na Bom Lar", emDias: 3, prioridade: "high" } },
        { titulo: "Valter Rocha · iluminação LED para a loja", passo: "qualifying", contato: "valter", valorReais: 6400, dono: "clarice", origem: "google", criadoHaDias: 6, naEtapaHaDias: 4, campos: { tipo_de_cliente: "Revenda", tabela: REVENDA, linha: "Iluminação LED", primeira_compra: true } },
        { titulo: "Faísca Instalações · obra do residencial Jardins", passo: "qualified", contato: "paulo-faisca", valorReais: 42500, dono: "murilo", origem: "indicacao", criadoHaDias: 8, naEtapaHaDias: 3, campos: { tipo_de_cliente: "Instalador ou eletricista", tabela: PROFISSIONAL, linha: "Mix completo", numero_da_cotacao: "COT-2026-0418", prazo_de_pagamento: "28/56 dias", representante: "Murilo Assunção" }, proximaAcao: { titulo: "Cobrar retorno da cotação COT-2026-0418", emDias: 1 } },
        { titulo: "Alicerce Norte · quadros e disjuntores da torre 2", passo: "qualified", contato: "ronaldo-alicerce", valorReais: 31800, dono: "murilo", origem: "site", criadoHaDias: 10, naEtapaHaDias: 4, campos: { tipo_de_cliente: "Construtora", tabela: PROFISSIONAL, linha: "Disjuntores e quadros", numero_da_cotacao: "COT-2026-0409", prazo_de_pagamento: "28 dias", representante: "Murilo Assunção" } },
        { titulo: "Luz do Vale · pedido do trimestre", passo: "negotiating", contato: "alberto-luz", valorReais: 96000, dono: "teresa", origem: "indicacao", criadoHaDias: 14, naEtapaHaDias: 5, campos: { tipo_de_cliente: "Distribuidor", tabela: DISTRIBUIDOR, linha: "Mix completo", numero_da_cotacao: "COT-2026-0397", prazo_de_pagamento: "30/60/90 dias", representante: "Wellington Sá" }, proximaAcao: { titulo: "Aprovar o prazo 30/60/90 com o financeiro", emDias: 0, prioridade: "urgent" }, nota: "Pediu 3% a mais de desconto para fechar o trimestre." },
        { titulo: "Casa do Eletricista · cabos e tomadas", passo: "won", contato: "rita-casa", valorReais: 14200, dono: "murilo", origem: "indicacao", criadoHaDias: 20, naEtapaHaDias: 12, campos: { tipo_de_cliente: "Revenda", tabela: REVENDA, linha: "Mix completo", numero_da_cotacao: "COT-2026-0388", prazo_de_pagamento: "28/56 dias", representante: "Murilo Assunção" }, motivoDoGanho: "Visita do representante" },
        { titulo: "Elétrica Três Irmãos · reposição de cabos", passo: "lost", contato: "osvaldo-tres", valorReais: 9800, dono: "wellington", origem: "google", criadoHaDias: 70, naEtapaHaDias: 45, campos: { tipo_de_cliente: "Revenda", tabela: REVENDA, linha: "Fios e cabos" }, motivoDaPerda: "Comprou de outro fabricante" },
        { titulo: "Cleber Santos · disjuntores", passo: "lost", contato: "cleber", valorReais: 640, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 6, naEtapaHaDias: 6, campos: { tipo_de_cliente: "Instalador ou eletricista", tabela: PROFISSIONAL, linha: "Disjuntores e quadros" }, motivoDaPerda: "Abaixo do pedido mínimo", nota: "Indicamos a revenda mais perto dele." },
      ],
    },
    {
      chave: "recompra",
      nome: "Recompra · Carteira ativa",
      descricao: "Os clientes que já compram: quem está na hora de repor, a cotação de reposição e quem parou de comprar.",
      etapas: [
        { chave: "ativo", nome: "Cliente ativo", passo: null, probabilidade: 30, prazoHoras: 720 },
        { chave: "repor", nome: "Hora de repor", passo: null, probabilidade: 50, prazoHoras: 168 },
        { chave: "cotacao", nome: "Cotação de reposição enviada", passo: null, probabilidade: 70, prazoHoras: 120 },
        { chave: "fechada", nome: "Reposição fechada", passo: null, fim: "won" },
        { chave: "parou", nome: "Parou de comprar", passo: null, fim: "lost" },
      ],
      nichoDeFollowup: "industria_b2b",
      vocabulario: { lead: "Cliente", lead_plural: "Clientes", deal: "Reposição", deal_plural: "Reposições", won: "Reposição fechada", lost: "Parou de comprar" },
      campos: [
        { key: "ciclo_de_compra", label: "Ciclo de compra (dias)", type: "number" },
        { key: "ticket_medio", label: "Ticket médio (R$)", type: "number" },
        escolha("tabela", "Tabela de preço", [REVENDA, DISTRIBUIDOR, PROFISSIONAL]),
        { key: "representante", label: "Representante", type: "text" },
        { key: "itens_de_sempre", label: "Itens de sempre", type: "textarea" },
      ],
      motivosDePerda: [
        { label: "Trocou de fornecedor", categoria: "Concorrência" },
        { label: "Fechou a loja", categoria: "Cliente" },
        { label: "Estoque parado na loja", categoria: "Cliente" },
        { label: "Atendimento do representante", categoria: "Nós" },
        { label: "Parou de responder", categoria: "Ausência" },
      ],
      motivosDeGanho: ["Lembrete na hora certa", "Condição de recompra", "Visita do representante"],
      vitoriaEReceita: true,
      negocios: [
        { titulo: "Casa do Eletricista · reposição mensal", passo: "ativo", contato: "rita-casa", valorReais: 13800, dono: "murilo", origem: "indicacao", criadoHaDias: 12, naEtapaHaDias: 12, campos: { ciclo_de_compra: 30, ticket_medio: 14000, tabela: REVENDA, representante: "Murilo Assunção", itens_de_sempre: "Cabo flexível 2,5 e 4 mm, tomadas 10 A e 20 A, disjuntores de 20 A." } },
        { titulo: "Faísca Instalações · material por obra", passo: "ativo", contato: "tania-faisca", valorReais: 9600, dono: "murilo", origem: "indicacao", criadoHaDias: 60, naEtapaHaDias: 25, campos: { ciclo_de_compra: 45, ticket_medio: 9000, tabela: PROFISSIONAL, representante: "Murilo Assunção" } },
        { titulo: "Ponto Forte · reposição de outubro", passo: "repor", contato: "katia-ponto", valorReais: 21500, dono: "wellington", origem: "indicacao", criadoHaDias: 27, naEtapaHaDias: 3, campos: { ciclo_de_compra: 30, ticket_medio: 21000, tabela: REVENDA, representante: "Wellington Sá", itens_de_sempre: "Cabos de 1,5 a 6 mm, disjuntores, DR e lâmpadas LED em caixa." }, proximaAcao: { titulo: "Mandar a sugestão de pedido para a Kátia", emDias: 1, prioridade: "high" } },
        { titulo: "Luz do Vale · reposição mensal de cabos", passo: "cotacao", contato: "fabiana-luz", valorReais: 48000, dono: "wellington", origem: "indicacao", criadoHaDias: 35, naEtapaHaDias: 1, campos: { ciclo_de_compra: 30, ticket_medio: 52000, tabela: DISTRIBUIDOR, representante: "Wellington Sá" }, proximaAcao: { titulo: "Confirmar a cotação de reposição com a Fabiana", emDias: 0, prioridade: "urgent" } },
        { titulo: "Ponto Forte · reposição de setembro", passo: "fechada", contato: "katia-ponto", valorReais: 20800, dono: "wellington", origem: "indicacao", criadoHaDias: 33, naEtapaHaDias: 27, campos: { ciclo_de_compra: 30, tabela: REVENDA, representante: "Wellington Sá" }, motivoDoGanho: "Lembrete na hora certa" },
        { titulo: "Três Irmãos · carteira", passo: "parou", contato: "osvaldo-tres", valorReais: 9800, dono: "wellington", origem: "indicacao", criadoHaDias: 120, naEtapaHaDias: 45, campos: { ciclo_de_compra: 30, tabela: REVENDA, representante: "Wellington Sá" }, motivoDaPerda: "Trocou de fornecedor" },
      ],
    },
  ],
  funilPadrao: "pedidos",
  conversas: [
    {
      chave: "marcia",
      contato: "marcia",
      comecouHaDias: 0,
      passo: "new",
      qualificacao: { need: "Quer ser revenda da linha elétrica" },
      proximaAcao: "Entender se a loja já trabalha com material elétrico",
      ficha: null,
      com: "ia",
      status: CONVERSA_COM_A_IA,
      etiquetas: ["Meta_ads", "Formulario_Meta"],
      mensagens: [
        { de: "ia", texto: "Olá, Márcia! Aqui é o Bento, do comercial da Indústria Modelo. Vi seu cadastro no formulário para ser revenda. Sua loja já trabalha com material elétrico ou seria uma linha nova?", min: 0 },
      ],
    },
    {
      chave: "douglas",
      contato: "douglas-bomlar",
      comecouHaDias: 2,
      passo: "qualifying",
      qualificacao: {
        budget: "Primeiro pedido de R$ 15 a 20 mil",
        authority: "Gerente de compras, aprova com a diretoria",
        need: "Mix completo de material elétrico para a loja",
        timeline: "Quer começar a vender este mês",
      },
      proximaAcao: "Visita da representante para montar o primeiro pedido",
      ficha: {
        headline: "Home center no Paraná · mix completo · R$ 15 a 20 mil",
        body:
          "Douglas é gerente de compras da Bom Lar, em Londrina. Quer colocar a linha elétrica na loja, começando com um pedido de R$ 15 a 20 mil. Pediu a lista de documentos do cadastro. A Clarice marcou a visita para quinta às 10h.",
      },
      passagem: {
        titulo: "Home center do Paraná quer abrir conta",
        resumo:
          "Bom Lar, Londrina: revenda nova, mix completo, primeiro pedido de R$ 15 a 20 mil. Pediu a lista de documentos do cadastro.",
        ultimaFala: "Pode sim. E o que precisa para o cadastro?",
        reconhecidaPor: "clarice",
      },
      com: "clarice",
      status: "claimed",
      etiquetas: ["Google_ads", "novo-cliente"],
      mensagens: [
        { de: "cliente", texto: "Boa tarde. Sou o Douglas, gerente de compras da Bom Lar, em Londrina. Queremos colocar uma linha de material elétrico na loja. Vocês atendem o Paraná?", min: 0 },
        { de: "ia", texto: "Boa tarde, Douglas! Atendemos sim, com entrega pela transportadora parceira. Para eu montar a sugestão certa: vocês querem começar pelo mix completo ou por alguma linha, como fios e cabos ou iluminação?", min: 1 },
        { de: "cliente", texto: "Mix completo, mas começando enxuto. Uns 15 a 20 mil no primeiro pedido.", min: 8 },
        { de: "ia", texto: "Perfeito. Para revenda o preço é o da tabela revenda, com pedido mínimo de R$ 1.500 e prazo de 28/56 dias depois do cadastro aprovado. O melhor passo é a visita da nossa representante para montar o primeiro pedido com você. Posso pedir para ela te chamar?", min: 9 },
        { de: "cliente", texto: "Pode sim. E o que precisa para o cadastro?", min: 15 },
        { de: "ia", texto: "Ficha cadastral, contrato social, alvará e a certidão negativa. Pode mandar por aqui mesmo. A Clarice vai te chamar ainda hoje.", min: 16 },
        { de: "equipe", texto: "Oi, Douglas! Aqui é a Clarice. Posso passar na loja na quinta de manhã para montarmos o primeiro pedido?", min: 120 },
        { de: "cliente", texto: "Quinta às 10h está ótimo.", min: 140 },
      ],
    },
    {
      chave: "fabiana",
      contato: "fabiana-luz",
      comecouHaDias: 1,
      passo: "negotiating",
      qualificacao: {
        budget: "Reposição de cerca de R$ 48 mil, prazo 30/60/90",
        authority: "Compradora; o diretor aprova acima de R$ 50 mil",
        need: "Cabos de 2,5 e 4 mm e disjuntores de 20 A",
        timeline: "Precisa da entrega na semana que vem",
      },
      proximaAcao: "Confirmar a cotação de reposição",
      ficha: {
        headline: "Reposição do mês · R$ 48 mil · 30/60/90",
        body:
          "Fabiana pediu a reposição de cabos e disjuntores. A IA sugeriu as quantidades pela última compra, ela aumentou os cabos de 2,5 mm para 100 rolos. Cotação enviada pelo Wellington.",
      },
      passagem: {
        titulo: "Luz do Vale pediu a reposição do mês",
        resumo: "Reposição de cabos e disjuntores, cerca de R$ 48 mil, prazo 30/60/90. Quantidades ajustadas com a compradora.",
        ultimaFala: "Pode aumentar os de 2,5 mm para 100 rolos. O resto está certo.",
        reconhecidaPor: "wellington",
      },
      com: "wellington",
      status: "claimed",
      etiquetas: ["distribuidor", "recompra"],
      mensagens: [
        { de: "cliente", texto: "Bom dia! Preciso repor cabos de 2,5 e 4 mm e os disjuntores de 20 A. Me manda a cotação com o prazo de sempre?", min: 0 },
        { de: "ia", texto: "Bom dia, Fabiana! Claro. Pela última compra de vocês, sugiro 80 rolos de 2,5 mm, 40 rolos de 4 mm e 300 disjuntores de 20 A. Quer ajustar alguma quantidade antes de eu passar para o Wellington?", min: 1 },
        { de: "cliente", texto: "Pode aumentar os de 2,5 mm para 100 rolos. O resto está certo.", min: 9 },
        { de: "ia", texto: "Anotado: 100 rolos de 2,5 mm, 40 de 4 mm e 300 disjuntores de 20 A, prazo 30/60/90. O Wellington confirma a disponibilidade e te manda a cotação ainda hoje.", min: 10 },
        { de: "equipe", texto: "Fabiana, a cotação COT-2026-0431 está no seu e-mail. Entrega em até 5 dias úteis depois da aprovação.", min: 95 },
      ],
    },
    {
      chave: "alberto",
      contato: "alberto-luz",
      comecouHaDias: 0,
      passo: "won",
      qualificacao: { authority: "Diretor comercial, assina o contrato de revenda" },
      proximaAcao: "Conferir e arquivar o contrato de revenda assinado",
      ficha: {
        headline: "Contrato de revenda renovado · assinado pelo diretor",
        body: "Alberto devolveu pelo WhatsApp o contrato de revenda renovado, assinado. Falta conferir e arquivar no cadastro da Luz do Vale.",
      },
      com: "teresa",
      status: "open",
      etiquetas: ["distribuidor", "contrato"],
      mensagens: [
        { de: "ia", texto: "Olá, Alberto! O contrato de revenda da Luz do Vale vence este mês. A Teresa preparou a versão renovada; se estiver de acordo, pode devolver assinada por aqui mesmo.", min: 0 },
        { de: "cliente", texto: "Assinei, segue o PDF.", min: 120 },
        { de: "ia", texto: "Recebido, obrigado! Vou passar para a Teresa conferir e arquivar.", min: 121 },
      ],
    },
    {
      chave: "jefferson",
      contato: "jefferson",
      comecouHaDias: 1,
      passo: "contacted",
      qualificacao: { need: "Cabo flexível 2,5 mm para obra" },
      proximaAcao: "Pedir bitolas, cores e quantidade de rolos",
      ficha: null,
      com: "ia",
      status: CONVERSA_COM_A_IA,
      etiquetas: ["Meta_ads"],
      mensagens: [
        { de: "cliente", texto: "Vocês vendem cabo flexível 2,5 direto para eletricista?", min: 0 },
        { de: "ia", texto: "Oi, Jefferson! Vendemos sim, pela tabela profissional, a partir de R$ 1.500 por pedido. Me diz as bitolas, as cores e quantos rolos que eu monto a cotação.", min: 1 },
      ],
    },
    {
      chave: "cleber",
      contato: "cleber",
      comecouHaDias: 6,
      passo: "lost",
      qualificacao: { need: "10 disjuntores bipolares de 40 A" },
      proximaAcao: null,
      ficha: {
        headline: "Pedido abaixo do mínimo · indicado para a revenda",
        body: "Cleber queria 10 disjuntores. Abaixo do pedido mínimo; a IA indicou a revenda mais perto dele, que trabalha com a linha.",
      },
      com: "ia",
      status: "resolved",
      mensagens: [
        { de: "cliente", texto: "Quanto sai o disjuntor bipolar de 40 A? Preciso de 10.", min: 0 },
        { de: "ia", texto: "Oi, Cleber! O disjuntor bipolar de 40 A sai a R$ 62,64 na tabela profissional. O faturamento direto da fábrica começa em R$ 1.500 por pedido. Para 10 peças, a revenda mais perto de você é a Casa do Eletricista Avenida, que trabalha com a nossa linha. Quer o contato deles?", min: 1 },
        { de: "cliente", texto: "Quero sim, obrigado.", min: 6 },
        { de: "ia", texto: "Passei o seu contato para eles. Quando tiver uma obra maior, me chama que eu monto a cotação direto da fábrica.", min: 7 },
      ],
    },
  ],
  tiposDeAgenda: [
    { slug: "visita-representante", nome: "Visita do representante", categoria: "visita", duracao: 60 },
    { slug: "apresentacao-catalogo", nome: "Apresentação do catálogo", categoria: "demonstracao", duracao: 45 },
  ],
  compromissos: [
    { chave: "douglas-visita", tipo: "visita-representante", titulo: "Visita para o primeiro pedido · Bom Lar", contato: "douglas-bomlar", dono: "clarice", emDias: 3, hora: "10:00", duracaoMin: 60, status: "confirmed", local: "in_person", criadoPor: "user" },
    { chave: "faisca-obra", tipo: "visita-representante", titulo: "Visita à obra do residencial Jardins · Faísca", contato: "paulo-faisca", dono: "murilo", emDias: 2, hora: "14:00", duracaoMin: 60, status: "pending", local: "in_person", criadoPor: "user" },
    { chave: "alicerce-apresentacao", tipo: "apresentacao-catalogo", titulo: "Apresentação da linha de quadros · Alicerce Norte", contato: "ronaldo-alicerce", dono: "murilo", emDias: 5, hora: "10:30", duracaoMin: 45, status: "pending", local: "phone", criadoPor: "user" },
    { chave: "luz-trimestre", tipo: "reuniao", titulo: "Fechamento do trimestre · Luz do Vale", contato: "alberto-luz", dono: "teresa", emDias: 1, hora: "15:00", duracaoMin: 60, status: "confirmed", local: "phone", criadoPor: "user" },
    { chave: "ponto-forte-visita", tipo: "visita-representante", titulo: "Visita mensal · Ponto Forte", contato: "katia-ponto", dono: "wellington", emDias: 4, hora: "09:00", duracaoMin: 60, status: "confirmed", local: "in_person", criadoPor: "user" },
    { chave: "ponto-forte-visita-anterior", tipo: "visita-representante", titulo: "Visita mensal · Ponto Forte", contato: "katia-ponto", dono: "wellington", emDias: -27, hora: "09:00", duracaoMin: 60, status: "completed", local: "in_person", criadoPor: "user" },
    { chave: "casa-visita", tipo: "visita-representante", titulo: "Visita mensal · Casa do Eletricista", contato: "rita-casa", dono: "murilo", emDias: -12, hora: "10:00", duracaoMin: 60, status: "completed", local: "in_person", criadoPor: "user" },
    { chave: "valter-apresentacao", tipo: "apresentacao-catalogo", titulo: "Apresentação do catálogo de LED · Valter", contato: "valter", dono: "clarice", emDias: -2, hora: "16:00", duracaoMin: 45, status: "no_show", local: "phone", criadoPor: "ai" },
    { chave: "tres-irmaos-visita", tipo: "visita-representante", titulo: "Visita · Três Irmãos", contato: "osvaldo-tres", dono: "wellington", emDias: -50, hora: "11:00", duracaoMin: 60, status: "cancelled", local: "in_person", criadoPor: "user", nota: "O cliente cancelou: fechou com outro fabricante." },
  ],
  tarefas: [
    { chave: "tabela-novembro", titulo: "Atualizar a tabela de preços de novembro no catálogo", dono: "teresa", emDias: 6, prioridade: "high", status: "pending" },
    { chave: "rota-interior", titulo: "Montar a rota de visitas do interior de SP", dono: "wellington", emDias: 2, prioridade: "medium", status: "in_progress" },
    { chave: "limite-luz", titulo: "Cobrar o financeiro da Luz do Vale sobre o limite de crédito", dono: "teresa", emDias: -2, prioridade: "high", status: "pending", contato: "leonardo-luz", descricao: "Atrasada de propósito: a lista de atrasadas precisa de exemplo." },
    { chave: "catalogo-led", titulo: "Mandar o catálogo novo de iluminação para as revendas", dono: "clarice", emDias: 1, prioridade: "medium", status: "pending" },
    { chave: "faturado-casa", titulo: "Conferir o pedido faturado da Casa do Eletricista", dono: "murilo", emDias: -10, prioridade: "medium", status: "done", contato: "rita-casa" },
    { chave: "meta-trimestre", titulo: "Revisar a meta do trimestre com os representantes", dono: "teresa", emDias: null, prioridade: "low", status: "pending" },
    { chave: "feira", titulo: "Reservar estande na feira regional de material elétrico", dono: "teresa", emDias: -20, prioridade: "low", status: "cancelled" },
  ],
  followups: [
    { modelo: "industria-b2b-retomada", funil: "pedidos", etapa: "contacted" },
    { modelo: "industria-b2b-visita", funil: "pedidos", etapa: "qualifying" },
    { modelo: "industria-b2b-cotacao", funil: "pedidos", etapa: "qualified" },
    { modelo: "industria-b2b-falta", funil: "pedidos", etapa: "qualifying" },
  ],
  inscricoes: [
    { chave: "jefferson-retomada", modelo: "industria-b2b-retomada", contato: "jefferson", status: "waiting_reply", no: "resposta-1", passos: 1, comecouHaDias: 0, proximaEmHoras: 36 },
    { chave: "valter-falta", modelo: "industria-b2b-falta", contato: "valter", status: "active", no: "espera-2", passos: 2, comecouHaDias: 2, proximaEmHoras: 20 },
    { chave: "faisca-cotacao", modelo: "industria-b2b-cotacao", contato: "paulo-faisca", status: "waiting_reply", no: "resposta-1", passos: 2, comecouHaDias: 3, proximaEmHoras: 40 },
    { chave: "alicerce-cotacao", modelo: "industria-b2b-cotacao", contato: "ronaldo-alicerce", status: "active", no: "espera-2", passos: 2, comecouHaDias: 4, proximaEmHoras: 60 },
    { chave: "bomlar-visita", modelo: "industria-b2b-visita", contato: "douglas-bomlar", status: "completed", no: "fim-marcou", passos: 3, comecouHaDias: 2, desfecho: "converted" },
    { chave: "tres-irmaos-cotacao", modelo: "industria-b2b-cotacao", contato: "osvaldo-tres", status: "completed", no: "fim-esgotou", passos: 13, comecouHaDias: 60, desfecho: "exhausted" },
  ],
  obrigacoes: {
    funil: "pedidos",
    segmento: "industria_b2b",
    itens: [
      { chave: "ficha-ponto-forte", tipo: "Ficha cadastral da revenda", empresa: "ponto-forte", responsavel: "wellington", recebidoEmDias: -100, validoAteEmDias: 265 },
      {
        chave: "contrato-luz",
        tipo: "Contrato de revenda",
        empresa: "luz-do-vale",
        responsavel: "teresa",
        recebidoEmDias: -345,
        validoAteEmDias: 20,
        pedidoEmDias: -3,
        prazoEmDias: 10,
        ciclos: [{ recebidoEmDias: -710, validoAteEmDias: -345 }],
        proposta: { conversa: "alberto", arquivo: "contrato-de-revenda-assinado.pdf" },
      },
      {
        chave: "alvara-casa",
        tipo: "Alvará de funcionamento",
        empresa: "casa-eletricista",
        responsavel: "murilo",
        recebidoEmDias: -369,
        validoAteEmDias: -4,
        pedidoEmDias: -12,
        prazoEmDias: -5,
        observacao: "O Gilberto disse que já protocolou a renovação na prefeitura.",
      },
      { chave: "cnd-bom-lar", tipo: "Certidão negativa de débitos", empresa: "bom-lar", responsavel: "clarice", pedidoEmDias: -9, prazoEmDias: -2 },
      { chave: "contrato-social-bom-lar", tipo: "Contrato social", empresa: "bom-lar", responsavel: "clarice", recebidoEmDias: -6 },
      { chave: "ficha-bom-lar", tipo: "Ficha cadastral da revenda", empresa: "bom-lar", responsavel: "clarice", recebidoEmDias: -6, validoAteEmDias: 359 },
      { chave: "ficha-faisca", tipo: "Ficha cadastral da revenda", empresa: "faisca", responsavel: "murilo", observacao: "Pedir antes do primeiro faturamento a prazo." },
      {
        chave: "reposicao-ponto-forte",
        tipo: "Pedido de reposição",
        empresa: "ponto-forte",
        responsavel: "wellington",
        proximaEmDias: 3,
        feitaEmDias: -27,
        ciclos: [
          { proximaEmDias: -58, feitaEmDias: -57 },
          { proximaEmDias: -27, feitaEmDias: -27 },
        ],
      },
      {
        chave: "reposicao-luz",
        tipo: "Pedido de reposição",
        empresa: "luz-do-vale",
        responsavel: "wellington",
        proximaEmDias: -5,
        feitaEmDias: -35,
        observacao: "Atrasou: a cotação de reposição saiu ontem.",
        ciclos: [
          { proximaEmDias: -66, feitaEmDias: -65 },
          { proximaEmDias: -35, feitaEmDias: -35 },
        ],
      },
      {
        chave: "reposicao-casa",
        tipo: "Pedido de reposição",
        empresa: "casa-eletricista",
        responsavel: "murilo",
        proximaEmDias: 18,
        feitaEmDias: -12,
        ciclos: [
          { proximaEmDias: -42, feitaEmDias: -42 },
          { proximaEmDias: -12, feitaEmDias: -12 },
        ],
      },
      {
        chave: "visita-luz",
        tipo: "Visita do representante",
        empresa: "luz-do-vale",
        responsavel: "wellington",
        proximaEmDias: 6,
        feitaEmDias: -54,
        ciclos: [{ proximaEmDias: -54, feitaEmDias: -54 }],
      },
      {
        chave: "reajuste-luz",
        tipo: "Reajuste da tabela de preços",
        empresa: "luz-do-vale",
        responsavel: "teresa",
        proximaEmDias: 40,
        feitaEmDias: -325,
        ciclos: [{ proximaEmDias: -325, feitaEmDias: -325 }],
      },
    ],
  },
  produtos: [
    { codigo: "CABF-15-AZ", nome: "Cabo flexível 1,5 mm² azul · rolo 100 m", descricao: `Antichama, 750 V. ${POLITICA}`, marca: "Linha Modelo", categoria: "Fios e cabos", precoReais: 189.9, custoReais: 121.5, controlaEstoque: true, quantidade: 840 },
    { codigo: "CABF-25-AZ", nome: "Cabo flexível 2,5 mm² azul · rolo 100 m", descricao: `Antichama, 750 V. O mais vendido da linha. ${POLITICA}`, marca: "Linha Modelo", categoria: "Fios e cabos", precoReais: 289.9, custoReais: 185.5, controlaEstoque: true, quantidade: 1260 },
    { codigo: "CABF-25-PT", nome: "Cabo flexível 2,5 mm² preto · rolo 100 m", descricao: `Antichama, 750 V. ${POLITICA}`, marca: "Linha Modelo", categoria: "Fios e cabos", precoReais: 289.9, custoReais: 185.5, controlaEstoque: true, quantidade: 980 },
    { codigo: "CABF-40-PT", nome: "Cabo flexível 4 mm² preto · rolo 100 m", descricao: `Antichama, 750 V. ${POLITICA}`, marca: "Linha Modelo", categoria: "Fios e cabos", precoReais: 459, custoReais: 293.8, controlaEstoque: true, quantidade: 520 },
    { codigo: "CABF-60-VM", nome: "Cabo flexível 6 mm² vermelho · rolo 100 m", descricao: `Antichama, 750 V. ${POLITICA}`, marca: "Linha Modelo", categoria: "Fios e cabos", precoReais: 689, custoReais: 441, controlaEstoque: true, quantidade: 210 },
    { codigo: "CABPP-3X25", nome: "Cabo PP 3x2,5 mm² · rolo 50 m", descricao: `Para extensões e ligações de máquinas. ${POLITICA}`, marca: "Linha Modelo", categoria: "Fios e cabos", precoReais: 612, custoReais: 392, controlaEstoque: true, quantidade: 95 },
    { codigo: "DJ-1P-20A", nome: "Disjuntor monopolar 20 A curva C", descricao: `Caixa com 12 unidades no pedido de distribuidor. ${POLITICA}`, marca: "Linha Modelo", categoria: "Disjuntores e quadros", precoReais: 14.9, custoReais: 8.2, controlaEstoque: true, quantidade: 6400 },
    { codigo: "DJ-2P-40A", nome: "Disjuntor bipolar 40 A curva C", descricao: POLITICA, marca: "Linha Modelo", categoria: "Disjuntores e quadros", precoReais: 58, custoReais: 33.6, controlaEstoque: true, quantidade: 1900 },
    { codigo: "DJ-3P-63A", nome: "Disjuntor tripolar 63 A curva C", descricao: POLITICA, marca: "Linha Modelo", categoria: "Disjuntores e quadros", precoReais: 132, custoReais: 79, controlaEstoque: true, quantidade: 420 },
    { codigo: "DR-2P-40A", nome: "Interruptor diferencial residual 40 A 30 mA", descricao: `Proteção contra choque, obrigatório em áreas molhadas. ${POLITICA}`, marca: "Linha Modelo", categoria: "Disjuntores e quadros", precoReais: 189, custoReais: 112, controlaEstoque: true, quantidade: 640 },
    { codigo: "DPS-275V", nome: "Dispositivo de proteção contra surtos 275 V", descricao: POLITICA, marca: "Linha Modelo", categoria: "Disjuntores e quadros", precoReais: 49.9, custoReais: 27.4, controlaEstoque: true, quantidade: 880 },
    { codigo: "QD-12-EMB", nome: "Quadro de distribuição 12 disjuntores de embutir", descricao: POLITICA, marca: "Linha Modelo", categoria: "Disjuntores e quadros", precoReais: 96.5, custoReais: 55, controlaEstoque: true, quantidade: 730 },
    { codigo: "TOM-10A-BR", nome: "Tomada 2P+T 10 A branca com placa", descricao: `Caixa com 20 unidades. ${POLITICA}`, marca: "Linha Modelo", categoria: "Tomadas e interruptores", precoReais: 9.8, custoReais: 5.1, controlaEstoque: true, quantidade: 12500 },
    { codigo: "TOM-20A-BR", nome: "Tomada 2P+T 20 A branca com placa", descricao: `Caixa com 20 unidades. ${POLITICA}`, marca: "Linha Modelo", categoria: "Tomadas e interruptores", precoReais: 11.4, custoReais: 6, controlaEstoque: true, quantidade: 8300 },
    { codigo: "INT-1S-BR", nome: "Interruptor simples branco com placa", descricao: `Caixa com 20 unidades. ${POLITICA}`, marca: "Linha Modelo", categoria: "Tomadas e interruptores", precoReais: 8.9, custoReais: 4.6, controlaEstoque: true, quantidade: 9800 },
    { codigo: "LED-BUL-9W-CX10", nome: "Lâmpada LED bulbo 9 W 6500 K · caixa com 10", descricao: POLITICA, marca: "Linha Modelo", categoria: "Iluminação LED", precoReais: 79, custoReais: 44, controlaEstoque: true, quantidade: 3100 },
    { codigo: "LED-PAI-18W-QD", nome: "Painel LED de embutir 18 W quadrado", descricao: POLITICA, marca: "Linha Modelo", categoria: "Iluminação LED", precoReais: 42, custoReais: 23.5, controlaEstoque: true, quantidade: 1450 },
    { codigo: "LED-REF-50W", nome: "Refletor LED 50 W IP66", descricao: POLITICA, marca: "Linha Modelo", categoria: "Iluminação LED", precoReais: 119, custoReais: 68, controlaEstoque: true, quantidade: 560 },
    { codigo: "KIT-RES-QD", nome: "Kit quadro residencial (quadro, disjuntores, DR e DPS)", descricao: `Tudo para o quadro de uma casa de até 3 quartos. ${POLITICA}`, marca: "Linha Modelo", categoria: "Kits", precoReais: 690, custoReais: 402, controlaEstoque: true, quantidade: 140 },
  ],
};
