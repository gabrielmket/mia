/**
 * FORK MIA (.96, segunda frente) · O LADO DA TIME: QUEM SE CADASTROU E NÃO PAGOU
 * (Admin › Empresas do cadastro; protótipo "Pagamento no início", tela 4 e
 * decisão 5; docs/fork/area-de-cobranca.md).
 *
 *   - os números do topo: o funil dos últimos 30 dias (`fn_mia_funil_do_cadastro`, 9126);
 *   - a coluna "Situação do pagamento" de cada empresa (`./situacao-na-lista.ts`);
 *   - "Apagar o cadastro": SÓ depois de 30 dias sem nenhum pagamento, nunca
 *     sozinho, e a rota exige a verificação em duas etapas. Na ordem que não
 *     deixa nada pendurado:
 *       1. confere de novo, no servidor, que a empresa pode ser apagada e que o
 *          nome curto digitado é o dela;
 *       2. relê a cobrança no Asaas (paga agora? para tudo) e cancela a
 *          assinatura lá, para nada ficar cobrando;
 *       3. no banco (9126), troca a suspensão de cobrança por uma administrativa,
 *          com as mesmas conferências sob trava;
 *       4. chama a exclusão do UPSTREAM (`excluirOrganizacao`, 0614), que relê o
 *          provedor, apaga em cascata, desliga o que fala com o mundo, limpa os
 *          arquivos e os logins que eram só desta empresa.
 *     Interrompida depois do passo 3, uma nova tentativa retoma (a 9126 devolve
 *     `ja_preparada`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DependenciasDoAsaasDaMia } from "@/lib/asaas-mia/api";
import { codigoDoErro } from "@/lib/asaas-mia/api";
import { asaasDaMia } from "@/lib/asaas-mia/cobrancas";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { ExclusaoInterrompida, ExclusaoRecusada, excluirOrganizacao, type ResultadoDaExclusao } from "@/lib/tenants/exclusao";

import {
  DIAS_PARA_APAGAR,
  situacaoDoPagamentoNaLista,
  type AssinaturaParaALista,
  type PassoParaALista,
  type SituacaoDoPagamentoNaLista,
} from "./situacao-na-lista";

const COLUNAS_DA_ASSINATURA =
  "organization_id, pagamento_inicial_pendente, proximo_vencimento, periodo_pago_desde, provedor, provedor_assinatura_id, checkout_sessao_id, plano_id";
const COLUNAS_DO_PASSO =
  "organization_id, modo, situacao, forma, vence_em, gerada_em, cartao_recusas, pago_em, forma_paga, pagamento_ref, assinatura_ref";

type Assinatura = AssinaturaParaALista & {
  organization_id: string;
  provedor: string | null;
  provedor_assinatura_id: string | null;
  checkout_sessao_id: string | null;
  plano_id: string | null;
};
type Passo = PassoParaALista & { organization_id: string; pagamento_ref: string | null; assinatura_ref: string | null };

/** A situação do pagamento de cada empresa da lista. LANÇA na falha de leitura. */
export async function situacoesDoPagamento(
  admin: SupabaseClient,
  empresas: ReadonlyArray<{ id: string; entrou: string }>,
  agora: Date = new Date(),
): Promise<Map<string, SituacaoDoPagamentoNaLista>> {
  if (empresas.length === 0) return new Map();
  const [assinaturas, passos] = await Promise.all([
    admin.from("cobranca_assinaturas").select(COLUNAS_DA_ASSINATURA).limit(5000),
    admin.from("mia_pagamento_inicial").select(COLUNAS_DO_PASSO).limit(5000),
  ]);
  if (assinaturas.error) throw new Error(`assinaturas: leitura falhou (${assinaturas.error.code ?? "sem_codigo"})`);
  if (passos.error) throw new Error(`passo do pagamento: leitura falhou (${passos.error.code ?? "sem_codigo"})`);
  const assinaturaDe = new Map(((assinaturas.data ?? []) as Assinatura[]).map((a) => [a.organization_id, a]));
  const passoDe = new Map(((passos.data ?? []) as Passo[]).map((p) => [p.organization_id, p]));
  const mapa = new Map<string, SituacaoDoPagamentoNaLista>();
  for (const e of empresas) {
    const s = situacaoDoPagamentoNaLista({
      assinatura: assinaturaDe.get(e.id) ?? null,
      passo: passoDe.get(e.id) ?? null,
      criadaEm: e.entrou,
      agora,
    });
    if (s) mapa.set(e.id, s);
  }
  return mapa;
}

