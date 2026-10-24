/**
 * FORK MIA (.89) — O PÚBLICO de uma campanha de e-mail: o recorte virando
 * linhas, cada uma com o motivo de ficar de fora (ou nenhum).
 *
 * ── Reusa o recorte do upstream, e soma o nosso ──────────────────────────────
 *
 * Os critérios das Campanhas (etiqueta, funil, etapa, responsável, situação,
 * origem, interação, cadastro) são resolvidos por `buscarCandidatos`
 * (`lib/campanhas/consulta-de-audiencia.ts`), a MESMA função da prévia e do
 * snapshot do WhatsApp: duas implementações do mesmo filtro divergiriam. Por
 * cima entram a empresa e a campanha anterior, e as colunas que o e-mail precisa
 * (endereço, consentimento, empresa, dono da carteira), lidas em lotes.
 *
 * ── Uma montagem, três usos ──────────────────────────────────────────────────
 *
 * A contagem da tela, a gravação dos destinatários na confirmação e a
 * reavaliação antes do envio (`reavaliar`) passam pelas mesmas regras
 * (`elegibilidade.ts`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { buscarCandidatos } from "@/lib/campanhas/consulta-de-audiencia";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";

import { lerSupressoesDeEmail } from "./banco";
import { aceitouMedicao, consentimentoVigente, recusouMarketing } from "./consentimento";
import type { ResolvedoresDeDns } from "./dominio";
import { dominiosQueRecebem } from "./dns";
import {
  classificar,
  contar,
  type ContagemDoPublico,
  type ContatoParaEmail,
  type LinhaClassificada,
  type MotivoDaSupressao,
} from "./elegibilidade";
import { dominioDoEmail, emailComForma, hashDoEmail, normalizarEmail } from "./endereco";
import {
  paraFiltroDoUpstream,
  temCriterio,
  usaFiltroDoUpstream,
  type RecorteDoEmail,
} from "./recorte";
import { MESES_DE_CLIENTE_PARA_INTERESSE_LEGITIMO, type BaseLegal } from "./regras";

/** O teto de um público de e-mail. O do WhatsApp é 5.000; o e-mail anda por dias, no aquecimento. */
export const TETO_DO_PUBLICO = 50_000;

/** Ids por consulta `in (...)`: cabe na URL do PostgREST com folga. */
const LOTE = 150;

export interface ContatoDoPublico extends ContatoParaEmail {
  nome: string | null;
  empresaId: string | null;
  donoId: string | null;
  medirAbertura: boolean;
  campos: Record<string, unknown> | null;
}

export interface PublicoMontado {
  linhas: LinhaClassificada<ContatoDoPublico>[];
  contagem: ContagemDoPublico;
  truncado: boolean;
  semCriterio: boolean;
}

type Db = SupabaseClient;

async function emLotes<T>(
  ids: readonly string[],
  consulta: (lote: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const saida: T[] = [];
  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE);
    const { data, error } = await consulta(lote);
    if (error) throw new Error(error.message);
    saida.push(...((data ?? []) as T[]));
  }
  return saida;
}

/** Quem, da campanha anterior, teve o comportamento pedido. */
async function contatosDaCampanhaAnterior(
  db: Db,
  orgId: string,
  filtro: NonNullable<RecorteDoEmail["campanha_anterior"]>,
): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | null = null;
  for (let guarda = 0; guarda < 200; guarda += 1) {
    let q = db
      .from("mia_email_destinatarios")
      .select("id, contact_id, status, primeira_abertura_em, primeiro_clique_em, medir_abertura")
      .eq("organization_id", orgId)
      .eq("campanha_id", filtro.campanha_id)
      .not("contact_id", "is", null)
      .in("status", ["enviado", "entregue", "reclamacao"])
      .order("id", { ascending: true })
      .limit(1000);
    if (cursor) q = q.gt("id", cursor);
    const { data, error } = await q;
    if (error) throw new Error(`campanha anterior: ${error.message}`);
    const linhas = (data ?? []) as Array<{
      id: string;
      contact_id: string;
      primeira_abertura_em: string | null;
      primeiro_clique_em: string | null;
      medir_abertura: boolean;
    }>;
    if (linhas.length === 0) break;
    for (const l of linhas) {
      const entra =
        filtro.comportamento === "recebeu"
          ? true
          : filtro.comportamento === "clicou"
            ? !!l.primeiro_clique_em
            : filtro.comportamento === "abriu"
              ? !!l.primeira_abertura_em
              : // "recebeu e não abriu" só faz sentido onde a abertura foi medida.
                l.medir_abertura && !l.primeira_abertura_em && !l.primeiro_clique_em;
      if (entra) ids.add(l.contact_id);
    }
    cursor = linhas[linhas.length - 1]!.id;
  }
  return ids;
}

