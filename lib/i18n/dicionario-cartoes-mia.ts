/**
 * FORK MIA — as frases de tela dos cartões e das fichas (lib/cartoes/,
 * components/cartoes/), em espanhol.
 *
 * Moram num arquivo NOSSO, espalhado no fim do `DICIONARIO` do upstream por uma
 * linha (`...DICIONARIO_CARTOES_MIA`), para a sincronização com o upstream não
 * conflitar a cada frase nova (docs/FORK-MIA.md, regra 1: o nosso mora ao lado
 * do dele). A regra é a do dicionário dele: a chave é o texto em português, e só
 * o que DIFERE precisa de linha — mas o guarda `i18n-espanhol-cobre-a-tela`
 * cobra toda chave, então a sigla igual nos dois idiomas também entra.
 *
 * ⚠️ Não repita aqui uma chave que o upstream já traduz: o espalhamento vem por
 * último e VENCERIA a tradução dele em silêncio.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_CARTOES_MIA: Traducoes = {
  // ─── cartão fechado do funil ───────────────────────────────────────────────
  "1 tarefa atrasada": { es: "1 tarea atrasada" },
  "tarefas atrasadas": { es: "tareas atrasadas" },
  "Já comprou": { es: "Ya compró" },
  recorrente: { es: "recurrente" },
  "Nenhum compromisso marcado para este negócio": { es: "Ninguna cita agendada para este negocio" },
  "sem compromisso marcado": { es: "sin cita agendada" },
  "Próximo compromisso": { es: "Próxima cita" },
  "chance calculada pela IA": { es: "probabilidad calculada por la IA" },
  "chance da etapa": { es: "probabilidad de la etapa" },
  "sem chance calculada": { es: "sin probabilidad calculada" },
  "Data prevista para fechar e chance de fechamento": {
    es: "Fecha prevista de cierre y probabilidad de cerrar",
  },
  "sem data": { es: "sin fecha" },
  "Objeção aberta": { es: "Objeción abierta" },
  objeção: { es: "objeción" },
  "O lead falou por último e ninguém respondeu": { es: "El lead habló último y nadie respondió" },
  "Falamos por último; aguardando o cliente": { es: "Hablamos últimos; esperando al cliente" },
  bola: { es: "turno" },
  nós: { es: "nosotros" },
  cliente: { es: "cliente" },
  amanhã: { es: "mañana" },
  "Tarefa criada": { es: "Tarea creada" },
  "A aprovação foi registrada, mas a tarefa não foi criada. Crie a tarefa pela lista de Tarefas.": {
    es: "La aprobación quedó registrada, pero la tarea no se creó. Crea la tarea desde la lista de Tareas.",
  },

  // ─── canal de origem (siglas e rótulos) ────────────────────────────────────
  META: { es: "META" },
  FORM: { es: "FORM" },
  GOOGLE: { es: "GOOGLE" },
  SITE: { es: "SITIO" },
  INDIC: { es: "RECOM" },
  ATIVO: { es: "ACTIVO" },
  CAMP: { es: "CAMP" },
  IMPORT: { es: "IMPORT" },
  SOCIAL: { es: "SOCIAL" },
  LIGAÇÃO: { es: "LLAMADA" },
  DIRETO: { es: "DIRECTO" },
  MANUAL: { es: "MANUAL" },
  "Anúncio Meta": { es: "Anuncio de Meta" },
  "Formulário Meta": { es: "Formulario de Meta" },
  Indicação: { es: "Recomendación" },
  "Prospecção ativa": { es: "Prospección activa" },
  "Campanha de mensagens": { es: "Campaña de mensajes" },
  "WhatsApp direto": { es: "WhatsApp directo" },
  "Cadastro manual": { es: "Registro manual" },

  // ─── filtros e ordem do quadro ─────────────────────────────────────────────
  "Canal de origem": { es: "Canal de origen" },
  Faixa: { es: "Rango" },
  "Chance de fechar": { es: "Probabilidad de cerrar" },
  "Todas as faixas": { es: "Todos los rangos" },
  "Sem faixa": { es: "Sin rango" },
  "Ordem dos cartões na coluna": { es: "Orden de las tarjetas en la columna" },
  Urgência: { es: "Urgencia" },
  "Quentes primeiro": { es: "Calientes primero" },
  "Maior valor": { es: "Mayor valor" },
  "Manual (arrastar)": { es: "Manual (arrastrar)" },
  "Em cima: lead esperando resposta, tarefa atrasada, compromisso hoje, proposta da IA para aprovar, esfriando, sem próximo passo e, por último, com o próximo passo marcado.":
    {
      es: "Arriba: lead esperando respuesta, tarea atrasada, cita hoy, propuesta de la IA por aprobar, enfriándose, sin próximo paso y, por último, con el próximo paso agendado.",
    },
  "Para reordenar arrastando dentro da coluna, escolha Manual.": {
    es: "Para reordenar arrastrando dentro de la columna, elige Manual.",
  },

  // ─── papel da pessoa ───────────────────────────────────────────────────────
  Decisor: { es: "Decisor" },
  Influenciador: { es: "Influenciador" },
};
