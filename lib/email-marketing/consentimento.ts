/**
 * FORK MIA (.89) — O CONSENTIMENTO DE E-MAIL MARKETING no contato.
 *
 * Mora numa chave NOVA do jsonb do upstream, `contacts.consent.email_marketing`,
 * ao lado de `marketing`, `transactional` e `profiling`. A anonimização do
 * upstream zera `consent` inteiro, então a chave sai junto, sem gatilho nosso.
 *
 *   {
 *     "granted_at": "2026-08-12T13:14:00Z",   quando a pessoa aceitou
 *     "source": "Formulário do site",          de onde veio o aceite
 *     "version": "padrao-v1",                  a versão do texto aceito
 *     "evidence": "Envio do formulário …",      a evidência
 *     "measurement": true,                     aceitou o aviso de medição
 *     "registered_by": "<uuid>|null",          quem registrou
 *     "registered_by_kind": "ficha",           por qual porta
 *     "declined_at": null                      a recusa, quando houver
 *   }
 *
 * ── Por que "vigente" é aceite SEM recusa depois ─────────────────────────────
 *
 * O mesmo desenho de `consent.marketing`: `declined_at` só existe quando alguém
 * disse não, e um não depois do sim vale. Quase ninguém tem aceite gravado hoje
 * (só a recusa existia), e por isso o e-mail exige o aceite registrado: no
 * e-mail em massa, mandar a quem nunca pediu vira spam para o Gmail e risco na
 * ANPD (decisão "Contato sem registro de consentimento" do protótipo).
 *
 * O REGISTRO de cada aceite e recusa, com a evidência, mora em
 * `mia_email_consentimentos` (9061) — é a prova da base legal.
 */

export type PortaDoRegistro = "ficha" | "importacao" | "pagina_de_preferencias" | "plataforma";

export interface ConsentimentoDeEmail {
  granted_at: string | null;
  source: string | null;
  version: string | null;
  evidence: string | null;
  measurement: boolean;
  registered_by: string | null;
  registered_by_kind: PortaDoRegistro | null;
  declined_at: string | null;
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/** Lê a chave sem confiar no formato: é jsonb livre. */
export function lerConsentimentoDeEmail(consent: unknown): ConsentimentoDeEmail | null {
  const c = objeto(objeto(consent)?.email_marketing);
  if (!c) return null;
  const porta = texto(c.registered_by_kind);
  return {
    granted_at: texto(c.granted_at),
    source: texto(c.source),
    version: texto(c.version),
    evidence: texto(c.evidence),
    measurement: c.measurement === true,
    registered_by: texto(c.registered_by),
    registered_by_kind:
      porta === "ficha" ||
      porta === "importacao" ||
      porta === "pagina_de_preferencias" ||
      porta === "plataforma"
        ? porta
        : null,
    declined_at: texto(c.declined_at),
  };
}

/** Há aceite, e nenhuma recusa depois dele? */
export function consentimentoVigente(consent: unknown): boolean {
  const c = lerConsentimentoDeEmail(consent);
  if (!c?.granted_at) return false;
  if (!c.declined_at) return true;
  return Date.parse(c.declined_at) < Date.parse(c.granted_at);
}

/** O aceite vigente inclui o aviso de medição (e por isso a abertura pode ser medida)? */
export function aceitouMedicao(consent: unknown): boolean {
  return consentimentoVigente(consent) && lerConsentimentoDeEmail(consent)?.measurement === true;
}

/** A recusa de marketing do upstream (`consent.marketing.declined_at`), a que o WhatsApp respeita. */
export function recusouMarketing(consent: unknown): boolean {
  return !!texto(objeto(objeto(consent)?.marketing)?.declined_at);
}

/** O `consent` inteiro com o aceite gravado. As outras chaves ficam como estavam. */
export function consentComAceite(
  consent: unknown,
  aceite: {
    quando: string;
    origem: string;
    versao: string;
    evidencia: string | null;
    medicao: boolean;
    registradoPor: string | null;
    porta: PortaDoRegistro;
  },
): Record<string, unknown> {
  return {
    ...(objeto(consent) ?? {}),
    email_marketing: {
      granted_at: aceite.quando,
      source: aceite.origem,
      version: aceite.versao,
      evidence: aceite.evidencia,
      measurement: aceite.medicao,
      registered_by: aceite.registradoPor,
      registered_by_kind: aceite.porta,
      declined_at: null,
    } satisfies ConsentimentoDeEmail,
  };
}

/** O `consent` inteiro com a recusa gravada (o aceite anterior fica, para a história). */
export function consentComRecusa(
  consent: unknown,
  recusa: {
    quando: string;
    porta: PortaDoRegistro;
    registradoPor: string | null;
    tambemWhatsapp?: boolean;
  },
): Record<string, unknown> {
  const base = objeto(consent) ?? {};
  const atual = lerConsentimentoDeEmail(base);
  const saida: Record<string, unknown> = {
    ...base,
    email_marketing: {
      granted_at: atual?.granted_at ?? null,
      source: atual?.source ?? null,
      version: atual?.version ?? null,
      evidence: atual?.evidence ?? null,
      measurement: atual?.measurement ?? false,
      registered_by: recusa.registradoPor,
      registered_by_kind: recusa.porta,
      declined_at: recusa.quando,
    } satisfies ConsentimentoDeEmail,
  };
  if (recusa.tambemWhatsapp) {
    // A recusa de marketing que o WhatsApp do sistema já respeita.
    const marketing = objeto(base.marketing) ?? {};
    saida.marketing = { ...marketing, declined_at: recusa.quando };
  }
  return saida;
}

/** Desfaz a recusa (só pela própria pessoa, na página de preferências). */
export function consentSemRecusa(consent: unknown): Record<string, unknown> {
  const base = objeto(consent) ?? {};
  const atual = objeto(base.email_marketing);
  if (!atual) return base;
  return { ...base, email_marketing: { ...atual, declined_at: null } };
}