/** Os contatos que compraram nos últimos 24 meses: negócio ganho ou pedido pago. */
export async function clientesRecentes(
  db: Db,
  orgId: string,
  ids: readonly string[],
  agora: Date,
): Promise<Set<string>> {
  const limite = new Date(agora);
  limite.setUTCMonth(limite.getUTCMonth() - MESES_DE_CLIENTE_PARA_INTERESSE_LEGITIMO);
  const desde = limite.toISOString();
  const clientes = new Set<string>();
  const ganhos = await emLotes<{ contact_id: string }>(ids, (lote) =>
    db
      .from("crm_leads")
      .select("contact_id")
      .eq("organization_id", orgId)
      .eq("status", "won")
      .gte("closed_at", desde)
      .in("contact_id", lote),
  );
  ganhos.forEach((g) => clientes.add(g.contact_id));
  const pedidos = await emLotes<{ contact_id: string }>(ids, (lote) =>
    db
      .from("orders")
      .select("contact_id")
      .eq("organization_id", orgId)
      .in("status", ["paid", "fulfilled", "shipped", "delivered"])
      .gte("ordered_at", desde)
      .in("contact_id", lote),
  );
  pedidos.forEach((p) => p.contact_id && clientes.add(p.contact_id));
  return clientes;
}

interface LinhaDoContato {
  id: string;
  name: string | null;
  display_name: string | null;
  email: string | null;
  is_blocked: boolean;
  is_personal: boolean | null;
  is_anonymized: boolean;
  consent: unknown;
  empresa_id: string | null;
  carteira_user_id: string | null;
  custom_fields?: unknown;
}

const COLUNAS =
  "id, name, display_name, email, is_blocked, is_personal, is_anonymized, consent, empresa_id, carteira_user_id";

/** Os contatos com as colunas do e-mail, na ordem dos ids pedidos. */
export async function lerContatosDoEmail(
  db: Db,
  orgId: string,
  ids: readonly string[],
  opcoes: { campos?: boolean } = {},
): Promise<Map<string, LinhaDoContato>> {
  const colunas = opcoes.campos ? `${COLUNAS}, custom_fields` : COLUNAS;
  const linhas = await emLotes<LinhaDoContato>(ids, (lote) =>
    db
      .from("contacts")
      .select(colunas)
      .eq("organization_id", orgId)
      .eq("kind", "person")
      .is("is_merged_into", null)
      .in("id", lote),
  );
  return new Map(linhas.map((l) => [l.id, l]));
}

function paraContato(l: LinhaDoContato, clientes: ReadonlySet<string>): ContatoDoPublico {
  return {
    contactId: l.id,
    nome: nomeDoContato(l),
    email: l.email ? normalizarEmail(l.email) : null,
    bloqueado: l.is_blocked === true,
    pessoal: l.is_personal === true,
    anonimizado: l.is_anonymized === true,
    recusouMarketing: recusouMarketing(l.consent),
    consentiuEmail: consentimentoVigente(l.consent),
    clienteRecente: clientes.has(l.id),
    empresaId: l.empresa_id,
    donoId: l.carteira_user_id,
    medirAbertura: aceitouMedicao(l.consent),
    campos:
      l.custom_fields && typeof l.custom_fields === "object" && !Array.isArray(l.custom_fields)
        ? (l.custom_fields as Record<string, unknown>)
        : null,
  };
}

