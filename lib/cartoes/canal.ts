/**
 * FORK MIA — DE ONDE O NEGÓCIO VEIO, numa sigla: META, FORM, GOOGLE, SITE…
 *
 * `crm_leads.source` e `contacts.source` têm vocabulário ABERTO (sem CHECK, pela
 * doutrina de clone), e cada porta de entrada grava o seu: `whatsapp` no
 * nascimento pela 1ª mensagem, `meta_ads` no formulário da Meta, `webhook` na
 * fonte de captação, `prospecting` na prospecção pelo Google Maps, `campanha`
 * no disparo por QR, `importacao_planilha`, `automation`, `ai_agent`, `manual`…
 * Esta função é o ÚNICO tradutor disso para a tela — o selo do cartão, o filtro
 * de canal e o bloco de origem do cartão aberto leem daqui.
 *
 * ─── A precedência, e de onde ela vem ──────────────────────────────────────
 *
 *  1. CAMPANHA vence anúncio: a conversa nasceu porque NÓS falamos com a pessoa
 *     (`lib/campanhas/origem-do-lead.ts`), mesmo que ela tenha vindo de um
 *     anúncio meses antes.
 *  2. A evidência do PRÓPRIO negócio: `external_id` `meta-lead:` ou a etiqueta
 *     `Formulario_Meta` provam formulário; `source` diz o resto.
 *  3. Negócio nascido no WhatsApp (`whatsapp`) NÃO volta a olhar o contato: o
 *     nascimento já copiou para o lead o primeiro toque que existia (e escolheu
 *     `meta_ads`/`google_ads`/`site` quando havia).
 *  4. Origens genéricas (`manual`, `automation`, `ai_agent`, `retomada`, texto
 *     livre) caem no primeiro toque do CONTATO — o negócio criado à mão para
 *     quem veio de anúncio continua sendo de anúncio.
 *
 * INDIC só aparece quando alguém escreveu "indicação" na origem, na UTM ou numa
 * etiqueta do negócio — nenhuma porta de entrada grava isso sozinha hoje.
 */
import type { CanalDoCartao, SiglaDoCanal } from "@/lib/cartoes/tipos";

type Meta = Record<string, unknown>;

export interface OrigemDoNegocio {
  source: string | null;
  source_metadata: Meta | null;
  external_id: string | null;
  tags: string[] | null;
  description?: string | null;
}

export interface OrigemDoContatoBruta {
  source: string | null;
  source_metadata: Meta | null;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function minusculo(v: unknown): string | null {
  return texto(v)?.toLowerCase() ?? null;
}

/** Google/Meta/indicação pela UTM do site ou da fonte de captação. */
function porUtm(m: Meta): SiglaDoCanal | null {
  if (minusculo(m.gclid) || minusculo(m.gbraid) || minusculo(m.wbraid)) return "GOOGLE";
  const fonte = minusculo(m.utm_source);
  const pago = /cpc|ppc|paid|pago|ads/.test(minusculo(m.utm_medium) ?? "");
  if (fonte && /google|adwords/.test(fonte) && pago) return "GOOGLE";
  if (minusculo(m.fbclid) || (fonte && /facebook|^fb$|instagram|^ig$|meta/.test(fonte) && pago)) return "META";
  if (fonte && /indica/.test(fonte)) return "INDIC";
  return null;
}

function siglaDoContato(c: OrigemDoContatoBruta): SiglaDoCanal | null {
  const m = c.source_metadata ?? {};
  switch (c.source) {
    case "meta_ads":
      return texto(m.meta_lead_id) || texto(m.meta_form_id) ? "FORM" : "META";
    case "google_ads":
      return "GOOGLE";
    case "site":
    case "webhook":
      return porUtm(m) ?? "SITE";
    case "prospecting":
      return "ATIVO";
    case "import_csv":
    case "importacao_planilha":
      return "IMPORT";
    case "social":
      return "SOCIAL";
    case "voip":
      return "LIGACAO";
    case "whatsapp":
    case "whatsapp_group":
      return "DIRETO";
    default:
      return c.source && /indica/i.test(c.source) ? "INDIC" : null;
  }
}

function siglaDoNegocio(lead: OrigemDoNegocio, contato: OrigemDoContatoBruta | null): SiglaDoCanal {
  const m = lead.source_metadata ?? {};
  const tags = lead.tags ?? [];
  if (lead.source === "campanha" || lead.source === "campaign") return "CAMPANHA";
  if (lead.external_id?.startsWith("meta-lead:") || tags.includes("Formulario_Meta")) return "FORM";
  switch (lead.source) {
    case "meta_ads":
      return texto(m.meta_lead_id) ? "FORM" : "META";
    case "google_ads":
      return "GOOGLE";
    case "site":
    case "webhook":
      return porUtm(m) ?? "SITE";
    case "prospecting":
      return "ATIVO";
    case "importacao_planilha":
    case "import_csv":
      return "IMPORT";
    case "whatsapp":
      return "DIRETO";
  }
  if ((lead.source && /indica/i.test(lead.source)) || tags.some((x) => /indica/i.test(x))) return "INDIC";
  return (contato ? siglaDoContato(contato) : null) ?? "MANUAL";
}

/** "Campanha: Setembro" (descrição da prospecção) → "Setembro". */
function campanhaDaDescricao(descricao: string | null | undefined): string | null {
  const m = descricao?.match(/campanha:\s*(.+)/i);
  return m?.[1] ? m[1].split("\n")[0]!.trim() || null : null;
}

function campanhaDoMeta(m: Meta): string | null {
  return (
    texto(m.campaign_name) ??
    texto(m.utm_campaign) ??
    texto(m.meta_form_name) ??
    texto(m.ad_name) ??
    texto(m.ad_title)
  );
}

export function canalDoNegocio(
  lead: OrigemDoNegocio,
  contato: OrigemDoContatoBruta | null,
): CanalDoCartao {
  const sigla = siglaDoNegocio(lead, contato);
  const doLead = lead.source_metadata ?? {};
  const doContato = contato?.source_metadata ?? {};
  let campanha: string | null = null;
  switch (sigla) {
    case "CAMPANHA":
      campanha = texto(doLead.campaign_name);
      break;
    case "ATIVO":
      campanha = campanhaDaDescricao(lead.description) ?? texto(doLead.campaign_name);
      break;
    case "FORM":
    case "META":
    case "GOOGLE":
    case "SITE":
    case "INDIC":
      campanha = campanhaDoMeta(doLead) ?? campanhaDoMeta(doContato);
      break;
    default:
      campanha = null;
  }
  return { sigla, campanha };
}
