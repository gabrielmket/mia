/**
 * FORK MIA · CLIENTE MODELO — os dados fictícios da "Empresa Modelo · Demonstração",
 * a BANCADA de teste (`segmentos/bancada.ts`). As demonstrações por segmento
 * moram em `segmentos/`; a forma de uma semente, em `tipos.ts`.
 *
 * Tudo aqui é inventado e foi escrito para NUNCA bater em pessoa real:
 *
 *  - TELEFONE: `+55 00 9xxxx-xxxx`. O DDD 00 não existe no Brasil, então nenhum
 *    número daqui é de alguém. Passa no CHECK de E.164 do banco (`^\+\d{8,15}$`)
 *    e parece um celular na tela, que é o que a demonstração precisa.
 *  - E-MAIL: domínio `exemplo.invalid`. O TLD `.invalid` é reservado pela
 *    RFC 2606 justamente para isto: nenhum servidor de e-mail o aceita.
 *  - NOMES: combinações comuns de nome e sobrenome, sem CPF, sem CNPJ, sem
 *    endereço de verdade. Nenhum nome de cliente da Time Company.
 *
 * Os funis de clínica, imobiliária, serviços, cursos, loja e o geral saem dos
 * QUADROS PRONTOS do produto (`lib/onboarding/pacotes-de-funil.ts`), para a
 * demonstração mostrar exatamente o que um cliente novo recebe. Automotivo e
 * academia não têm quadro pronto no onboarding, mas têm modelos de follow-up
 * (`lib/followup/modelos/`), e a MIA atende os dois: os quadros deles moram
 * aqui, com os mesmos sete passos.
 */
import type { CustomFieldDef } from "@/lib/schemas/settings";

import type {
  ChaveDoFunil,
  CompromissoDaSemente,
  ContatoDaSemente,
  ConversaDaSemente,
  EmpresaDaSemente,
  FunilDaSemente,
  InscricaoDaSemente,
  MotivoDePerdaDaSemente,
  ObrigacaoDaSemente,
  PessoaDaEquipe,
  TarefaDaSemente,
} from "./tipos";

// Os tipos moram em tipos.ts desde as demonstrações por segmento; quem os
// importava daqui continua importando.
export type * from "./tipos";

export const NOME_DA_EMPRESA = "Empresa Modelo · Demonstração";
export const RAZAO_SOCIAL = "Empresa Modelo Demonstração (fictícia)";
export const SLUG_DA_EMPRESA = "empresa-modelo-demonstracao";
export const DOMINIO_FALSO = "exemplo.invalid";

/** O WhatsApp da demonstração: existe só para ancorar as conversas. Nasce ARQUIVADO. */
export const SESSAO_DO_CANAL = "demonstracao-empresa-modelo";
export const TELEFONE_DO_CANAL = "+5500900000000";

/** `+55 00 9 0000-0NNN` — ver o cabeçalho. */
export function telefoneFalso(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999) throw new Error(`telefoneFalso: ${n}`);
  return `+55009000${String(n).padStart(5, "0")}`;
}

export function emailFalso(nome: string): string {
  const local = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");
  return `${local}@${DOMINIO_FALSO}`;
}

// ─── A equipe ───────────────────────────────────────────────────────────────
//
// Pessoas fictícias, SEM senha: existem para serem donas de negócio, de
// tarefa e de compromisso. Ninguém entra no sistema com elas.

export const EQUIPE: readonly PessoaDaEquipe[] = [
  { chave: "helena", nome: "Helena Prado", papel: "manager", trilha: 1 },
  { chave: "otavio", nome: "Otávio Lins", papel: "agent", trilha: 2 },
  { chave: "beatriz", nome: "Beatriz Moura", papel: "agent", trilha: 3 },
  { chave: "caio", nome: "Caio Fontes", papel: "agent", trilha: 4 },
];

/** O agente de IA fictício. Nasce SEM versão publicada: não responde ninguém. */
export const AGENTE_DE_IA = {
  nome: "Sofia · Atendimento (demonstração)",
  descricao:
    "Agente de exemplo da empresa de demonstração. Não tem versão publicada e o canal está arquivado: não atende ninguém de verdade.",
  prompt:
    "Você é a Sofia, atendente da Empresa Modelo. Recebe quem chega pelo WhatsApp, entende o que a pessoa procura, qualifica (orçamento, quem decide, necessidade e prazo) e passa para o comercial quem está pronto. Fala de forma simples, cordial e objetiva.",
} as const;

// ─── Empresas (clientes B2B) ────────────────────────────────────────────────

export const EMPRESAS: readonly EmpresaDaSemente[] = [
  {
    chave: "aurora",
    nome: "Grupo Aurora Serviços",
    site: "https://aurora.exemplo.invalid",
    cidade: "Belo Horizonte",
    uf: "MG",
    setor: "Facilities",
    observacoes: "Decisão em comitê. Compras só fecha no fim do mês.",
    tags: ["b2b", "conta-chave"],
  },
  {
    chave: "vale-azul",
    nome: "Metalúrgica Vale Azul",
    site: null,
    cidade: "Contagem",
    uf: "MG",
    setor: "Indústria",
    observacoes: "Prefere reunião presencial na fábrica.",
    tags: ["b2b"],
  },
  {
    chave: "ponto-certo",
    nome: "Contabilidade Ponto Certo",
    site: "https://pontocerto.exemplo.invalid",
    cidade: "São Paulo",
    uf: "SP",
    setor: "Serviços contábeis",
    observacoes: null,
    tags: ["b2b", "indicacao"],
  },
  {
    chave: "bem-viver",
    nome: "Farmácias Bem Viver",
    site: "https://bemviver.exemplo.invalid",
    cidade: "Campinas",
    uf: "SP",
    setor: "Varejo",
    observacoes: "Rede com 6 lojas. Quem decide é a diretora de operações.",
    tags: ["b2b", "rede"],
  },
  {
    chave: "rota-sul",
    nome: "Transportadora Rota Sul",
    site: null,
    cidade: "Curitiba",
    uf: "PR",
    setor: "Logística",
    observacoes: null,
    tags: ["b2b"],
  },
];

// ─── Contatos ───────────────────────────────────────────────────────────────