export interface FunilDoCadastro {
  escolheram_plano: number;
  criaram_conta: number;
  pagaram: number;
  esperando_pagamento: number;
  sem_pagamento_ha_mais_de_30_dias: number;
}

/** O funil dos últimos `dias` dias (padrão 30). `null` = não deu para contar (a tela diz). Nunca lança. */
export async function funilDoCadastro(admin: SupabaseClient, agora: Date = new Date(), dias = 30): Promise<FunilDoCadastro | null> {
  try {
    const desde = new Date(agora.getTime() - dias * 86_400_000).toISOString();
    const { data, error } = await admin.rpc("fn_mia_funil_do_cadastro", { p_desde: desde });
    if (error || !data) return null;
    const d = data as Record<string, unknown>;
    const n = (k: keyof FunilDoCadastro) => Number(d[k] ?? 0) || 0;
    return {
      escolheram_plano: n("escolheram_plano"),
      criaram_conta: n("criaram_conta"),
      pagaram: n("pagaram"),
      esperando_pagamento: n("esperando_pagamento"),
      sem_pagamento_ha_mais_de_30_dias: n("sem_pagamento_ha_mais_de_30_dias"),
    };
  } catch {
    return null;
  }
}

export type RecusaDoApagar = { ok: false; status: number; code: string; message: string };
const recusa = (status: number, code: string, message: string): RecusaDoApagar => ({ ok: false, status, code, message });

/** A frase de cada recusa do banco (9126). */
const FRASE_DO_BANCO: Record<string, string> = {
  nao_existe: "Esta empresa não existe mais.",
  demonstracao: "A empresa de demonstração não se apaga por aqui.",
  sem_assinatura: "Esta empresa não tem assinatura: não é um cadastro esperando pagamento.",
  nao_espera_pagamento: "Esta empresa não espera mais o primeiro pagamento.",
  ja_pagou: "Esta empresa já pagou. Nada foi apagado.",
  antes_do_prazo: "Só dá para apagar depois de 30 dias sem nenhum pagamento.",
  nao_esta_parada: "Esta empresa não está parada pela cobrança.",
  parada_pela_time: "Esta empresa foi parada pela Time por outro motivo: apague pelo painel da empresa.",
};

export interface DependenciasDoApagar {
  asaas?: DependenciasDoAsaasDaMia;
  agora?: () => Date;
  excluir?: typeof excluirOrganizacao;
}

/**
 * "Apagar o cadastro". `confirmacao` é o nome curto (slug) da empresa, digitado
 * por quem apaga. Quem chama já conferiu o admin da plataforma com a
 * verificação em duas etapas.
 */