export interface DependenciasDoPublico {
  dns?: Pick<ResolvedoresDeDns, "resolveMx">;
  resolve4?: (n: string) => Promise<string[]>;
  /** Pula a pergunta ao DNS (a contagem rápida da tela pode pedir). */
  semDns?: boolean;
}

/** Monta o público inteiro de um recorte, com o motivo de cada um. */
export async function montarPublico(
  db: Db,
  entrada: {
    organizationId: string;
    recorte: RecorteDoEmail;
    base: BaseLegal;
    agora?: Date;
    lerCampos?: boolean;
    limite?: number;
  },
  deps: DependenciasDoPublico = {},
): Promise<PublicoMontado> {
  const agora = entrada.agora ?? new Date();
  const limite = Math.min(entrada.limite ?? TETO_DO_PUBLICO, TETO_DO_PUBLICO);
  const r = entrada.recorte;
  const vazio: PublicoMontado = {
    linhas: [],
    contagem: contar([]),
    truncado: false,
    semCriterio: true,
  };
  if (!temCriterio(r)) return vazio;

  // ─── 1. os ids do recorte ───
  let ids: string[];
  let truncado = false;
  const daCampanha = r.campanha_anterior
    ? await contatosDaCampanhaAnterior(db, entrada.organizationId, r.campanha_anterior)
    : null;
  if (usaFiltroDoUpstream(r) || !daCampanha) {
    // Só empresa como critério: o recorte do upstream sem filtro lê a empresa
    // inteira (até o teto) e a empresa é aplicada abaixo, em memória.
    const { candidatos, truncado: t } = await buscarCandidatos(db, {
      organizationId: entrada.organizationId,
      filtro: paraFiltroDoUpstream(r, limite + 1),
      agora,
    });
    truncado = t || candidatos.length > limite;
    ids = candidatos.slice(0, limite).map((c) => c.contactId);
    if (daCampanha) ids = ids.filter((id) => daCampanha.has(id));
  } else {
    ids = [...daCampanha];
    if (ids.length > limite) {
      truncado = true;
      ids = ids.slice(0, limite);
    }
  }

  // ─── 2. as colunas do e-mail ───
  const contatos = await lerContatosDoEmail(db, entrada.organizationId, ids, {
    campos: entrada.lerCampos,
  });
  let ordem = ids.filter((id) => contatos.has(id));
  if (r.empresa === "com") ordem = ordem.filter((id) => !!contatos.get(id)!.empresa_id);
  else if (r.empresa === "sem") ordem = ordem.filter((id) => !contatos.get(id)!.empresa_id);
  else if (r.empresa) ordem = ordem.filter((id) => contatos.get(id)!.empresa_id === r.empresa);

  const clientes =
    entrada.base === "legitimate_interest"
      ? await clientesRecentes(db, entrada.organizationId, ordem, agora)
      : new Set<string>();
  const lista = ordem.map((id) => paraContato(contatos.get(id)!, clientes));

  // ─── 3. supressão e domínios ───
  const suprimidos: Map<string, MotivoDaSupressao> = await lerSupressoesDeEmail(
    db,
    entrada.organizationId,
  );
  const dominios = deps.semDns
    ? new Map<string, boolean>()
    : await dominiosQueRecebem(
        lista.flatMap((c) => (c.email && emailComForma(c.email) ? [dominioDoEmail(c.email)] : [])),
        { dns: deps.dns, resolve4: deps.resolve4 },
      );

  const linhas = classificar(lista, {
    base: entrada.base,
    suprimidos,
    hashDoEmail,
    temForma: emailComForma,
    dominioRecebe: (e) => dominios.get(dominioDoEmail(e)) !== false,
  });
  return { linhas, contagem: contar(linhas), truncado, semCriterio: false };
}