export const CONTATOS: readonly ContatoDaSemente[] = [
  // Clientes de empresa (B2B) — várias pessoas por empresa.
  { chave: "marcia-aurora", nome: "Márcia Vilela", n: 1, comEmail: true, empresa: "aurora", cargo: "Diretora de operações", setor: "Operações", decisor: true },
  { chave: "joao-aurora", nome: "João Pedro Arantes", n: 2, comEmail: true, empresa: "aurora", cargo: "Comprador", setor: "Compras" },
  { chave: "luana-aurora", nome: "Luana Siqueira", n: 3, comEmail: false, empresa: "aurora", cargo: "Analista financeira", setor: "Financeiro" },
  { chave: "renato-vale", nome: "Renato Queiroz", n: 4, comEmail: true, empresa: "vale-azul", cargo: "Gerente industrial", setor: "Produção", decisor: true },
  { chave: "sonia-vale", nome: "Sônia Batista", n: 5, comEmail: true, empresa: "vale-azul", cargo: "Assistente administrativa", setor: "Administrativo" },
  { chave: "felipe-ponto", nome: "Felipe Andrade", n: 6, comEmail: true, empresa: "ponto-certo", cargo: "Sócio", setor: "Diretoria", decisor: true },
  { chave: "carolina-ponto", nome: "Carolina Reis", n: 7, comEmail: true, empresa: "ponto-certo", cargo: "Coordenadora", setor: "Fiscal" },
  { chave: "patricia-bem", nome: "Patrícia Moreira", n: 8, comEmail: true, empresa: "bem-viver", cargo: "Diretora de operações", setor: "Operações", decisor: true },
  { chave: "gustavo-bem", nome: "Gustavo Farias", n: 9, comEmail: true, empresa: "bem-viver", cargo: "Gerente de loja", setor: "Varejo" },
  { chave: "ivan-bem", nome: "Ivan Camargo", n: 10, comEmail: false, empresa: "bem-viver", cargo: "Supervisor de TI", setor: "Tecnologia" },
  { chave: "eduardo-rota", nome: "Eduardo Tavares", n: 11, comEmail: true, empresa: "rota-sul", cargo: "Diretor comercial", setor: "Comercial", decisor: true },
  { chave: "priscila-rota", nome: "Priscila Nogueira", n: 12, comEmail: true, empresa: "rota-sul", cargo: "Analista de frota", setor: "Operações" },
  // Pessoas físicas (B2C) — sem empresa.
  { chave: "marina", nome: "Marina Costa", n: 21, comEmail: true, tags: ["paciente"] },
  { chave: "rogerio", nome: "Rogério Paiva", n: 22, comEmail: false },
  { chave: "fernanda", nome: "Fernanda Lopes", n: 23, comEmail: true },
  { chave: "thiago", nome: "Thiago Brandão", n: 24, comEmail: true },
  { chave: "aline", nome: "Aline Figueiredo", n: 25, comEmail: false },
  { chave: "rodrigo", nome: "Rodrigo Pacheco", n: 26, comEmail: true },
  { chave: "juliana", nome: "Juliana Matos", n: 27, comEmail: true, tags: ["vip"] },
  { chave: "leandro", nome: "Leandro Cunha", n: 28, comEmail: false },
  { chave: "vanessa", nome: "Vanessa Rocha", n: 29, comEmail: true },
  { chave: "mauricio", nome: "Maurício Teles", n: 30, comEmail: true },
  { chave: "camila", nome: "Camila Duarte", n: 31, comEmail: true },
  { chave: "diego", nome: "Diego Albuquerque", n: 32, comEmail: false },
  { chave: "tatiane", nome: "Tatiane Freitas", n: 33, comEmail: true },
  { chave: "bruno", nome: "Bruno Carvalho", n: 34, comEmail: true },
  { chave: "larissa", nome: "Larissa Pimentel", n: 35, comEmail: false },
  { chave: "henrique", nome: "Henrique Salles", n: 36, comEmail: true },
  { chave: "natalia", nome: "Natália Guedes", n: 37, comEmail: true },
  { chave: "paulo", nome: "Paulo Sérgio Neves", n: 38, comEmail: false },
  { chave: "renata", nome: "Renata Bastos", n: 39, comEmail: true },
  { chave: "vinicius", nome: "Vinícius Coelho", n: 40, comEmail: true },
  { chave: "debora", nome: "Débora Antunes", n: 41, comEmail: true },
  { chave: "alexandre", nome: "Alexandre Pinho", n: 42, comEmail: false },
  { chave: "simone", nome: "Simone Barreto", n: 43, comEmail: true },
  { chave: "gabriela", nome: "Gabriela Toledo", n: 44, comEmail: true },
  { chave: "marcos", nome: "Marcos Vinícius Lima", n: 45, comEmail: false },
  { chave: "elaine", nome: "Elaine Cardoso", n: 46, comEmail: true },
  { chave: "fabio", nome: "Fábio Rezende", n: 47, comEmail: true },
  { chave: "isabela", nome: "Isabela Monteiro", n: 48, comEmail: true },
  { chave: "otavia", nome: "Otávia Ramos", n: 49, comEmail: false },
  { chave: "sergio", nome: "Sérgio Macedo", n: 50, comEmail: true },
  { chave: "yasmin", nome: "Yasmin Correia", n: 51, comEmail: true },
  { chave: "wagner", nome: "Wagner Assis", n: 52, comEmail: false },
  { chave: "cristiane", nome: "Cristiane Lacerda", n: 53, comEmail: true },
  { chave: "igor", nome: "Igor Menezes", n: 54, comEmail: true },
  { chave: "priscila", nome: "Priscila Amaral", n: 55, comEmail: true },
  { chave: "otto", nome: "Otto Fagundes", n: 56, comEmail: false },
  { chave: "lucia", nome: "Lúcia Helena Prates", n: 57, comEmail: true },
  { chave: "daniel", nome: "Daniel Esteves", n: 58, comEmail: true },
  { chave: "karina", nome: "Karina Valente", n: 59, comEmail: true },
  { chave: "roberto", nome: "Roberto Magalhães", n: 60, comEmail: false },
  { chave: "amanda", nome: "Amanda Quintela", n: 61, comEmail: true },
  { chave: "julio", nome: "Júlio César Fontana", n: 62, comEmail: true },
];

// ─── Funis por segmento ─────────────────────────────────────────────────────

const PERDAS_COMUNS: MotivoDePerdaDaSemente[] = [
  { label: "Preço acima do orçamento", categoria: "Nós" },
  { label: "Escolheu a concorrência", categoria: "Concorrência" },
  { label: "Parou de responder", categoria: "Ausência" },
  { label: "Desistiu da compra", categoria: "Cliente" },
  { label: "Fora do perfil que atendemos", categoria: "Mérito" },
];

const sel = (key: string, label: string, opcoes: string[]): CustomFieldDef => ({
  key,
  label,
  type: "select",
  options: opcoes.map((o) => ({ value: o, label: o })),
});

