/**
 * FORK MIA (.89) — A LISTA DE SUPRESSÃO de e-mail: entrar é fácil, sair só pela
 * própria pessoa.
 *
 * Mora na lista do upstream (`campaign_suppressions`), estendida pela 9063 com
 * `tipo_de_endereco = 'email'` e `motivo`. Guarda o hash do endereço e o começo
 * dele para a tela (`an•••@example.com`); a anonimização do contato apaga o
 * legível e mantém o hash — o veto sobrevive.
 *
 * Quem está aqui não recebe e-mail de marketing de novo, em nenhuma campanha.
 * Ninguém tira um endereço pela tela: o banco recusa (9063), e a única saída é
 * `voltarAReceber`, chamada só pela página de preferências da própria pessoa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { MotivoDaSupressao } from "./elegibilidade";
import { emailComForma, hashDoEmail, mascararEmail, normalizarEmail } from "./endereco";
import { ROTULO_DA_SUPRESSAO } from "./rotulos";

export { ROTULO_DA_SUPRESSAO };

/** A coluna `source` do upstream: manual, import ou sistema. */
function origemDoUpstream(motivo: MotivoDaSupressao): "manual" | "import" | "sistema" {
  if (motivo === "importada") return "import";
  if (motivo === "manual") return "manual";
  return "sistema";
}

export interface PedidoDeSupressao {
  organizationId: string;
  email?: string | null;
  /** Quando o endereço legível já não existe (anonimizado), só o hash. */
  hash?: string;
  motivo: MotivoDaSupressao;
  /** De onde veio, em texto ("Link do rodapé · Novidades de outubro"). Sai na anonimização. */
  deOnde: string | null;
  contactId?: string | null;
  criadoPor?: string | null;
}

/**
 * Acrescenta (ou mantém) o endereço na lista. Idempotente: o mesmo endereço não
 * entra duas vezes, e uma linha que já está lá não muda de motivo.
 */
