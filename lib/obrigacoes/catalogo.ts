/**
 * FORK MIA — OBRIGAÇÕES · os MODELOS de tipo por segmento.
 *
 * O tipo traz validade padrão, recorrência, avisos, quem entrega e a quem se
 * liga; tudo é copiado para o item e pode ser mudado nele. Estes modelos são o
 * ponto de partida de um funil ("usar o modelo do segmento", na configuração do
 * funil e em `plataforma_garantir_tipos_de_obrigacao`), e aparecem no
 * formulário de adicionar mesmo antes de o funil ter catálogo próprio.
 *
 * As validades e os avisos são os do protótipo aprovado (01/10/2026).
 *
 * ── Privacidade ───────────────────────────────────────────────────────────
 *
 * Atestado médico, laudo de saúde e exame são dado SENSÍVEL (LGPD, art. 5º II)
 * e ficam FORA dos modelos: nenhum segmento os oferece pronto. Se um cliente
 * precisar, ele cria o tipo à mão, sabendo o que está guardando; o arquivo fica
 * na área privada como todos, e obrigação nenhuma alimenta campanha, público ou
 * conversão. `tests/unit/obrigacoes-catalogo-e-dicionario.test.ts` reprova um modelo sensível.
 *
 * ⚠️ Módulo PURO.
 */
import { chaveDoNome, type Categoria, type LigaA, type QuemEntrega, type Recorrencia } from "./tipos";

export const SEGMENTOS_DE_OBRIGACAO = ["servicos_b2b", "clinica", "imobiliaria", "automotivo", "academia", "industria_b2b"] as const;
export type SegmentoDeObrigacao = (typeof SEGMENTOS_DE_OBRIGACAO)[number];

export const ROTULO_DO_SEGMENTO_DE_OBRIGACAO = {
  servicos_b2b: "Serviços B2B",
  clinica: "Clínica",
  imobiliaria: "Imobiliária",
  automotivo: "Automotivo e proteção veicular",
  academia: "Academia",
  industria_b2b: "Indústria e distribuição B2B",
} as const satisfies Record<SegmentoDeObrigacao, string>;

export interface ModeloDeTipo {
  segmento: SegmentoDeObrigacao;
  nome: string;
  nome_curto: string;
  categoria: Categoria;
  quem_entrega: QuemEntrega;
  recorrencia: Recorrencia;
  recorrencia_meses: number | null;
  validade_meses: number;
  avisos_dias: number[];
  dias_sem_resposta: number;
  liga_a: LigaA;
  pede_arquivo: boolean;
}

type Ajuste = Partial<Omit<ModeloDeTipo, "segmento" | "nome" | "categoria">> & { a_cada_meses?: number };

function modelo(segmento: SegmentoDeObrigacao, nome: string, categoria: Categoria, ajuste: Ajuste = {}): ModeloDeTipo {
  const { a_cada_meses: aCada, ...resto } = ajuste;
  return {
    segmento,
    nome,
    nome_curto: nome,
    categoria,
    // Documento é o cliente que entrega; atividade é a empresa que faz.
    quem_entrega: categoria === "atividade" ? "nos" : "cliente",
    recorrencia: aCada ? "n_meses" : "unica",
    recorrencia_meses: aCada ?? null,
    validade_meses: 0,
    avisos_dias: [30, 15, 7],
    dias_sem_resposta: 5,
    liga_a: "negocio",
    pede_arquivo: categoria === "documento",
    ...resto,
  };
}

const B2B = "servicos_b2b";
const AUTO = "automotivo";
const IND = "industria_b2b";