export const FUNIS: readonly FunilDaSemente[] = [
  {
    chave: "generico",
    nome: "Clientes · Geral",
    descricao: "O funil padrão da demonstração: serve para qualquer tipo de negócio.",
    pacote: "generico",
    nichoDeFollowup: "geral",
    vocabulario: { lead: "Cliente", lead_plural: "Clientes", deal: "Negócio", deal_plural: "Negócios", won: "Fechou", lost: "Não fechou" },
    campos: [
      { key: "necessidade", label: "O que o cliente precisa", type: "textarea" },
      { key: "orcamento_previsto", label: "Orçamento previsto (R$)", type: "number" },
      sel("prazo", "Prazo para decidir", ["Esta semana", "Este mês", "Sem pressa"]),
    ],
    motivosDePerda: PERDAS_COMUNS,
    motivosDeGanho: ["Melhor atendimento", "Preço", "Indicação"],
    vitoriaEReceita: true,
    negocios: [
      { titulo: "Rogério Paiva · orçamento de manutenção", passo: "new", contato: "rogerio", valorReais: 1800, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 0, naEtapaHaDias: 0, campos: { prazo: "Esta semana" } },
      { titulo: "Fernanda Lopes · pacote mensal", passo: "contacted", contato: "fernanda", valorReais: 2400, dono: "ia", origem: "google", criadoHaDias: 2, naEtapaHaDias: 1 },
      { titulo: "Thiago Brandão · plano anual", passo: "qualifying", contato: "thiago", valorReais: 9600, dono: "otavio", origem: "site", criadoHaDias: 5, naEtapaHaDias: 2, campos: { necessidade: "Quer atendimento para a família toda, quatro pessoas.", orcamento_previsto: 10000 }, proximaAcao: { titulo: "Ligar para entender quem decide", emDias: 1, prioridade: "high" } },
      { titulo: "Aline Figueiredo · proposta enviada", passo: "qualified", contato: "aline", valorReais: 5200, dono: "beatriz", origem: "indicacao", criadoHaDias: 9, naEtapaHaDias: 3, proximaAcao: { titulo: "Cobrar retorno da proposta", emDias: 2 } },
      { titulo: "Rodrigo Pacheco · negociando condições", passo: "negotiating", contato: "rodrigo", valorReais: 12500, dono: "helena", origem: "meta_formulario", criadoHaDias: 14, naEtapaHaDias: 4, proximaAcao: { titulo: "Enviar condição de pagamento em 6x", emDias: 0, prioridade: "urgent" } },
      { titulo: "Juliana Matos · contrato fechado", passo: "won", contato: "juliana", valorReais: 7800, dono: "otavio", origem: "indicacao", criadoHaDias: 21, naEtapaHaDias: 6, motivoDoGanho: "Indicação" },
      { titulo: "Leandro Cunha · não fechou", passo: "lost", contato: "leandro", valorReais: 3100, dono: "beatriz", origem: "google", criadoHaDias: 18, naEtapaHaDias: 8, motivoDaPerda: "Preço acima do orçamento" },
    ],
  },
  {
    chave: "clinica",
    nome: "Agendamentos · Clínica",
    descricao: "Vitrine do segmento saúde e estética: do primeiro contato à consulta marcada.",
    pacote: "clinica",
    nichoDeFollowup: "clinica",
    vocabulario: { lead: "Paciente", lead_plural: "Pacientes", deal: "Atendimento", deal_plural: "Atendimentos", won: "Consulta marcada", lost: "Não vai marcar" },
    campos: [
      sel("procedimento", "Procedimento de interesse", ["Clareamento", "Implante", "Ortodontia", "Harmonização", "Avaliação geral"]),
      sel("pagamento", "Forma de atendimento", ["Particular", "Convênio"]),
      { key: "primeira_consulta", label: "Primeira consulta", type: "boolean" },
    ],
    motivosDePerda: [
      { label: "Fechou com outra clínica", categoria: "Concorrência" },
      { label: "Sem condições no momento", categoria: "Cliente" },
      { label: "Não respondeu mais", categoria: "Ausência" },
      { label: "Procedimento que não fazemos", categoria: "Mérito" },
      { label: "Valor da avaliação", categoria: "Nós" },
    ],
    motivosDeGanho: ["Indicação de paciente", "Horário que serviu", "Confiança na equipe"],
    vitoriaEReceita: true,
    negocios: [
      { titulo: "Marina Costa · clareamento", passo: "qualified", contato: "marina", valorReais: 1800, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 1, naEtapaHaDias: 0, campos: { procedimento: "Clareamento", pagamento: "Particular", primeira_consulta: true }, tags: ["clareamento"] },
      { titulo: "Vanessa Rocha · avaliação", passo: "new", contato: "vanessa", valorReais: null, dono: "ia", origem: "meta_formulario", criadoHaDias: 0, naEtapaHaDias: 0, campos: { procedimento: "Avaliação geral" } },
      { titulo: "Maurício Teles · implante", passo: "contacted", contato: "mauricio", valorReais: 4500, dono: "ia", origem: "google", criadoHaDias: 3, naEtapaHaDias: 2, campos: { procedimento: "Implante", pagamento: "Particular" } },
      { titulo: "Camila Duarte · ortodontia", passo: "qualifying", contato: "camila", valorReais: 6200, dono: "caio", origem: "site", criadoHaDias: 6, naEtapaHaDias: 1, campos: { procedimento: "Ortodontia", pagamento: "Convênio", primeira_consulta: true }, proximaAcao: { titulo: "Oferecer horários de quinta e sexta", emDias: 0, prioridade: "high" } },
      { titulo: "Diego Albuquerque · harmonização", passo: "negotiating", contato: "diego", valorReais: 2900, dono: "caio", origem: "meta_formulario", criadoHaDias: 8, naEtapaHaDias: 2, campos: { procedimento: "Harmonização" }, proximaAcao: { titulo: "Confirmar horário escolhido", emDias: 1 } },
      { titulo: "Tatiane Freitas · consulta marcada", passo: "won", contato: "tatiane", valorReais: 350, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 12, naEtapaHaDias: 5, campos: { procedimento: "Avaliação geral", primeira_consulta: true }, motivoDoGanho: "Horário que serviu" },
      { titulo: "Bruno Carvalho · implante", passo: "lost", contato: "bruno", valorReais: 5400, dono: "caio", origem: "google", criadoHaDias: 20, naEtapaHaDias: 10, campos: { procedimento: "Implante" }, motivoDaPerda: "Fechou com outra clínica" },
    ],
  },
  {
    chave: "imobiliaria",
    nome: "Interessados · Imobiliária",
    descricao: "Vitrine do segmento imobiliário: do interessado à assinatura.",
    pacote: "imobiliaria",
    nichoDeFollowup: "imobiliario",
    vocabulario: { lead: "Interessado", lead_plural: "Interessados", deal: "Negociação", deal_plural: "Negociações", won: "Fechou negócio", lost: "Desistiu" },
    campos: [
      sel("tipo_de_imovel", "Tipo de imóvel", ["Apartamento", "Casa", "Terreno", "Sala comercial"]),
      sel("faixa_de_preco", "Faixa de preço", ["Até R$ 300 mil", "R$ 300 a 600 mil", "Acima de R$ 600 mil"]),
      { key: "bairro", label: "Bairro de interesse", type: "text" },
      { key: "financiamento", label: "Vai financiar", type: "boolean" },
    ],
    motivosDePerda: [
      { label: "Comprou com outra imobiliária", categoria: "Concorrência" },
      { label: "Crédito não aprovado", categoria: "Cliente" },
      { label: "Não encontrou o imóvel certo", categoria: "Mérito" },
      { label: "Parou de responder", categoria: "Ausência" },
    ],
    motivosDeGanho: ["Imóvel certo", "Condição de pagamento", "Atendimento do corretor"],
    vitoriaEReceita: true,
    negocios: [
      { titulo: "Larissa Pimentel · apartamento 2 quartos", passo: "contacted", contato: "larissa", valorReais: 420000, dono: "ia", origem: "meta_formulario", criadoHaDias: 0, naEtapaHaDias: 0, campos: { tipo_de_imovel: "Apartamento", faixa_de_preco: "R$ 300 a 600 mil" }, tags: ["Meta_ads", "Formulario_Meta"] },
      { titulo: "Henrique Salles · casa com quintal", passo: "new", contato: "henrique", valorReais: 690000, dono: "ia", origem: "google", criadoHaDias: 2, naEtapaHaDias: 1, campos: { tipo_de_imovel: "Casa", faixa_de_preco: "Acima de R$ 600 mil", financiamento: true } },
      { titulo: "Natália Guedes · apartamento perto do metrô", passo: "qualified", contato: "natalia", valorReais: 380000, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 4, naEtapaHaDias: 1, campos: { tipo_de_imovel: "Apartamento", bairro: "Centro", financiamento: true } },
      { titulo: "Paulo Sérgio Neves · terreno", passo: "qualifying", contato: "paulo", valorReais: 210000, dono: "otavio", origem: "site", criadoHaDias: 7, naEtapaHaDias: 2, campos: { tipo_de_imovel: "Terreno", faixa_de_preco: "Até R$ 300 mil" }, proximaAcao: { titulo: "Separar três terrenos para apresentar", emDias: 1 } },
      { titulo: "Renata Bastos · visita agendada", passo: "negotiating", contato: "renata", valorReais: 540000, dono: "otavio", origem: "indicacao", criadoHaDias: 11, naEtapaHaDias: 3, campos: { tipo_de_imovel: "Apartamento", bairro: "Jardim América", financiamento: true }, proximaAcao: { titulo: "Levar a simulação de financiamento na visita", emDias: 2, prioridade: "high" } },
      { titulo: "Vinícius Coelho · sala comercial", passo: "won", contato: "vinicius", valorReais: 310000, dono: "otavio", origem: "google", criadoHaDias: 30, naEtapaHaDias: 7, campos: { tipo_de_imovel: "Sala comercial" }, motivoDoGanho: "Condição de pagamento" },
      { titulo: "Débora Antunes · desistiu", passo: "lost", contato: "debora", valorReais: 450000, dono: "otavio", origem: "meta_formulario", criadoHaDias: 25, naEtapaHaDias: 9, motivoDaPerda: "Crédito não aprovado" },
    ],
  },
  {
    chave: "servicos",
    nome: "Orçamentos · Serviços B2B",
    descricao: "Vitrine de serviços para empresas: do pedido ao contrato, com várias pessoas por empresa.",
    pacote: "servicos",
    nichoDeFollowup: "servicos_b2b",
    vocabulario: { lead: "Cliente", lead_plural: "Clientes", deal: "Orçamento", deal_plural: "Orçamentos", won: "Fechou", lost: "Não fechou" },
    campos: [
      { key: "tipo_de_projeto", label: "Tipo de projeto", type: "text" },
      { key: "funcionarios", label: "Número de funcionários", type: "number" },
      { key: "inicio_desejado", label: "Início desejado", type: "date" },
      sel("contrato", "Tipo de contrato", ["Mensal", "Projeto fechado"]),
    ],
    motivosDePerda: [
      { label: "Orçamento congelado pelo cliente", categoria: "Cliente" },
      { label: "Fornecedor atual renovou", categoria: "Concorrência" },
      { label: "Escopo fora do que fazemos", categoria: "Mérito" },
      { label: "Preço acima do orçamento", categoria: "Nós" },
    ],
    motivosDeGanho: ["Diagnóstico convenceu", "Prazo de implantação", "Indicação"],
    vitoriaEReceita: true,
    negocios: [
      { titulo: "Grupo Aurora · limpeza das 3 unidades", passo: "new", contato: "joao-aurora", valorReais: 18000, dono: "ia", origem: "site", criadoHaDias: 0, naEtapaHaDias: 0, campos: { tipo_de_projeto: "Limpeza e conservação", funcionarios: 240, contrato: "Mensal" } },
      { titulo: "Metalúrgica Vale Azul · manutenção preventiva", passo: "contacted", contato: "sonia-vale", valorReais: 26000, dono: "beatriz", origem: "google", criadoHaDias: 3, naEtapaHaDias: 2, campos: { tipo_de_projeto: "Manutenção preventiva", funcionarios: 85 } },
      { titulo: "Contabilidade Ponto Certo · treinamento da equipe", passo: "qualifying", contato: "carolina-ponto", valorReais: 9500, dono: "beatriz", origem: "indicacao", criadoHaDias: 6, naEtapaHaDias: 3, campos: { tipo_de_projeto: "Treinamento", funcionarios: 32, contrato: "Projeto fechado" }, proximaAcao: { titulo: "Marcar diagnóstico com o sócio", emDias: 2 } },
      { titulo: "Farmácias Bem Viver · implantação nas 6 lojas", passo: "qualified", contato: "patricia-bem", valorReais: 64000, dono: "helena", origem: "meta_formulario", criadoHaDias: 10, naEtapaHaDias: 2, campos: { tipo_de_projeto: "Implantação em rede", funcionarios: 120, contrato: "Projeto fechado" }, proximaAcao: { titulo: "Apresentar proposta para a diretoria", emDias: 3, prioridade: "high" } },
      { titulo: "Transportadora Rota Sul · gestão de frota", passo: "negotiating", contato: "eduardo-rota", valorReais: 42000, dono: "helena", origem: "indicacao", criadoHaDias: 16, naEtapaHaDias: 5, campos: { tipo_de_projeto: "Gestão de frota", funcionarios: 310, contrato: "Mensal" }, proximaAcao: { titulo: "Revisar cláusula de reajuste com o jurídico deles", emDias: 1, prioridade: "urgent" } },
      { titulo: "Grupo Aurora · consultoria de processos", passo: "won", contato: "marcia-aurora", valorReais: 36000, dono: "helena", origem: "indicacao", criadoHaDias: 40, naEtapaHaDias: 12, campos: { tipo_de_projeto: "Consultoria", contrato: "Projeto fechado" }, motivoDoGanho: "Diagnóstico convenceu" },
      { titulo: "Metalúrgica Vale Azul · software de ponto", passo: "lost", contato: "renato-vale", valorReais: 15000, dono: "beatriz", origem: "google", criadoHaDias: 35, naEtapaHaDias: 14, motivoDaPerda: "Fornecedor atual renovou" },
    ],
  },
  {
    chave: "curso",
    nome: "Matrículas · Cursos",
    descricao: "Vitrine de cursos, mentorias e infoprodutos.",
    pacote: "curso",
    nichoDeFollowup: null,
    vocabulario: { lead: "Aluno", lead_plural: "Alunos", deal: "Matrícula", deal_plural: "Matrículas", won: "Matriculado", lost: "Desistiu" },
    campos: [
      sel("curso", "Curso de interesse", ["Excel para negócios", "Gestão financeira", "Vendas pelo WhatsApp"]),
      sel("turma", "Turma", ["Manhã", "Noite", "Online"]),
      sel("pagamento", "Forma de pagamento", ["Pix", "Cartão em 12x", "Boleto"]),
    ],
    motivosDePerda: PERDAS_COMUNS,
    motivosDeGanho: ["Conteúdo", "Condição de pagamento", "Indicação de aluno"],
    vitoriaEReceita: true,
    negocios: [
      { titulo: "Simone Barreto · Excel para negócios", passo: "new", contato: "simone", valorReais: 890, dono: "ia", origem: "meta_formulario", criadoHaDias: 0, naEtapaHaDias: 0, campos: { curso: "Excel para negócios" } },
      { titulo: "Gabriela Toledo · Gestão financeira", passo: "contacted", contato: "gabriela", valorReais: 1490, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 1, naEtapaHaDias: 1, campos: { curso: "Gestão financeira", turma: "Noite" } },
      { titulo: "Marcos Vinícius Lima · Vendas pelo WhatsApp", passo: "qualifying", contato: "marcos", valorReais: 690, dono: "ia", origem: "google", criadoHaDias: 3, naEtapaHaDias: 1, campos: { curso: "Vendas pelo WhatsApp", turma: "Online" } },
      { titulo: "Elaine Cardoso · Gestão financeira", passo: "negotiating", contato: "elaine", valorReais: 1490, dono: "caio", origem: "site", criadoHaDias: 5, naEtapaHaDias: 2, campos: { curso: "Gestão financeira", turma: "Manhã", pagamento: "Cartão em 12x" }, proximaAcao: { titulo: "Enviar link de pagamento", emDias: 0 } },
      { titulo: "Fábio Rezende · Excel para negócios", passo: "qualified", contato: "fabio", valorReais: 890, dono: "caio", origem: "indicacao", criadoHaDias: 7, naEtapaHaDias: 2, campos: { curso: "Excel para negócios", pagamento: "Boleto" }, proximaAcao: { titulo: "Confirmar desconto de indicação", emDias: 1 } },
      { titulo: "Isabela Monteiro · matriculada", passo: "won", contato: "isabela", valorReais: 1490, dono: "ia", origem: "meta_formulario", criadoHaDias: 14, naEtapaHaDias: 6, campos: { curso: "Gestão financeira", turma: "Online", pagamento: "Pix" }, motivoDoGanho: "Conteúdo" },
      { titulo: "Otávia Ramos · desistiu", passo: "lost", contato: "otavia", valorReais: 690, dono: "caio", origem: "google", criadoHaDias: 19, naEtapaHaDias: 9, motivoDaPerda: "Parou de responder" },
    ],
  },
  {
    chave: "loja",
    nome: "Vendas · Loja",
    descricao: "Vitrine de loja online ou de rua.",
    pacote: "loja",
    nichoDeFollowup: null,
    vocabulario: { lead: "Cliente", lead_plural: "Clientes", deal: "Pedido", deal_plural: "Pedidos", won: "Pedido pago", lost: "Não comprou" },
    campos: [
      { key: "produto", label: "Produto de interesse", type: "text" },
      sel("canal_de_compra", "Onde vai comprar", ["Loja física", "Online"]),
      { key: "cupom", label: "Cupom", type: "text" },
    ],
    motivosDePerda: PERDAS_COMUNS,
    motivosDeGanho: ["Preço", "Entrega rápida", "Atendimento"],
    vitoriaEReceita: true,
    negocios: [
      { titulo: "Sérgio Macedo · cadeira de escritório", passo: "new", contato: "sergio", valorReais: 1290, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 0, naEtapaHaDias: 0, campos: { produto: "Cadeira ergonômica", canal_de_compra: "Online" } },
      { titulo: "Yasmin Correia · kit presente", passo: "contacted", contato: "yasmin", valorReais: 240, dono: "ia", origem: "google", criadoHaDias: 1, naEtapaHaDias: 1, campos: { produto: "Kit presente" } },
      { titulo: "Wagner Assis · mesa de jantar", passo: "qualifying", contato: "wagner", valorReais: 3400, dono: "ia", origem: "site", criadoHaDias: 2, naEtapaHaDias: 1, campos: { produto: "Mesa de jantar 6 lugares", canal_de_compra: "Loja física" } },
      { titulo: "Cristiane Lacerda · sofá retrátil", passo: "qualified", contato: "cristiane", valorReais: 4800, dono: "otavio", origem: "meta_formulario", criadoHaDias: 4, naEtapaHaDias: 1, campos: { produto: "Sofá retrátil", cupom: "PRIMEIRACOMPRA" }, proximaAcao: { titulo: "Confirmar prazo de entrega", emDias: 0 } },
      { titulo: "Igor Menezes · aguardando pagamento", passo: "negotiating", contato: "igor", valorReais: 2150, dono: "otavio", origem: "meta_clique_whatsapp", criadoHaDias: 5, naEtapaHaDias: 1, campos: { produto: "Estante modular", canal_de_compra: "Online" }, proximaAcao: { titulo: "Reenviar link do Pix", emDias: 0, prioridade: "high" } },
      { titulo: "Priscila Amaral · pedido pago", passo: "won", contato: "priscila", valorReais: 890, dono: "ia", origem: "google", criadoHaDias: 9, naEtapaHaDias: 3, campos: { produto: "Luminária de piso" }, motivoDoGanho: "Entrega rápida" },
      { titulo: "Otto Fagundes · não comprou", passo: "lost", contato: "otto", valorReais: 5600, dono: "otavio", origem: "site", criadoHaDias: 15, naEtapaHaDias: 6, motivoDaPerda: "Escolheu a concorrência" },
    ],
  },
  {
    chave: "automotivo",
    nome: "Veículos · Automotivo",
    descricao: "Vitrine de loja de veículos: do anúncio ao test drive e à venda.",
    etapas: [
      { chave: "new", nome: "Novo interessado", passo: "new" },
      { chave: "contacted", nome: "Já respondi", passo: "contacted" },
      { chave: "qualifying", nome: "Entendendo o que procura", passo: "qualifying" },
      { chave: "qualified", nome: "Test drive marcado", passo: "qualified" },
      { chave: "negotiating", nome: "Negociando", passo: "negotiating" },
      { chave: "won", nome: "Vendido", passo: "won", fim: "won" },
      { chave: "lost", nome: "Não comprou", passo: "lost", fim: "lost" },
    ],
    nichoDeFollowup: "automotivo",
    vocabulario: { lead: "Interessado", lead_plural: "Interessados", deal: "Negociação", deal_plural: "Negociações", won: "Vendido", lost: "Não comprou" },
    campos: [
      { key: "veiculo", label: "Veículo de interesse", type: "text" },
      { key: "tem_troca", label: "Tem carro na troca", type: "boolean" },
      sel("pagamento", "Pagamento", ["À vista", "Financiado", "Consórcio"]),
    ],
    motivosDePerda: [
      { label: "Financiamento recusado", categoria: "Cliente" },
      { label: "Comprou em outra loja", categoria: "Concorrência" },
      { label: "Avaliação da troca baixa", categoria: "Nós" },
      { label: "Parou de responder", categoria: "Ausência" },
    ],
    motivosDeGanho: ["Avaliação da troca", "Condição do financiamento", "Test drive"],
    vitoriaEReceita: true,
    negocios: [
      { titulo: "Lúcia Helena Prates · SUV seminovo", passo: "new", contato: "lucia", valorReais: 98000, dono: "ia", origem: "meta_formulario", criadoHaDias: 0, naEtapaHaDias: 0, campos: { veiculo: "SUV compacto 2023" } },
      { titulo: "Wagner Assis · picape para o trabalho", passo: "contacted", contato: "wagner", valorReais: 135000, dono: "ia", origem: "google", criadoHaDias: 1, naEtapaHaDias: 1, campos: { veiculo: "Picape média 2022", pagamento: "Consórcio" } },
      { titulo: "Daniel Esteves · hatch automático", passo: "qualifying", contato: "daniel", valorReais: 72000, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 2, naEtapaHaDias: 1, campos: { veiculo: "Hatch automático 2022", tem_troca: true, pagamento: "Financiado" } },
      { titulo: "Karina Valente · test drive sábado", passo: "qualified", contato: "karina", valorReais: 115000, dono: "caio", origem: "google", criadoHaDias: 4, naEtapaHaDias: 1, campos: { veiculo: "Sedã 2024", pagamento: "À vista" }, proximaAcao: { titulo: "Deixar o carro lavado para o test drive", emDias: 2 } },
      { titulo: "Roberto Magalhães · picape", passo: "negotiating", contato: "roberto", valorReais: 164000, dono: "caio", origem: "indicacao", criadoHaDias: 8, naEtapaHaDias: 3, campos: { veiculo: "Picape cabine dupla", tem_troca: true, pagamento: "Financiado" }, proximaAcao: { titulo: "Retornar com a avaliação da troca", emDias: 1, prioridade: "high" } },
      { titulo: "Amanda Quintela · vendido", passo: "won", contato: "amanda", valorReais: 68000, dono: "caio", origem: "meta_clique_whatsapp", criadoHaDias: 16, naEtapaHaDias: 5, campos: { veiculo: "Hatch 2021", pagamento: "Financiado" }, motivoDoGanho: "Condição do financiamento" },
      { titulo: "Júlio César Fontana · não comprou", passo: "lost", contato: "julio", valorReais: 89000, dono: "caio", origem: "google", criadoHaDias: 22, naEtapaHaDias: 11, motivoDaPerda: "Financiamento recusado" },
    ],
  },
  {
    chave: "academia",
    nome: "Planos · Academia",
    descricao: "Vitrine de academia e bem-estar: da aula experimental à matrícula.",
    etapas: [
      { chave: "new", nome: "Novo contato", passo: "new" },
      { chave: "contacted", nome: "Já respondi", passo: "contacted" },
      { chave: "qualifying", nome: "Entendendo o objetivo", passo: "qualifying" },
      { chave: "qualified", nome: "Aula experimental marcada", passo: "qualified" },
      { chave: "negotiating", nome: "Escolhendo o plano", passo: "negotiating" },
      { chave: "won", nome: "Matriculado", passo: "won", fim: "won" },
      { chave: "lost", nome: "Não se matriculou", passo: "lost", fim: "lost" },
    ],
    nichoDeFollowup: "academia",
    vocabulario: { lead: "Aluno", lead_plural: "Alunos", deal: "Matrícula", deal_plural: "Matrículas", won: "Matriculado", lost: "Não se matriculou" },
    campos: [
      sel("objetivo", "Objetivo", ["Emagrecer", "Ganhar massa", "Condicionamento", "Reabilitação"]),
      sel("plano", "Plano de interesse", ["Mensal", "Trimestral", "Anual"]),
      sel("horario", "Horário preferido", ["Manhã", "Almoço", "Noite"]),
    ],
    motivosDePerda: [
      { label: "Achou caro", categoria: "Nós" },
      { label: "Matriculou em outra academia", categoria: "Concorrência" },
      { label: "Mudou de bairro", categoria: "Cliente" },
      { label: "Parou de responder", categoria: "Ausência" },
    ],
    motivosDeGanho: ["Aula experimental", "Plano anual com desconto", "Horário"],
    vitoriaEReceita: true,
    negocios: [
      { titulo: "Fernanda Lopes · plano anual", passo: "new", contato: "fernanda", valorReais: 1188, dono: "ia", origem: "meta_formulario", criadoHaDias: 0, naEtapaHaDias: 0, campos: { objetivo: "Condicionamento", plano: "Anual" } },
      { titulo: "Thiago Brandão · aula experimental", passo: "qualified", contato: "thiago", valorReais: 149, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 2, naEtapaHaDias: 1, campos: { objetivo: "Ganhar massa", horario: "Noite" }, proximaAcao: { titulo: "Lembrar da aula experimental amanhã", emDias: 1 } },
      { titulo: "Camila Duarte · escolhendo plano", passo: "negotiating", contato: "camila", valorReais: 447, dono: "beatriz", origem: "site", criadoHaDias: 5, naEtapaHaDias: 2, campos: { objetivo: "Emagrecer", plano: "Trimestral", horario: "Manhã" }, proximaAcao: { titulo: "Mandar a comparação dos planos", emDias: 0 } },
      { titulo: "Vanessa Rocha · matriculada", passo: "won", contato: "vanessa", valorReais: 1188, dono: "beatriz", origem: "indicacao", criadoHaDias: 12, naEtapaHaDias: 4, campos: { objetivo: "Condicionamento", plano: "Anual" }, motivoDoGanho: "Plano anual com desconto" },
      { titulo: "Rodrigo Pacheco · não se matriculou", passo: "lost", contato: "rodrigo", valorReais: 149, dono: "beatriz", origem: "google", criadoHaDias: 17, naEtapaHaDias: 8, motivoDaPerda: "Achou caro" },
      { titulo: "Maurício Teles · objetivo", passo: "contacted", contato: "mauricio", valorReais: null, dono: "ia", origem: "meta_clique_whatsapp", criadoHaDias: 1, naEtapaHaDias: 1, campos: { objetivo: "Reabilitação" } },
      { titulo: "Diego Albuquerque · entendendo objetivo", passo: "qualifying", contato: "diego", valorReais: 149, dono: "ia", origem: "google", criadoHaDias: 2, naEtapaHaDias: 1, campos: { objetivo: "Ganhar massa" } },
    ],
  },
  {
    chave: "comercial",
    nome: "Comercial",
    descricao:
      "Para onde a IA passa quem já está qualificado (passagem para o comercial). Aqui o time fecha.",
    etapas: [
      { chave: "recebido", nome: "Recebido da IA", passo: null },
      { chave: "primeiro-contato", nome: "Primeiro contato do vendedor", passo: null },
      { chave: "proposta", nome: "Proposta enviada", passo: null },
      { chave: "negociacao", nome: "Negociação", passo: null },
      { chave: "ganho", nome: "Ganho", passo: null, fim: "won" },
      { chave: "perdido", nome: "Perdido", passo: null, fim: "lost" },
    ],
    nichoDeFollowup: null,
    vocabulario: { lead: "Cliente", lead_plural: "Clientes", deal: "Oportunidade", deal_plural: "Oportunidades", won: "Ganho", lost: "Perdido" },
    campos: [
      sel("produto", "Produto", ["Plano essencial", "Plano completo", "Projeto sob medida"]),
      { key: "decisor", label: "Quem decide", type: "text" },
      { key: "prazo_de_decisao", label: "Prazo de decisão", type: "date" },
    ],
    motivosDePerda: PERDAS_COMUNS,
    motivosDeGanho: ["Qualificação da IA", "Proposta", "Relacionamento"],
    vitoriaEReceita: true,
    negocios: [
      { titulo: "Marina Costa · clareamento (da IA)", passo: "recebido", contato: "marina", valorReais: 1800, dono: "caio", origem: "meta_clique_whatsapp", criadoHaDias: 0, naEtapaHaDias: 0, campos: { produto: "Plano essencial", decisor: "A própria cliente" }, proximaAcao: { titulo: "Ligar hoje para a Marina: ela pediu horário à tarde", emDias: 0, prioridade: "urgent" } },
      { titulo: "Farmácias Bem Viver · implantação (da IA)", passo: "primeiro-contato", contato: "patricia-bem", valorReais: 64000, dono: "helena", origem: "meta_formulario", criadoHaDias: 3, naEtapaHaDias: 1, campos: { produto: "Projeto sob medida", decisor: "Patrícia Moreira, diretora de operações" }, proximaAcao: { titulo: "Reunião de diagnóstico com a Patrícia", emDias: 2, prioridade: "high" } },
      { titulo: "Natália Guedes · apartamento (da IA)", passo: "proposta", contato: "natalia", valorReais: 380000, dono: "otavio", origem: "meta_clique_whatsapp", criadoHaDias: 4, naEtapaHaDias: 1, campos: { produto: "Plano completo" } },
      { titulo: "Transportadora Rota Sul · frota (da IA)", passo: "negociacao", contato: "eduardo-rota", valorReais: 42000, dono: "helena", origem: "indicacao", criadoHaDias: 9, naEtapaHaDias: 3, campos: { produto: "Projeto sob medida", decisor: "Eduardo Tavares" } },
      { titulo: "Juliana Matos · plano completo", passo: "ganho", contato: "juliana", valorReais: 7800, dono: "otavio", origem: "indicacao", criadoHaDias: 20, naEtapaHaDias: 5, campos: { produto: "Plano completo" }, motivoDoGanho: "Qualificação da IA" },
      { titulo: "Leandro Cunha · plano essencial", passo: "perdido", contato: "leandro", valorReais: 3100, dono: "beatriz", origem: "google", criadoHaDias: 16, naEtapaHaDias: 7, motivoDaPerda: "Parou de responder" },
    ],
  },
];

