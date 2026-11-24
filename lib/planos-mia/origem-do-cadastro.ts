/**
 * FORK MIA (MIA-168) · A ORIGEM DO LINK DO /SIGNUP.
 *
 * O link do anúncio ou do site traz `utm_*` e os ids de clique (`gclid`,
 * `gbraid`, `wbraid`, `fbclid`). A página do cadastro lê da URL e entrega ao
 * formulário num campo escondido (`mia_origem`); a action manda ao CRM da Time
 * (`lib/planos-mia/lead-do-cadastro.ts`). Nada aqui é visível na tela.
 *
 * Módulo puro (sem servidor): o formulário, que é "use client", importa daqui.
 * A régua de tamanho é a mesma na página, no `signupSchema` e na action: o
 * campo é adulterável no navegador.
 */
import { z } from "zod";

/** As chaves que valem, na ordem do corpo. Fora delas, nada passa. */
export const CAMPOS_DA_ORIGEM = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
] as const;

export type CampoDaOrigem = (typeof CAMPOS_DA_ORIGEM)[number];

export type OrigemDoCadastro = Partial<Record<CampoDaOrigem, string>>;

/** O teto de cada valor (um gclid tem uns 100 caracteres; utm, menos). */
export const TETO_DO_VALOR_DA_ORIGEM = 500;

const CAMPOS = new Set<string>(CAMPOS_DA_ORIGEM);

/** O campo escondido no `signupSchema`: só chaves conhecidas, cada valor com teto. */
export const origemDoCadastroSchema = z
  .record(z.string().max(20), z.string().max(TETO_DO_VALOR_DA_ORIGEM))
  .refine((o) => Object.keys(o).length <= CAMPOS_DA_ORIGEM.length && Object.keys(o).every((k) => CAMPOS.has(k)), {
    message: "origem_invalida",
  });

/** Só as chaves conhecidas, aparadas, sem vazio e no teto. Aceita qualquer entrada. */
export function origemSaneada(bruta: unknown): OrigemDoCadastro {
  if (!bruta || typeof bruta !== "object" || Array.isArray(bruta)) return {};
  const fonte = bruta as Record<string, unknown>;
  const limpa: OrigemDoCadastro = {};
  for (const campo of CAMPOS_DA_ORIGEM) {
    const v = fonte[campo];
    const texto = Array.isArray(v) ? v[0] : v;
    if (typeof texto !== "string") continue;
    const aparado = texto.trim();
    if (aparado && aparado.length <= TETO_DO_VALOR_DA_ORIGEM) limpa[campo] = aparado;
  }
  return limpa;
}

/** A origem a partir dos `searchParams` da página (`?utm_source=…&gclid=…`). */
export function origemDoLink(params: Record<string, string | string[] | undefined>): OrigemDoCadastro {
  return origemSaneada(params);
}
