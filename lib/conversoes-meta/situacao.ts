/**
 * FORK MIA — a SITUAÇÃO de um envio de conversão, como quem opera a lê, e a
 * regra de quando o "Reenviar" resolve alguma coisa.
 *
 * Módulo PURO: o histórico (servidor), o cartão aberto (cliente) e a ferramenta
 * do MCP leem daqui. O livro-razão (`ad_conversion_dispatches`, do upstream)
 * guarda `status` (sent/skipped/error) e um motivo em slug; aqui eles viram as
 * situações da tela, para as DUAS plataformas.
 *
 * ── Por que sete, e não as quatro do upstream ───────────────────────────────
 *
 * O histórico do upstream junta todo "não enviado" numa situação só. Quem
 * explica a um cliente por que a Meta não ficou sabendo de uma venda precisa da
 * razão separada, porque cada uma pede uma coisa diferente: sem clique não tem
 * o que fazer; sem valor é preencher o valor; anterior à regra é decisão;
 * conexão é consertar a conexão.
 */

export const SITUACOES_DE_ENVIO = [
  "enviado",
  "aguardando",
  "recusado",
  "sem_clique",
  "sem_valor",
  "anterior_a_regra",
  "conexao",
] as const;

export type SituacaoDeEnvio = (typeof SITUACOES_DE_ENVIO)[number];

export const ROTULO_DA_SITUACAO: Record<SituacaoDeEnvio, string> = {
  enviado: "Enviado",
  aguardando: "Aguardando",
  recusado: "Recusado pela plataforma",
  sem_clique: "Não enviado · sem clique de anúncio",
  sem_valor: "Não enviado · sem valor",
  anterior_a_regra: "Não enviado · anterior à regra",
  conexao: "Não enviado · conexão ou modo de teste",
};

/** Os motivos de `skipped` que são espera, e não desfecho. */
export const MOTIVOS_DE_ESPERA = [
  "aguardando_processamento",
  "nova_tentativa_agendada",
  "reprocessamento_solicitado",
  "processamento_demorado",
] as const;

/** O negócio não tinha a identidade que a plataforma exige (ou a porta dela estava fechada). */
export const MOTIVOS_SEM_CLIQUE = ["sem_atribuicao", "formulario_desligado"] as const;

/** A linha registra uma DECISÃO das travas, não uma pendência. */
export const MOTIVOS_ANTERIORES = ["anterior_a_regra", "anterior_a_chave"] as const;

/**
 * Os motivos que NÃO seguram o retrato do primeiro envio: a linha diz "isto não
 * era para ir", e um movimento novo que passe nas travas é um evento novo.
 */
export const MOTIVOS_QUE_NAO_SAO_EVENTO: readonly string[] = [...MOTIVOS_ANTERIORES, "formulario_desligado"];

/** Todos os motivos que têm situação própria. O que sobra de `skipped` é "conexão". */
export const MOTIVOS_COM_SITUACAO_PROPRIA: readonly string[] = [
  ...MOTIVOS_DE_ESPERA,
  ...MOTIVOS_SEM_CLIQUE,
  ...MOTIVOS_ANTERIORES,
  "sem_valor",
];

export function situacaoDoEnvio(status: string, motivo: string | null): SituacaoDeEnvio {
  if (status === "sent") return "enviado";
  if (status === "error") return "recusado";
  if (motivo && (MOTIVOS_DE_ESPERA as readonly string[]).includes(motivo)) return "aguardando";
  if (motivo && (MOTIVOS_SEM_CLIQUE as readonly string[]).includes(motivo)) return "sem_clique";
  if (motivo && (MOTIVOS_ANTERIORES as readonly string[]).includes(motivo)) return "anterior_a_regra";
  if (motivo === "sem_valor") return "sem_valor";
  return "conexao";
}

/**
 * O texto que quem opera lê para os motivos que esta peça acrescentou. Os do
 * upstream continuam em `MOTIVO_LEGIVEL` (`lib/conversoes/estado-da-conexao.ts`).
 */
export const MOTIVO_DA_META_LEGIVEL: Record<string, string> = {
  formulario_desligado:
    "Veio de formulário da Meta e a volta dos leads de formulário está desligada.",
  anterior_a_regra: "O negócio entrou na etapa antes de a regra ser ligada.",
  anterior_a_chave: "Aconteceu antes de a volta dos leads de formulário ser ligada.",
  sem_atribuicao: "O negócio não veio de um clique em anúncio desta plataforma.",
};

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

export type Reenvio =
  | { pode: true }
  | {
      pode: false;
      /** `passou_de_7_dias` é o único "não" que a tela explica: o resto é só ausência do botão. */
      porque: "ja_enviado" | "na_fila" | "nao_resolve" | "passou_de_7_dias";
    };

/**
 * O "Reenviar" resolve este envio?
 *
 * Resolve quando a causa é consertável e ainda dá tempo: recusado pela
 * plataforma, sem valor (depois de preencher o valor) e conexão ou modo de
 * teste (depois de consertar a conexão). Não resolve o que foi decisão das
 * travas (sem clique, anterior à regra) nem o que já está na fila.
 *
 * A Meta recusa evento com mais de 7 dias: aí não há reenvio que resolva, e a
 * tela diz isso em vez de oferecer um botão que só repetiria a recusa. O Google
 * não tem esse teto curto, e segue como o upstream o trata.
 */
export function reenvioDoEnvio(
  envio: {
    plataforma: string;
    status: string;
    motivo: string | null;
    /** Quando o evento aconteceu. Nulo em linha antiga: vale a última tentativa. */
    ocorridoEm: string | null;
    tentadoEm: string;
  },
  agora: Date = new Date(),
): Reenvio {
  const situacao = situacaoDoEnvio(envio.status, envio.motivo);
  if (situacao === "enviado") return { pode: false, porque: "ja_enviado" };
  if (situacao === "sem_clique" || situacao === "anterior_a_regra") return { pode: false, porque: "nao_resolve" };
  if (situacao === "aguardando") {
    // "Demorado" é a exceção: a plataforma não concluiu em 24h, e conferir de
    // novo é exatamente o que a mensagem pede.
    return envio.motivo === "processamento_demorado" ? { pode: true } : { pode: false, porque: "na_fila" };
  }
  if (envio.plataforma === "meta_ads") {
    const quando = Date.parse(envio.ocorridoEm ?? envio.tentadoEm);
    if (Number.isFinite(quando) && agora.getTime() - quando > SETE_DIAS_MS) {
      return { pode: false, porque: "passou_de_7_dias" };
    }
  }
  return { pode: true };
}