// ─── Conversas com a IA ─────────────────────────────────────────────────────

/**
 * Status de ciclo de vida GRAVADO nas conversas da demonstração. Escrever o
 * status segue permitido; o que a cerca `fila-tem-uma-definicao-so` proíbe é
 * DECIDIR quem atende por ele, e aqui nada decide nada: é só o dado semeado.
 */
const CONVERSA_COM_A_IA = "ai_handling" as const;

export const CONVERSAS: readonly ConversaDaSemente[] = [
  {
    chave: "marina",
    contato: "marina",
    comecouHaDias: 1,
    passo: "qualified",
    qualificacao: {
      budget: "Até R$ 2 mil, pode parcelar",
      authority: "Decide sozinha",
      need: "Clareamento antes do casamento da irmã",
      timeline: "Quer fazer nas próximas 3 semanas",
    },
    proximaAcao: "Comercial liga à tarde para marcar a avaliação",
    ficha: {
      headline: "Clareamento · decide sozinha · até R$ 2 mil · 3 semanas",
      body:
        "Marina quer clarear os dentes antes do casamento da irmã, daqui a um mês. Nunca fez clareamento. Orçamento de até R$ 2 mil, prefere parcelar no cartão. Pode à tarde, depois das 15h. Veio pelo anúncio do Instagram.",
    },
    passagem: {
      titulo: "Marina quer marcar avaliação de clareamento",
      resumo:
        "Qualificada pela IA: clareamento, até R$ 2 mil parcelado, decide sozinha, quer fazer em até 3 semanas. Pediu para ser chamada à tarde.",
      ultimaFala: "Pode ser à tarde? Depois das 15h eu consigo falar.",
      reconhecidaPor: "caio",
    },
    com: "caio",
    status: "claimed",
    etiquetas: ["Meta_ads", "clareamento"],
    mensagens: [
      { de: "cliente", texto: "Oi! Vi o anúncio de vocês no Instagram. Vocês fazem clareamento?", min: 0 },
      { de: "ia", texto: "Oi, Marina! Fazemos sim 😊 Sou a Sofia, do atendimento. Você já fez clareamento alguma vez ou seria a primeira?", min: 1 },
      { de: "cliente", texto: "Seria a primeira. É pro casamento da minha irmã, daqui um mês.", min: 4 },
      { de: "ia", texto: "Que ótimo motivo! Dá tempo tranquilo. O primeiro passo é uma avaliação rápida com a dentista. Você tem uma ideia de quanto quer investir?", min: 5 },
      { de: "cliente", texto: "Até uns 2 mil, se der pra parcelar no cartão.", min: 9 },
      { de: "ia", texto: "Dá para parcelar, sim. Vou passar seu contato para a nossa equipe marcar a avaliação no melhor horário para você. Tem algum período que prefere?", min: 10 },
      { de: "cliente", texto: "Pode ser à tarde? Depois das 15h eu consigo falar.", min: 14 },
      { de: "ia", texto: "Combinado! O Caio, da nossa equipe, vai te chamar à tarde para marcar. Qualquer dúvida é só escrever aqui.", min: 15 },
      { de: "equipe", texto: "Oi, Marina! Aqui é o Caio. Tenho quinta às 16h ou sexta às 15h30 para a avaliação. Qual fica melhor?", min: 300 },
    ],
  },
  {
    chave: "natalia",
    contato: "natalia",
    comecouHaDias: 4,
    passo: "qualified",
    qualificacao: {
      budget: "Até R$ 400 mil com financiamento",
      authority: "Decide com o marido",
      need: "Apartamento de 2 quartos perto do metrô",
      timeline: "Quer mudar até o fim do ano",
    },
    proximaAcao: "Corretor apresenta 3 opções perto do metrô",
    ficha: {
      headline: "Apto 2 quartos · perto do metrô · até R$ 400 mil · financia",
      body:
        "Natália procura apartamento de 2 quartos perto do metrô, para morar com o marido. Vai financiar, já tem carta de crédito pré-aprovada. Teto de R$ 400 mil. Quer mudar até dezembro. Decide junto com o marido, que precisa ver o imóvel.",
    },
    passagem: {
      titulo: "Natália pronta para ver apartamentos",
      resumo: "Financiamento pré-aprovado, teto R$ 400 mil, 2 quartos perto do metrô. Decide com o marido.",
      ultimaFala: "A gente pode ver no sábado de manhã?",
      reconhecidaPor: "otavio",
    },
    com: "otavio",
    status: "claimed",
    etiquetas: ["Meta_ads"],
    mensagens: [
      { de: "cliente", texto: "Boa tarde, tem apartamento de 2 quartos perto do metrô?", min: 0 },
      { de: "ia", texto: "Boa tarde, Natália! Temos algumas opções. Para eu separar as certas: você pretende financiar ou comprar à vista?", min: 1 },
      { de: "cliente", texto: "Financiar. Já tenho carta pré-aprovada até 400 mil.", min: 6 },
      { de: "ia", texto: "Perfeito, isso ajuda muito. Vai morar sozinha ou com mais alguém? E tem prazo para a mudança?", min: 7 },
      { de: "cliente", texto: "Com meu marido. Queria mudar até o fim do ano.", min: 12 },
      { de: "ia", texto: "Entendi. Vou pedir para o Otávio, nosso corretor, separar as opções e combinar uma visita com vocês dois.", min: 13 },
      { de: "cliente", texto: "A gente pode ver no sábado de manhã?", min: 20 },
      { de: "equipe", texto: "Oi, Natália, aqui é o Otávio! Sábado às 10h fica bom? Separei três apartamentos a até 5 minutos do metrô.", min: 95 },
      { de: "cliente", texto: "Fica ótimo, obrigada!", min: 110 },
    ],
  },
  {
    chave: "patricia",
    contato: "patricia-bem",
    comecouHaDias: 3,
    passo: "qualified",
    qualificacao: {
      budget: "Verba aprovada para o semestre",
      authority: "Diretora de operações, decide com o financeiro",
      need: "Implantação nas 6 lojas da rede",
      timeline: "Começar no próximo mês",
    },
    proximaAcao: "Reunião de diagnóstico com a diretoria",
    ficha: {
      headline: "Rede com 6 lojas · diretora decide · começar mês que vem",
      body:
        "Patrícia é diretora de operações das Farmácias Bem Viver, rede com 6 lojas. Quer implantar nas 6 de uma vez. Tem verba aprovada para o semestre. Decide com o financeiro. Pediu reunião com a diretoria para a semana que vem.",
    },
    passagem: {
      titulo: "Rede de farmácias quer reunião de diagnóstico",
      resumo: "B2B, 6 lojas, verba aprovada, quer começar no próximo mês. Pediu reunião com a diretoria.",
      ultimaFala: "Consigo reunir o financeiro na terça. Pode ser?",
    },
    com: "helena",
    status: "open",
    etiquetas: ["b2b", "Formulario_Meta"],
    mensagens: [
      { de: "ia", texto: "Olá, Patrícia! Aqui é a Sofia, da Empresa Modelo. Recebi seu cadastro no formulário sobre a implantação nas lojas. Posso te fazer umas perguntas rápidas?", min: 0 },
      { de: "cliente", texto: "Pode sim.", min: 30 },
      { de: "ia", texto: "Quantas lojas seriam, e vocês pensam em começar por uma ou em todas juntas?", min: 31 },
      { de: "cliente", texto: "São 6 lojas. A ideia é fazer todas juntas, se o prazo couber.", min: 40 },
      { de: "ia", texto: "Entendi. E sobre a verba e a decisão: já está aprovado ou ainda precisa passar por alguém?", min: 41 },
      { de: "cliente", texto: "A verba do semestre já está aprovada. Eu decido junto com o financeiro.", min: 55 },
      { de: "ia", texto: "Ótimo. O melhor próximo passo é uma reunião de diagnóstico com vocês. Vou pedir para a Helena, nossa gestora comercial, falar com você para marcar.", min: 56 },
      { de: "cliente", texto: "Consigo reunir o financeiro na terça. Pode ser?", min: 70 },
    ],
  },
  {
    chave: "thiago",
    contato: "thiago",
    comecouHaDias: 2,
    passo: "qualified",
    qualificacao: { need: "Treinar à noite para ganhar massa", timeline: "Quer começar esta semana" },
    proximaAcao: "Confirmar a aula experimental de amanhã às 19h",
    ficha: {
      headline: "Ganhar massa · treina à noite · aula experimental marcada",
      body: "Thiago quer ganhar massa muscular, só consegue treinar à noite. Aula experimental marcada para amanhã às 19h.",
    },
    com: "ia",
    status: CONVERSA_COM_A_IA,
    etiquetas: ["Meta_ads"],
    mensagens: [
      { de: "cliente", texto: "Quanto custa a mensalidade?", min: 0 },
      { de: "ia", texto: "Oi, Thiago! Temos planos a partir de R$ 99 no anual. Antes de te passar o ideal: qual é o seu objetivo e que horário você consegue treinar?", min: 1 },
      { de: "cliente", texto: "Quero ganhar massa. Só consigo à noite, depois das 18h.", min: 5 },
      { de: "ia", texto: "Boa! À noite temos professor na musculação até as 22h. Que tal uma aula experimental gratuita? Amanhã às 19h tem vaga.", min: 6 },
      { de: "cliente", texto: "Pode ser amanhã às 19h.", min: 9 },
      { de: "ia", texto: "Marcado! Te mando um lembrete amanhã. Leve roupa confortável e uma garrafinha de água.", min: 10 },
    ],
  },
  {
    chave: "rodrigo",
    contato: "rodrigo",
    comecouHaDias: 14,
    passo: "negotiating",
    qualificacao: {
      budget: "R$ 12,5 mil, quer parcelar em 6x",
      authority: "Sócio da empresa",
      need: "Pacote completo para a empresa dele",
      timeline: "Fechar até o dia 10",
    },
    proximaAcao: "Enviar condição em 6x sem juros",
    ficha: {
      headline: "Pacote completo · R$ 12,5 mil · quer 6x · fecha até dia 10",
      body:
        "Rodrigo gostou da proposta do pacote completo. Pediu para parcelar em 6 vezes. Quer fechar até o dia 10, quando entra o faturamento da empresa dele.",
    },
    com: "helena",
    status: "claimed",
    mensagens: [
      { de: "cliente", texto: "Recebi a proposta. Dá pra fazer em 6x?", min: 0 },
      { de: "equipe", texto: "Oi, Rodrigo! Dá sim. Vou confirmar com o financeiro se consigo sem juros e já te retorno.", min: 12 },
      { de: "cliente", texto: "Beleza. Se der, fecho até o dia 10.", min: 20 },
    ],
  },
  {
    chave: "larissa",
    contato: "larissa",
    comecouHaDias: 0,
    passo: "contacted",
    qualificacao: { need: "Apartamento de 2 quartos" },
    proximaAcao: "Perguntar se vai financiar",
    ficha: null,
    com: "ia",
    status: CONVERSA_COM_A_IA,
    etiquetas: ["Meta_ads", "Formulario_Meta"],
    mensagens: [
      { de: "ia", texto: "Oi, Larissa! Aqui é a Sofia, da Empresa Modelo. Vi que você se cadastrou no nosso formulário procurando apartamento de 2 quartos. Posso te ajudar a encontrar?", min: 0 },
      { de: "cliente", texto: "Oi! Pode sim, estou procurando.", min: 18 },
      { de: "ia", texto: "Que bom! Você pretende financiar ou comprar à vista?", min: 19 },
    ],
  },
  {
    chave: "elaine",
    contato: "elaine",
    comecouHaDias: 5,
    passo: "negotiating",
    qualificacao: {
      budget: "Cartão em 12x",
      authority: "Decide sozinha",
      need: "Curso de gestão financeira para a própria loja",
      timeline: "Turma que começa segunda",
    },
    proximaAcao: "Enviar link de pagamento",
    ficha: {
      headline: "Gestão financeira · turma da manhã · 12x no cartão",
      body: "Elaine tem uma loja e quer organizar as finanças. Escolheu a turma da manhã que começa segunda. Vai pagar no cartão em 12x.",
    },
    com: "caio",
    status: "open",
    mensagens: [
      { de: "cliente", texto: "Quero fazer o curso de gestão financeira. Ainda tem vaga na turma da manhã?", min: 0 },
      { de: "ia", texto: "Oi, Elaine! Tem sim, a turma da manhã começa segunda. O curso é para você ou para alguém da sua equipe?", min: 1 },
      { de: "cliente", texto: "Pra mim. Tenho uma loja e preciso organizar as contas.", min: 7 },
      { de: "ia", texto: "Vai te ajudar muito. O valor é R$ 1.490, em até 12x no cartão. Quer que eu reserve sua vaga?", min: 8 },
      { de: "cliente", texto: "Quero! Pode mandar o link.", min: 12 },
      { de: "ia", texto: "Vou pedir para o Caio te enviar o link de pagamento agora e confirmar a vaga.", min: 13 },
    ],
  },
  {
    chave: "leandro",
    contato: "leandro",
    comecouHaDias: 18,
    passo: "lost",
    qualificacao: { budget: "Abaixo de R$ 2 mil", need: "Plano básico" },
    proximaAcao: null,
    ficha: {
      headline: "Achou caro · orçamento abaixo de R$ 2 mil",
      body: "Leandro achou o valor acima do que pode pagar agora. Pediu para ser procurado de novo daqui a alguns meses.",
    },
    com: "ia",
    status: "resolved",
    mensagens: [
      { de: "cliente", texto: "Vi o preço, achei acima do que eu posso agora.", min: 0 },
      { de: "ia", texto: "Entendo, Leandro. Obrigada por avisar. Posso te procurar daqui a uns meses, quando tiver condição especial?", min: 2 },
      { de: "cliente", texto: "Pode sim, obrigado.", min: 30 },
    ],
  },
];

