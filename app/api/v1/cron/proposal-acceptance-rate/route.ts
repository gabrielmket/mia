import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { traduzir } from "@/lib/i18n/dicionario";
import { idiomaDoAviso, preencher } from "@/lib/i18n/idioma-do-aviso";
import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";
import { logger } from "@/lib/logger";
import { empresasComModuloDesligado, modulosLigados, type ModuloOpcional } from "@/lib/instalacao/modulos";
import { capacidadesLigadas } from "@/lib/organizacao/capacidades";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const PISO_DE_ACEITE = 0.3;
const MINIMO_DE_DECISOES = 5; // abaixo disso, 30% de 1 proposta não significa nada
/**
 * FORK MIA (MIA-367) — as duas leituras da rodada são lidas INTEIRAS, página a
 * página (`lerTodasAsPaginas`), na ordem de `id`. Em 28/11/2026 a produção
 * tinha 18 empresas e 0 propostas enviadas nos últimos 30 dias: folga larga.
 */
const PAGINAS_DAS_EMPRESAS = 20;
/** As propostas enviadas em 30 dias por UMA empresa: até 20 mil. */
const PAGINAS_DAS_PROPOSTAS = 20;

export function calcularTaxaDeAceite(propostas: readonly { status: string }[]): number | null {
  const decididas = propostas.filter((p) => p.status === "aceita" || p.status === "recusada");
  if (decididas.length < MINIMO_DE_DECISOES) return null;
  const aceitas = decididas.filter((p) => p.status === "aceita").length;
  return aceitas / decididas.length;
}

export interface TaxaDeAceiteResult { organizacoes_avisadas: number }

/**
 * Só as organizações que ligaram Propostas entram na rodada do laço de retorno.
 *
 * Job GLOBAL (#4871): a rodada lê todas as empresas e responde por cada uma. A
 * organização entra quando as DUAS chaves dizem sim — a capacidade dela em
 * `settings` e o módulo que a instalação resolve — e quando ela não está em
 * `desligadas`, a lista das que têm linha `desligado` na camada por empresa
 * (`organization_modules`). Sem linha, a empresa herda a instalação; com a
 * instalação desligada, ninguém entra, nem quem tem linha `ligado`.
 *
 * `desligadas === null` é leitura que falhou, não "ninguém desligou": a rodada
 * não avisa ninguém (o `rodar` transforma isso em 500).
 */
export function organizacoesComPropostas(
  orgs: { id: string; settings: unknown }[],
  modulos: readonly ModuloOpcional[],
  desligadas: ReadonlySet<string> | null = new Set(),
): string[] {
  if (desligadas === null) return [];
  return orgs
    .filter((o) => !desligadas.has(o.id))
    .filter((o) => capacidadesLigadas(o.settings, modulos).includes("propostas"))
    .map((o) => o.id);
}

