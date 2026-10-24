/**
 * FORK MIA (.89) — O RECORTE do público de uma campanha de e-mail.
 *
 * É o filtro das Campanhas do upstream (`lib/campanhas/audiencia.ts`: etiquetas,
 * funil, etapa, responsável, situação do negócio, origem, interação, cadastro)
 * com dois acréscimos nossos, do protótipo aprovado:
 *
 *   - a EMPRESA do contato (a empresa única, `contacts.empresa_id`): uma empresa,
 *     "só quem tem empresa" ou "só quem não tem";
 *   - a CAMPANHA ANTERIOR de e-mail: quem clicou, quem abriu (estimativa), quem
 *     recebeu e não abriu, quem recebeu.
 *
 * A mesma regra do upstream vale aqui: não existe "todos os contatos". Recorte
 * sem critério é o envio que ninguém confere antes de apertar.
 *
 * O recorte é salvo como segmento (`mia_segmentos.recorte`) e congelado na
 * campanha (`mia_email_campanhas.recorte`). A lista não: a conta refaz na hora.
 */
import { z } from "zod";

import { FILTRO_VAZIO, type FiltroDeAudiencia } from "@/lib/campanhas/audiencia";

const ETIQUETAS = z.array(z.string().trim().min(1).max(40)).max(10).default([]);

export const COMPORTAMENTOS_NA_CAMPANHA = [
  "clicou",
  "abriu",
  "recebeu_e_nao_abriu",
  "recebeu",
] as const;
export type ComportamentoNaCampanha = (typeof COMPORTAMENTOS_NA_CAMPANHA)[number];

export const ROTULO_DO_COMPORTAMENTO: Record<ComportamentoNaCampanha, string> = {
  clicou: "Clicou",
  abriu: "Abriu (estimativa)",
  recebeu_e_nao_abriu: "Recebeu e não abriu",
  recebeu: "Recebeu",
};

export const recorteSchema = z
  .object({
    com_todas_tags: ETIQUETAS,
    com_alguma_tag: ETIQUETAS,
    sem_tags: ETIQUETAS,
    funis: z.array(z.string().uuid()).max(20).default([]),
    etapas: z.array(z.string().uuid()).max(50).default([]),
    responsaveis: z.array(z.string().uuid()).max(50).default([]),
    situacoes_do_negocio: z
      .array(z.enum(["open", "won", "lost"]))
      .max(3)
      .default([]),
    sem_interacao_ha_dias: z.number().int().min(1).max(3650).nullable().default(null),
    com_interacao_ha_dias: z.number().int().min(0).max(3650).nullable().default(null),
    cadastrado_de: z.string().datetime().nullable().default(null),
    cadastrado_ate: z.string().datetime().nullable().default(null),
    origens: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    /** `com` = só quem tem empresa; `sem` = só quem não tem; um id = aquela empresa. */
    empresa: z
      .union([z.literal("com"), z.literal("sem"), z.string().uuid()])
      .nullable()
      .default(null),
    campanha_anterior: z
      .object({ campanha_id: z.string().uuid(), comportamento: z.enum(COMPORTAMENTOS_NA_CAMPANHA) })
      .nullable()
      .default(null),
  })
  .strict();

export type RecorteDoEmail = z.infer<typeof recorteSchema>;

export const RECORTE_VAZIO: RecorteDoEmail = recorteSchema.parse({});

/** O recorte usa algum critério do filtro das Campanhas do upstream? */
export function usaFiltroDoUpstream(r: RecorteDoEmail): boolean {
  return (
    r.com_todas_tags.length > 0 ||
    r.com_alguma_tag.length > 0 ||
    r.sem_tags.length > 0 ||
    r.funis.length > 0 ||
    r.etapas.length > 0 ||
    r.responsaveis.length > 0 ||
    r.situacoes_do_negocio.length > 0 ||
    r.origens.length > 0 ||
    r.sem_interacao_ha_dias !== null ||
    r.com_interacao_ha_dias !== null ||
    r.cadastrado_de !== null ||
    r.cadastrado_ate !== null
  );
}

/** Pelo menos um critério. Sem ele, não há público (não existe "todos"). */
export function temCriterio(r: RecorteDoEmail): boolean {
  return usaFiltroDoUpstream(r) || r.empresa !== null || r.campanha_anterior !== null;
}

/** O filtro do upstream, com o teto de linhas do e-mail (que é maior que o do WhatsApp). */
export function paraFiltroDoUpstream(r: RecorteDoEmail, limite: number): FiltroDeAudiencia {
  return {
    ...FILTRO_VAZIO,
    com_todas_tags: r.com_todas_tags,
    com_alguma_tag: r.com_alguma_tag,
    sem_tags: r.sem_tags,
    funis: r.funis,
    etapas: r.etapas,
    responsaveis: r.responsaveis,
    situacoes_do_negocio: r.situacoes_do_negocio,
    sem_interacao_ha_dias: r.sem_interacao_ha_dias,
    com_interacao_ha_dias: r.com_interacao_ha_dias,
    cadastrado_de: r.cadastrado_de,
    cadastrado_ate: r.cadastrado_ate,
    origens: r.origens,
    limite,
  };
}

/** O recorte lido sem confiar no formato (vem de jsonb). Inválido vira o vazio. */
export function lerRecorte(bruto: unknown): RecorteDoEmail {
  const r = recorteSchema.safeParse(bruto ?? {});
  return r.success ? r.data : RECORTE_VAZIO;
}