// ─── Agenda ─────────────────────────────────────────────────────────────────

export const COMPROMISSOS: readonly CompromissoDaSemente[] = [
  { chave: "marina-avaliacao", tipo: "consulta", titulo: "Avaliação de clareamento · Marina", contato: "marina", dono: "caio", emDias: 2, hora: "16:00", duracaoMin: 30, status: "confirmed", local: "in_person", criadoPor: "user" },
  { chave: "natalia-visita", tipo: "visita", titulo: "Visita a 3 apartamentos · Natália", contato: "natalia", dono: "otavio", emDias: 3, hora: "10:00", duracaoMin: 90, status: "confirmed", local: "in_person", criadoPor: "user" },
  { chave: "patricia-diagnostico", tipo: "reuniao", titulo: "Diagnóstico com a diretoria · Farmácias Bem Viver", contato: "patricia-bem", dono: "helena", emDias: 5, hora: "14:00", duracaoMin: 60, status: "pending", local: "phone", criadoPor: "user" },
  { chave: "thiago-experimental", tipo: "aula-experimental", titulo: "Aula experimental · Thiago", contato: "thiago", dono: "beatriz", emDias: 1, hora: "19:00", duracaoMin: 60, status: "confirmed", local: "in_person", criadoPor: "ai" },
  { chave: "karina-test-drive", tipo: "test-drive", titulo: "Test drive · Karina", contato: "karina", dono: "caio", emDias: 2, hora: "11:00", duracaoMin: 45, status: "confirmed", local: "in_person", criadoPor: "user" },
  { chave: "renata-visita", tipo: "visita", titulo: "Visita ao apartamento · Renata", contato: "renata", dono: "otavio", emDias: 4, hora: "15:00", duracaoMin: 60, status: "confirmed", local: "in_person", criadoPor: "user" },
  { chave: "rota-sul-reuniao", tipo: "reuniao", titulo: "Revisão do contrato · Rota Sul", contato: "eduardo-rota", dono: "helena", emDias: 1, hora: "09:30", duracaoMin: 45, status: "confirmed", local: "phone", criadoPor: "user" },
  { chave: "tatiane-consulta", tipo: "consulta", titulo: "Consulta de avaliação · Tatiane", contato: "tatiane", dono: "caio", emDias: -3, hora: "10:00", duracaoMin: 30, status: "completed", local: "in_person", criadoPor: "ai", nota: "Paciente fez a avaliação e vai voltar para o orçamento." },
  { chave: "vinicius-assinatura", tipo: "atendimento", titulo: "Assinatura do contrato · Vinícius", contato: "vinicius", dono: "otavio", emDias: -6, hora: "14:00", duracaoMin: 60, status: "completed", local: "in_person", criadoPor: "user" },
  { chave: "bruno-avaliacao", tipo: "consulta", titulo: "Avaliação de implante · Bruno", contato: "bruno", dono: "caio", emDias: -8, hora: "15:30", duracaoMin: 30, status: "no_show", local: "in_person", criadoPor: "ai" },
  { chave: "otto-visita", tipo: "atendimento", titulo: "Visita ao showroom · Otto", contato: "otto", dono: "otavio", emDias: -5, hora: "11:00", duracaoMin: 45, status: "cancelled", local: "in_person", criadoPor: "user", nota: "Cliente cancelou: comprou em outra loja." },
  { chave: "vanessa-matricula", tipo: "atendimento", titulo: "Matrícula · Vanessa", contato: "vanessa", dono: "beatriz", emDias: -4, hora: "18:00", duracaoMin: 30, status: "completed", local: "in_person", criadoPor: "user" },
  { chave: "felipe-ligacao", tipo: "reuniao", titulo: "Ligação de apresentação · Ponto Certo", contato: "felipe-ponto", dono: "beatriz", emDias: 6, hora: "10:30", duracaoMin: 30, status: "pending", local: "whatsapp", criadoPor: "ai" },
];