export const MODELOS_DE_TIPO: readonly ModeloDeTipo[] = [
  // ── Serviços B2B ──────────────────────────────────────────────────────────
  modelo(B2B, "Alvará de funcionamento", "documento", { nome_curto: "Alvará", recorrencia: "anual", validade_meses: 12, liga_a: "empresa" }),
  modelo(B2B, "AVCB (vistoria dos bombeiros)", "documento", { nome_curto: "AVCB", a_cada_meses: 36, validade_meses: 36, liga_a: "empresa", avisos_dias: [60, 30, 15] }),
  modelo(B2B, "Licença sanitária", "documento", { recorrencia: "anual", validade_meses: 12, liga_a: "empresa" }),
  modelo(B2B, "Certificado digital", "documento", { recorrencia: "anual", validade_meses: 12, liga_a: "empresa" }),
  modelo(B2B, "Contrato social", "documento", { avisos_dias: [], liga_a: "empresa" }),
  modelo(B2B, "Renovação anual do contrato", "atividade", { nome_curto: "Renovação do contrato", recorrencia: "anual", avisos_dias: [45, 30, 15] }),
  modelo(B2B, "Relatório mensal", "atividade", { recorrencia: "mensal", avisos_dias: [5, 2] }),
  modelo(B2B, "Reunião trimestral", "atividade", { a_cada_meses: 3, avisos_dias: [7, 2] }),
  // ── Clínica ───────────────────────────────────────────────────────────────
  modelo("clinica", "Orçamento assinado", "documento", { avisos_dias: [] }),
  modelo("clinica", "Contrato de tratamento assinado", "documento", { avisos_dias: [] }),
  modelo("clinica", "Retorno e manutenção", "atividade", { a_cada_meses: 6, avisos_dias: [15, 7], quem_entrega: "cliente", liga_a: "contato" }),
  // ── Imobiliária ───────────────────────────────────────────────────────────
  modelo("imobiliaria", "RG e CPF", "documento", { avisos_dias: [], liga_a: "contato" }),
  modelo("imobiliaria", "Comprovante de renda", "documento", { validade_meses: 3, avisos_dias: [15, 7] }),
  modelo("imobiliaria", "Extrato do FGTS", "documento", { avisos_dias: [] }),
  modelo("imobiliaria", "Certidões (validade curta)", "documento", { nome_curto: "Certidões", validade_meses: 1, avisos_dias: [10, 5] }),
  modelo("imobiliaria", "Aprovação de crédito", "documento", { validade_meses: 6 }),
  modelo("imobiliaria", "Parcela anual", "atividade", { recorrencia: "anual", quem_entrega: "cliente" }),
  modelo("imobiliaria", "Reajuste do contrato", "atividade", { recorrencia: "anual", avisos_dias: [30, 15] }),
  // ── Automotivo e proteção veicular ────────────────────────────────────────
  modelo(AUTO, "CNH", "documento", { validade_meses: 120, liga_a: "contato" }),
  modelo(AUTO, "Comprovante de renda", "documento", { validade_meses: 3, avisos_dias: [15, 7] }),
  modelo(AUTO, "Documento do carro na troca", "documento", { avisos_dias: [] }),
  modelo(AUTO, "Laudo de vistoria", "documento", { validade_meses: 1, avisos_dias: [10, 5] }),
  modelo(AUTO, "Licenciamento anual", "documento", { recorrencia: "anual", validade_meses: 12 }),
  modelo(AUTO, "Revisão", "atividade", { a_cada_meses: 6, avisos_dias: [15, 7], quem_entrega: "cliente" }),
  modelo(AUTO, "Renovação da proteção", "atividade", { recorrencia: "anual" }),
  // ── Academia ──────────────────────────────────────────────────────────────
  modelo("academia", "Contrato do plano", "documento", { avisos_dias: [] }),
  modelo("academia", "Renovação do plano", "atividade", { recorrencia: "anual", quem_entrega: "cliente" }),
  modelo("academia", "Reavaliação física", "atividade", { a_cada_meses: 3, avisos_dias: [7, 2], quem_entrega: "cliente", liga_a: "contato" }),
  // ── Indústria e distribuição B2B ──────────────────────────────────────────
  // A fábrica que vende para revendas e profissionais cuida de duas coisas: o
  // cadastro de quem compra a prazo (documentos da EMPRESA cliente) e o ritmo da
  // carteira. A reposição do pedido é a recompra: atividade do cliente, todo mês.
  modelo(IND, "Ficha cadastral da revenda", "documento", { nome_curto: "Ficha cadastral", recorrencia: "anual", validade_meses: 12, liga_a: "empresa" }),
  modelo(IND, "Contrato social", "documento", { avisos_dias: [], liga_a: "empresa" }),
  modelo(IND, "Alvará de funcionamento", "documento", { nome_curto: "Alvará", recorrencia: "anual", validade_meses: 12, liga_a: "empresa" }),
  modelo(IND, "Certidão negativa de débitos", "documento", { nome_curto: "CND", a_cada_meses: 6, validade_meses: 6, avisos_dias: [15, 7], liga_a: "empresa" }),
  modelo(IND, "Contrato de revenda", "documento", { recorrencia: "anual", validade_meses: 12, avisos_dias: [45, 30, 15], liga_a: "empresa" }),
  modelo(IND, "Pedido de reposição", "atividade", { recorrencia: "mensal", avisos_dias: [7, 2], quem_entrega: "cliente", liga_a: "empresa" }),
  modelo(IND, "Visita do representante", "atividade", { a_cada_meses: 2, avisos_dias: [7, 2], liga_a: "empresa" }),
  modelo(IND, "Reajuste da tabela de preços", "atividade", { recorrencia: "anual", avisos_dias: [30, 15], liga_a: "empresa" }),
];

export function modelosDoSegmento(segmento: SegmentoDeObrigacao): ModeloDeTipo[] {
  return MODELOS_DE_TIPO.filter((m) => m.segmento === segmento);
}

export function ehSegmentoDeObrigacao(valor: unknown): valor is SegmentoDeObrigacao {
  return typeof valor === "string" && (SEGMENTOS_DE_OBRIGACAO as readonly string[]).includes(valor);
}

/**
 * O nome parece documento de SAÚDE (dado sensível)?
 *
 * "Laudo de vistoria" (do carro) não é; "laudo médico" e "laudo de saúde" são.
 * Serve para manter os modelos limpos e para a tela avisar quem cria um tipo
 * desses à mão.
 */
export function ehTipoSensivel(nome: string): boolean {
  const n = chaveDoNome(nome);
  return (
    /\batestado\b/.test(n) ||
    /\bexames?\b/.test(n) ||
    /\blaudos?\s+(medico|medicos|de\s+saude|psicologico|psiquiatrico)\b/.test(n) ||
    /\bprontuario\b/.test(n) ||
    /\breceita\s+medica\b/.test(n)
  );
}