export async function suprimirEmail(
  db: SupabaseClient,
  p: PedidoDeSupressao,
): Promise<{ entrou: boolean; hash: string }> {
  const email = p.email ? normalizarEmail(p.email) : null;
  const hash = p.hash ?? (email ? hashDoEmail(email) : null);
  if (!hash) throw new Error("supressão sem endereço");
  const { data, error } = await db
    .from("campaign_suppressions")
    .upsert(
      {
        organization_id: p.organizationId,
        contact_id: p.contactId ?? null,
        recipient_address_hash: hash,
        address_tail: email ? mascararEmail(email) : null,
        reason: p.deOnde ? p.deOnde.slice(0, 200) : null,
        source: origemDoUpstream(p.motivo),
        tipo_de_endereco: "email",
        motivo: p.motivo,
        created_by: p.criadoPor ?? null,
      },
      { onConflict: "organization_id,recipient_address_hash", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(`não consegui acrescentar à supressão: ${error.message}`);
  return { entrou: (data ?? []).length > 0, hash };
}

export interface ResultadoDaImportacao {
  lidas: number;
  acrescentadas: number;
  ja_estavam: number;
  recusadas: Array<{ linha: number; motivo: string }>;
}

/** Importa uma lista de descadastros da ferramenta anterior. Só acrescenta, nunca tira. */
export async function importarSupressao(
  db: SupabaseClient,
  entrada: {
    organizationId: string;
    enderecos: readonly string[];
    deOnde: string;
    criadoPor: string | null;
  },
): Promise<ResultadoDaImportacao> {
  const r: ResultadoDaImportacao = {
    lidas: entrada.enderecos.length,
    acrescentadas: 0,
    ja_estavam: 0,
    recusadas: [],
  };
  const vistos = new Set<string>();
  for (let i = 0; i < entrada.enderecos.length; i += 1) {
    const bruto = entrada.enderecos[i] ?? "";
    const email = normalizarEmail(bruto);
    if (!emailComForma(email)) {
      r.recusadas.push({ linha: i + 1, motivo: "não parece um endereço de e-mail" });
      continue;
    }
    const hash = hashDoEmail(email);
    if (vistos.has(hash)) {
      r.ja_estavam += 1;
      continue;
    }
    vistos.add(hash);
    const { entrou } = await suprimirEmail(db, {
      organizationId: entrada.organizationId,
      email,
      motivo: "importada",
      deOnde: entrada.deOnde,
      criadoPor: entrada.criadoPor,
    });
    if (entrou) r.acrescentadas += 1;
    else r.ja_estavam += 1;
  }
  return r;
}

export interface LinhaDaSupressao {
  id: string;
  endereco: string | null;
  motivo: MotivoDaSupressao;
  deOnde: string | null;
  quando: string;
}

export async function listarSupressao(
  db: SupabaseClient,
  entrada: {
    organizationId: string;
    motivo?: MotivoDaSupressao | null;
    busca?: string | null;
    limite?: number;
  },
): Promise<{ linhas: LinhaDaSupressao[]; total: number; porMotivo: Record<string, number> }> {
  let q = db
    .from("campaign_suppressions")
    .select("id, address_tail, motivo, reason, created_at", { count: "exact" })
    .eq("organization_id", entrada.organizationId)
    .eq("tipo_de_endereco", "email")
    .order("created_at", { ascending: false })
    .limit(entrada.limite ?? 50);
  if (entrada.motivo) q = q.eq("motivo", entrada.motivo);
  if (entrada.busca?.trim()) {
    // A busca é pelo hash do endereço INTEIRO: a lista não guarda o endereço legível.
    const e = normalizarEmail(entrada.busca);
    q = emailComForma(e)
      ? q.eq("recipient_address_hash", hashDoEmail(e))
      : q.ilike("address_tail", `%${e.replace(/[%_]/g, "")}%`);
  }
  const { data, error, count } = await q;
  if (error) throw new Error(`não consegui ler a supressão: ${error.message}`);
  const porMotivo: Record<string, number> = {};
  await Promise.all(
    (Object.keys(ROTULO_DA_SUPRESSAO) as MotivoDaSupressao[]).map(async (m) => {
      const { count: n } = await db
        .from("campaign_suppressions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", entrada.organizationId)
        .eq("tipo_de_endereco", "email")
        .eq("motivo", m);
      porMotivo[m] = n ?? 0;
    }),
  );
  return {
    total: count ?? 0,
    porMotivo,
    linhas: ((data ?? []) as Array<Record<string, unknown>>).map((l) => ({
      id: String(l.id),
      endereco: (l.address_tail as string | null) ?? null,
      motivo: ((l.motivo as MotivoDaSupressao | null) ?? "manual") as MotivoDaSupressao,
      deOnde: (l.reason as string | null) ?? null,
      quando: String(l.created_at),
    })),
  };
}

/** A única porta de saída, e só para a própria pessoa (9064). Não tira rejeição. */
export async function voltarAReceber(
  db: SupabaseClient,
  orgId: string,
  hash: string,
): Promise<number> {
  const { data, error } = await db.rpc("fn_mia_email_voltar_a_receber", {
    p_org: orgId,
    p_hash: hash,
  });
  if (error) throw new Error(`não consegui voltar a receber: ${error.message}`);
  return Number(data ?? 0);
}

/** O endereço está suprimido? E por quê. */
export async function supressaoDoEmail(
  db: SupabaseClient,
  orgId: string,
  hash: string,
): Promise<{ motivo: MotivoDaSupressao; quando: string; deOnde: string | null } | null> {
  const { data, error } = await db
    .from("campaign_suppressions")
    .select("motivo, created_at, reason")
    .eq("organization_id", orgId)
    .eq("tipo_de_endereco", "email")
    .eq("recipient_address_hash", hash)
    .maybeSingle();
  if (error) throw new Error(`supressão: ${error.message}`);
  if (!data) return null;
  const d = data as Record<string, unknown>;
  return {
    motivo: ((d.motivo as MotivoDaSupressao | null) ?? "manual") as MotivoDaSupressao,
    quando: String(d.created_at),
    deOnde: (d.reason as string | null) ?? null,
  };
}