// ─── Tarefas soltas (além das "próximas ações" dos negócios) ──────────────

export const TAREFAS: readonly TarefaDaSemente[] = [
  { chave: "revisar-textos", titulo: "Revisar os textos dos follow-ups de clínica", dono: "helena", emDias: 3, prioridade: "medium", status: "pending" },
  { chave: "relatorio-semanal", titulo: "Fechar o relatório semanal de vendas", dono: "helena", emDias: -1, prioridade: "high", status: "pending", descricao: "Atrasada de propósito: a lista de atrasadas precisa de exemplo." },
  { chave: "fotos-imoveis", titulo: "Atualizar as fotos dos imóveis do Centro", dono: "otavio", emDias: 5, prioridade: "low", status: "in_progress" },
  { chave: "treinar-caio", titulo: "Treinar o Caio no quadro Comercial", dono: "helena", emDias: null, prioridade: "low", status: "pending" },
  { chave: "retornar-simone", titulo: "Retornar a Simone sobre o horário da turma", dono: "caio", emDias: 0, prioridade: "medium", status: "pending", contato: "simone" },
  { chave: "conferir-contrato", titulo: "Conferir o contrato assinado do Vinícius", dono: "otavio", emDias: -4, prioridade: "high", status: "done", contato: "vinicius" },
  { chave: "planilha-precos", titulo: "Atualizar a tabela de preços dos planos", dono: "beatriz", emDias: -10, prioridade: "medium", status: "cancelled" },
];