export async function apagarCadastroSemPagamento(
  admin: SupabaseClient,
  p: { orgId: string; atorId: string; confirmacao: string; requestId: string },
  deps: DependenciasDoApagar = {},
): Promise<{ ok: true; resultado: ResultadoDaExclusao; dias: number } | RecusaDoApagar> {
  const agora = (deps.agora ?? (() => new Date()))();
  const [org, assinatura, passo] = await Promise.all([
    admin.from("organizations").select("id, slug, created_at, demonstracao").eq("id", p.orgId).maybeSingle(),
    admin.from("cobranca_assinaturas").select(COLUNAS_DA_ASSINATURA).eq("organization_id", p.orgId).maybeSingle(),
    admin.from("mia_pagamento_inicial").select(COLUNAS_DO_PASSO).eq("organization_id", p.orgId).maybeSingle(),
  ]);
  if (org.error || assinatura.error || passo.error) return recusa(500, "internal_error", "Não foi possível ler a empresa. Nada foi apagado.");
  const o = org.data as { id: string; slug: string; created_at: string; demonstracao: boolean | null } | null;
  if (!o) return recusa(404, "not_found", "Empresa não encontrada.");
  if (o.demonstracao) return recusa(409, "demonstracao", FRASE_DO_BANCO.demonstracao!);
  const a = (assinatura.data as Assinatura | null) ?? null;
  const linha = (passo.data as Passo | null) ?? null;
  const situacao = situacaoDoPagamentoNaLista({ assinatura: a, passo: linha, criadaEm: o.created_at, agora });
  if (!a || !situacao?.pode_apagar) {
    return recusa(409, "ainda_nao_pode", "Só dá para apagar o cadastro que espera o primeiro pagamento há mais de 30 dias, sem nenhum pagamento.");
  }
  if (p.confirmacao.trim() !== o.slug) {
    return recusa(400, "confirmacao_divergente", "A confirmação não confere com o nome curto da empresa.");
  }

  // 2. O Asaas: a cobrança foi paga agora? Senão, a assinatura sai de lá (nada fica cobrando).
  const sub = a.provedor_assinatura_id ?? linha?.assinatura_ref ?? null;
  const pay = linha?.pagamento_ref ?? (a.checkout_sessao_id?.startsWith("pay_") ? a.checkout_sessao_id : null);
  if (sub || pay) {
    try {
      const asaas = asaasDaMia(deps.asaas);
      if (pay) {
        const c = await asaas.lerCobranca(pay);
        if (c.situacao === "paga" || c.situacao === "em_analise") {
          return recusa(409, "ja_pagou", "O Asaas diz que esta cobrança foi paga agora. Nada foi apagado: confira a empresa.");
        }
      }
      if (sub) await asaas.cancelarAssinatura(sub);
      else if (pay) await asaas.cancelarCobranca(pay);
    } catch (e) {
      logger.warn("pagamento_inicial.apagar_sem_asaas", { organization_id: p.orgId, codigo: codigoDoErro(e) });
      return recusa(503, "provedor_indisponivel", "O Asaas não respondeu e a cobrança não foi cancelada lá. Nada foi apagado: tente de novo.");
    }
  }

  // 3. No banco: as mesmas conferências sob trava, e a suspensão vira administrativa.
  const { data: preparo, error: erroDoPreparo } = await admin.rpc("fn_mia_cadastro_sem_pagamento_para_apagar", {
    p_org: p.orgId,
    p_ator: p.atorId,
    p_dias: DIAS_PARA_APAGAR,
  });
  if (erroDoPreparo) {
    logger.warn("pagamento_inicial.apagar_preparo_falhou", { organization_id: p.orgId, codigo: erroDoPreparo.code ?? null });
    return recusa(500, "internal_error", "Não foi possível preparar a exclusão. Nada foi apagado: tente de novo.");
  }
  const r = (preparo ?? {}) as { pode?: boolean; motivo?: string };
  if (!r.pode) return recusa(409, r.motivo ?? "ainda_nao_pode", FRASE_DO_BANCO[r.motivo ?? ""] ?? "Esta empresa não pode ser apagada agora.");

  // 4. A exclusão do upstream, inteira.
  let resultado: ResultadoDaExclusao;
  try {
    resultado = await (deps.excluir ?? excluirOrganizacao)(admin, {
      orgId: p.orgId,
      atorId: p.atorId,
      confirmacao: o.slug,
      motivo: `Cadastro sem pagamento há ${situacao.dias} dias: apagado pela Time em Empresas do cadastro.`,
      requestId: p.requestId,
    });
  } catch (err) {
    if (err instanceof ExclusaoRecusada) return recusa(409, err.codigo, err.message);
    if (err instanceof ExclusaoInterrompida) {
      logger.error("pagamento_inicial.apagar_interrompido", { organization_id: p.orgId, erro: err.message });
      return recusa(
        500,
        "internal_error",
        "A exclusão pode já ter sido confirmada no banco, mas a limpeza não terminou. Tente de novo: a nova tentativa retoma de onde parou.",
      );
    }
    logger.error("pagamento_inicial.apagar_falhou", { organization_id: p.orgId, erro: err instanceof Error ? err.message : String(err) });
    return recusa(500, "internal_error", "A exclusão não foi concluída. Tente de novo.");
  }
  void audit({
    action: "pagamento_inicial.cadastro_apagado",
    actorUserId: p.atorId,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    // A empresa não existe mais: a linha é achada pelo `resource_id`, como a lápide do upstream.
    organizationId: null,
    resourceType: "organization",
    resourceId: p.orgId,
    requestId: p.requestId,
    metadata: { dias: situacao.dias, plano_id: a.plano_id, forma: situacao.forma, cobranca_cancelada: Boolean(sub || pay) },
  });
  return { ok: true, resultado, dias: situacao.dias };
}