async function rodar(admin: ReturnType<typeof createAdminClient>, requestId: string): Promise<TaxaDeAceiteResult> {
  const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  // FORK MIA (MIA-367) — todas as empresas, lidas inteiras. Antes era uma
  // leitura só, cortada em 1000 linhas pelo PostgREST sem aviso: a empresa que
  // ficava fora da página nunca tinha a taxa conferida. Cortada, a rodada falha
  // fechada (500) em vez de tratar metade como tudo.
  const lidasEmpresas = await lerTodasAsPaginas<{ id: string; settings: unknown }>(
    (de, ate, pedirContagem) =>
      admin
        .from("organizations")
        .select("id, settings", pedirContagem ? { count: "exact" } : undefined)
        .order("id", { ascending: true })
        .range(de, ate),
    { paginasMaximas: PAGINAS_DAS_EMPRESAS },
  );
  if (lidasEmpresas.erro) throw new Error(`query_orgs_failed: ${lidasEmpresas.erro}`);
  if (lidasEmpresas.truncado) {
    throw new Error(`query_orgs_truncada: mais de ${lidasEmpresas.linhas.length} empresas`);
  }
  const orgs = lidasEmpresas.linhas;

  // A camada POR EMPRESA (#4871), uma leitura para a rodada inteira: o cron não
  // tem "a empresa do request", então a decisão de cada uma é resolvida aqui, uma
  // vez, e o laço abaixo só consulta o conjunto. Sem isto, a empresa que desligou
  // `propostas` na tela de Módulos por empresa continuava recebendo o aviso — a
  // instalação ligada vencia a linha dela.
  // Com a instalação desligada ninguém entra, e a leitura por empresa não mudaria
  // a resposta: ela só acontece quando pode tirar alguém (mesma régua do tick).
  const modulos = await modulosLigados(admin);
  const desligadas = modulos.includes("propostas")
    ? await empresasComModuloDesligado(admin, "propostas")
    : new Set<string>();
  // Falha de leitura fecha: um aviso a menos é reversível na próxima rodada; um
  // aviso para quem desligou o módulo é ruído que ninguém pediu.
  if (desligadas === null) throw new Error("query_modulos_failed: organization_modules ilegível");

  let avisadas = 0;
  for (const orgId of organizacoesComPropostas(orgs, modulos, desligadas)) {
    const org = { id: orgId };
    // FORK MIA (MIA-367) — as propostas de 30 dias da empresa, TODAS. Cortada
    // em 1000 linhas, a taxa saía de um recorte (as mais antigas, pela ordem
    // física) e o aviso de queda vinha ou faltava errado.
    const lidas = await lerTodasAsPaginas<{ status: string }>(
      (de, ate, pedirContagem) =>
        admin
          .from("crm_proposals")
          .select("status", pedirContagem ? { count: "exact" } : undefined)
          .eq("organization_id", org.id)
          .gte("sent_at", trintaDiasAtras)
          .not("sent_at", "is", null)
          .order("id", { ascending: true })
          .range(de, ate),
      { paginasMaximas: PAGINAS_DAS_PROPOSTAS },
    );
    if (lidas.erro) {
      logger.error("[proposal-acceptance-rate] query falhou", { error: lidas.erro, organization_id: org.id, requestId });
      continue;
    }
    // Recorte não é taxa: a empresa fica de fora desta rodada, como na falha
    // de leitura logo acima (um aviso a menos se corrige na próxima rodada).
    if (lidas.truncado) {
      logger.error("[proposal-acceptance-rate] leitura cortada", {
        lidas: lidas.linhas.length, organization_id: org.id, requestId,
      });
      continue;
    }

    const taxa = calcularTaxaDeAceite(lidas.linhas);
    if (taxa === null || taxa >= PISO_DE_ACEITE) continue;

    const { data: existente } = await admin
      .from("agent_inbox_items")
      .select("id")
      .eq("organization_id", org.id)
      .eq("kind", "proposal_acceptance_rate_drop")
      .eq("status", "open")
      .maybeSingle();
    if (!existente) {
      // A Central mostra o texto como foi gravado: o aviso nasce no idioma da organização.
      const idioma = await idiomaDoAviso(admin, org.id);
      const { error: inboxErr } = await admin.from("agent_inbox_items").insert({
        organization_id: org.id, kind: "proposal_acceptance_rate_drop", severity: "warn",
        title: traduzir("A taxa de aceite de propostas caiu", idioma),
        body: preencher(
          traduzir("{taxa}% das propostas decididas nos últimos 30 dias foram aceitas — abaixo do piso de {piso}%.", idioma),
          { taxa: Math.round(taxa * 100), piso: Math.round(PISO_DE_ACEITE * 100) },
        ),
      });
      if (inboxErr) {
        logger.error("[proposal-acceptance-rate] aviso na Central falhou", { error: inboxErr.message, organization_id: org.id, requestId });
        continue;
      }
      avisadas++;
    }
  }
  return { organizacoes_avisadas: avisadas };
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  let result: TaxaDeAceiteResult;
  try {
    result = await rodar(createAdminClient(), requestId);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("[proposal-acceptance-rate] falhou", { error: detail, requestId });
    return fail("internal_error", "Failed to check acceptance rate.", 500, { requestId });
  }

  if (result.organizacoes_avisadas > 0) {
    void audit({
      action: "proposal.acceptance_rate_batch", organizationId: null, bypassedRls: true,
      metadata: result as unknown as Record<string, unknown>, requestId,
    });
  }
  return ok(result, { requestId });
}

export async function GET(req: NextRequest): Promise<Response> { return handle(req); }
export async function POST(req: NextRequest): Promise<Response> { return handle(req); }