// ─── Follow-ups em andamento ────────────────────────────────────────────────

export const INSCRICOES: readonly InscricaoDaSemente[] = [
  { chave: "larissa-retomada", modelo: "imobiliario-retomada", contato: "larissa", status: "waiting_reply", no: "resposta-1", passos: 1, comecouHaDias: 0, proximaEmHoras: 20 },
  { chave: "gabriela-retomada", modelo: "geral-retomada", contato: "gabriela", status: "waiting_reply", no: "resposta-2", passos: 3, comecouHaDias: 3, proximaEmHoras: 30 },
  { chave: "henrique-visita", modelo: "imobiliario-visita", contato: "henrique", status: "active", no: "espera-2", passos: 2, comecouHaDias: 2, proximaEmHoras: 26 },
  { chave: "daniel-test-drive", modelo: "automotivo-test-drive", contato: "daniel", status: "active", no: "espera-1", passos: 1, comecouHaDias: 1, proximaEmHoras: 18 },
  { chave: "carolina-reuniao", modelo: "servicos-b2b-reuniao", contato: "carolina-ponto", status: "waiting_reply", no: "resposta-1", passos: 2, comecouHaDias: 2, proximaEmHoras: 40 },
  { chave: "camila-matricula", modelo: "academia-matricula", contato: "camila", status: "waiting_reply", no: "resposta-1", passos: 2, comecouHaDias: 1, proximaEmHoras: 36 },
  { chave: "bruno-falta", modelo: "clinica-falta-remarcar", contato: "bruno", status: "completed", no: "fim-esgotou", passos: 7, comecouHaDias: 8, desfecho: "exhausted" },
  { chave: "tatiane-retomada", modelo: "clinica-consulta-retomada", contato: "tatiane", status: "completed", no: "fim-marcou", passos: 3, comecouHaDias: 12, desfecho: "converted" },
  { chave: "leandro-retomada", modelo: "geral-retomada", contato: "leandro", status: "cancelled", no: "resposta-1", passos: 1, comecouHaDias: 17, motivoDoCancelamento: "O cliente respondeu e pediu para ser procurado depois." },
];

// ─── Documentos e obrigações (migration 9018, docs/fork/obrigacoes.md) ──────
//
// Um conjunto pequeno e coerente, no funil de Serviços B2B: um documento
// vencido, um vencendo com a renovação pedida e um arquivo do cliente esperando
// confirmação, um pedido sem resposta, um ainda a pedir, e atividades
// recorrentes com histórico. As datas são relativas a "agora": renovar a
// semente devolve cada item à situação que ele ilustra.

/** O funil que recebe o catálogo de tipos (o modelo do segmento Serviços B2B). */
export const FUNIL_DAS_OBRIGACOES: ChaveDoFunil = "servicos";

export const OBRIGACOES: readonly ObrigacaoDaSemente[] = [
  {
    chave: "alvara-rota-sul",
    tipo: "Alvará de funcionamento",
    empresa: "rota-sul",
    responsavel: "helena",
    recebidoEmDias: -368,
    validoAteEmDias: -3,
    pedidoEmDias: -17,
    prazoEmDias: -10,
    observacao: "A prefeitura costuma levar uns 10 dias para emitir o novo.",
    ciclos: [{ recebidoEmDias: -735, validoAteEmDias: -370 }],
  },
  {
    chave: "alvara-bem-viver",
    tipo: "Alvará de funcionamento",
    empresa: "bem-viver",
    responsavel: "helena",
    recebidoEmDias: -353,
    validoAteEmDias: 12,
    pedidoEmDias: -5,
    prazoEmDias: 2,
    proposta: { conversa: "patricia", arquivo: "alvara-renovado.pdf" },
  },
  { chave: "licenca-bem-viver", tipo: "Licença sanitária", empresa: "bem-viver", responsavel: "helena", recebidoEmDias: -190, validoAteEmDias: 175 },
  { chave: "avcb-aurora", tipo: "AVCB (vistoria dos bombeiros)", empresa: "aurora", responsavel: "otavio", recebidoEmDias: -1066, validoAteEmDias: 29 },
  {
    chave: "certificado-felipe",
    tipo: "Certificado digital",
    contato: "felipe-ponto",
    responsavel: "beatriz",
    recebidoEmDias: -348,
    validoAteEmDias: 17,
    observacao: "Certificado pessoal do sócio, usado para assinar.",
  },
  {
    chave: "contrato-social-ponto-certo",
    tipo: "Contrato social",
    negocio: "Contabilidade Ponto Certo · treinamento da equipe",
    responsavel: "beatriz",
    pedidoEmDias: -6,
    prazoEmDias: 1,
    observacao: "Alteração do contrato para incluir a nova unidade.",
  },
  {
    chave: "alvara-ponto-certo",
    tipo: "Alvará de funcionamento",
    empresa: "ponto-certo",
    responsavel: "beatriz",
    observacao: "Pedir depois que o contrato social chegar.",
  },
  { chave: "certificado-vale-azul", tipo: "Certificado digital", empresa: "vale-azul", responsavel: "beatriz", recebidoEmDias: -100, validoAteEmDias: 265 },
  {
    chave: "relatorio-rota-sul",
    tipo: "Relatório mensal",
    negocio: "Transportadora Rota Sul · gestão de frota",
    responsavel: "helena",
    proximaEmDias: 4,
    feitaEmDias: -26,
    ciclos: [
      { proximaEmDias: -57, feitaEmDias: -56 },
      { proximaEmDias: -26, feitaEmDias: -26 },
    ],
  },
  {
    chave: "renovacao-aurora",
    tipo: "Renovação anual do contrato",
    negocio: "Grupo Aurora · consultoria de processos",
    responsavel: "helena",
    proximaEmDias: 45,
    feitaEmDias: -320,
    ciclos: [{ proximaEmDias: -320, feitaEmDias: -320 }],
  },
  {
    chave: "reuniao-bem-viver",
    tipo: "Reunião trimestral",
    negocio: "Farmácias Bem Viver · implantação nas 6 lojas",
    responsavel: "helena",
    proximaEmDias: 42,
    feitaEmDias: -48,
    ciclos: [{ proximaEmDias: -48, feitaEmDias: -48 }],
  },
];
