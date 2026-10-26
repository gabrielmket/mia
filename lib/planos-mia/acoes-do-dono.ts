/**
 * FORK MIA (.90) — as ações do card Cobrança do dono, para o MCP de plataforma
 * (`plataforma_atribuir_plano`, `plataforma_ajustar_cobranca`).
 *
 * ESPELHO das rotas do upstream (`app/api/v1/admin/tenants/[id]/assinatura/route.ts`
 * POST/PATCH/DELETE e `.../assinatura/prazo/route.ts`), que guardam a lógica
 * dentro do handler. A troca de plano é a MESMA função (`trocarPlanoDaOrg`,
 * origem "dono": depois do teste fica agendada, plano negociado não paga
 * diferença); atribuir, isentar e dar prazo seguem a rota passo a passo. A
 * cerca `mcp-de-implantacao-espelhos` reprova quando uma dessas rotas muda,
 * para alguém reler este arquivo. Depois de cada ação que mexe no plano, os
 * módulos seguem (`seguirOPlano`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { lerOrgDoTenant, lerPlano, reativarSeSuspensaPorCobranca } from "@/lib/cobranca/dono";
import { adaptador } from "@/lib/cobranca/provedores";
import { excedenteDoPlano, lerUsoDaOrganizacao } from "@/lib/cobranca/uso";
import { trocarPlanoDaOrg } from "@/lib/cobranca/troca";
import type { ProvedorDeCobranca } from "@/lib/cobranca/vocabulario";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { logger } from "@/lib/logger";

import { seguirOPlano } from "./seguir-o-plano";

const DIA_MS = 86_400_000;
const PRAZO_MAXIMO_MS = 60 * DIA_MS;

export type ResultadoDoDono =
  | { ok: true; [k: string]: unknown }
  | { ok: false; code: string; message: string; details?: unknown };

interface Ator {
  userId: string;
  tokenId: string | null;
  requestId: string | null;
}

const recusa = (code: string, message: string, details?: unknown): ResultadoDoDono => ({
  ok: false,
  code,
  message,
  ...(details === undefined ? {} : { details }),
});

function auditar(
  ator: Ator,
  orgId: string,
  action: "cobranca.plano_trocado" | "cobranca.isencao_definida" | "cobranca.prazo_concedido",
  metadata: Record<string, unknown>,
) {
  void audit({
    action,
    actorUserId: ator.userId,
    actorApiTokenId: ator.tokenId,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: orgId,
    resourceType: "cobranca_assinatura",
    resourceId: orgId,
    requestId: ator.requestId,
    metadata: { ...metadata, via: "mcp_de_plataforma" },
  });
}

/**
 * Atribui o plano à empresa isenta (nasce em teste com os dias do plano) ou
 * troca o de quem já tem (a regra do dono do upstream). Aceita plano escondido.
 * Recusa com a lista do que tirar quando o uso não cabe.
 */
export async function atribuirOuTrocarPlano(
  admin: SupabaseClient,
  orgId: string,
  planoId: string,
  ator: Ator,
): Promise<ResultadoDoDono> {
  if (!(await moduloLigado(admin, "cobranca"))) {
    return recusa(
      "cobranca_desligada",
      "A cobrança está desligada nesta instalação: toda empresa é isenta. Ligue em Admin › Recursos opcionais antes.",
    );
  }
  const org = await lerOrgDoTenant(admin, orgId);
  if (org === "erro") throw new Error("empresa ilegível");
  if (!org)
    return recusa(
      "not_found",
      "Empresa não encontrada. Use plataforma_listar_clientes para achar o id.",
    );
  const plano = await lerPlano(admin, planoId);
  if (plano === "erro") throw new Error("plano ilegível");
  if (!plano || plano.arquivado_em !== null)
    return recusa(
      "plano_invalido",
      "Plano não encontrado ou arquivado. Veja os planos em plataforma_ver_cobranca.",
    );

  const { data: tem, error: erroDaLeitura } = await admin
    .from("cobranca_assinaturas")
    .select("organization_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (erroDaLeitura) throw new Error("assinatura ilegível");

  if (!tem) {
    // A rota do upstream atribui sem medir o uso; aqui a mesma recusa da troca
    // ensina antes (o gatilho de assentos recusaria o próximo convite de qualquer jeito).
    const uso = await lerUsoDaOrganizacao(admin, orgId);
    if (uso) {
      const excedente = excedenteDoPlano(uso, plano);
      if (Object.keys(excedente).length > 0) {
        return recusa("uso_acima_do_plano", "O uso atual não cabe no plano escolhido.", {
          o_que_tirar: excedente,
        });
      }
    }
    const { error } = await admin.from("cobranca_assinaturas").insert({
      organization_id: orgId,
      plano_id: plano.id,
      estado: "trial",
      trial_ate: new Date(Date.now() + plano.trial_dias * DIA_MS).toISOString(),
    });
    if (error?.code === "23505")
      return recusa(
        "state_conflict",
        "A empresa ganhou assinatura no meio. Tente de novo: agora é troca.",
      );
    if (error) throw new Error(`plano não atribuído (${error.code ?? "sem_codigo"})`);
    auditar(ator, orgId, "cobranca.plano_trocado", {
      de: null,
      para: plano.id,
      quando: "atribuido",
    });
    const modulos = await seguirOPlano(admin, orgId, "atribuicao");
    return {
      ok: true,
      quando: "atribuido",
      teste_dias: plano.trial_dias,
      modulos_mudaram: modulos,
    };
  }

  const r = await trocarPlanoDaOrg(admin, orgId, plano.id, { origem: "dono" });
  if (!r.ok) {
    const excedente = (r.details as { excedente?: unknown } | undefined)?.excedente;
    return r.code === "plan_limit_reached"
      ? recusa("uso_acima_do_plano", r.message, { o_que_tirar: excedente })
      : recusa(r.code, r.message, r.details);
  }
  if (r.changed)
    auditar(ator, orgId, "cobranca.plano_trocado", { de: r.de, para: plano.id, quando: r.quando });
  const modulos = await seguirOPlano(admin, orgId, "troca");
  return {
    ok: true,
    quando: r.quando === "imediato" ? "agora" : r.quando,
    mudou: r.changed,
    vale_a_partir_de: r.valeAPartirDe,
    modulos_mudaram: modulos,
  };
}

/** Dar prazo até uma data (até 60 dias): reativa na hora quem foi suspenso por falta de pagamento. */
export async function darPrazo(
  admin: SupabaseClient,
  orgId: string,
  ate: Date,
  ator: Ator,
): Promise<ResultadoDoDono> {
  const agora = Date.now();
  if (!(ate.getTime() > agora && ate.getTime() <= agora + PRAZO_MAXIMO_MS)) {
    return recusa("validation_failed", "O prazo precisa estar entre agora e 60 dias.");
  }
  const org = await lerOrgDoTenant(admin, orgId);
  if (org === "erro") throw new Error("empresa ilegível");
  if (!org) return recusa("not_found", "Empresa não encontrada.");
  const { data: linha, error } = await admin
    .from("cobranca_assinaturas")
    .update({ prazo_extra_ate: ate.toISOString(), updated_at: new Date(agora).toISOString() })
    .eq("organization_id", orgId)
    .select("organization_id")
    .maybeSingle();
  if (error) throw new Error(`prazo não gravado (${error.code ?? "sem_codigo"})`);
  if (!linha)
    return recusa(
      "not_found",
      "Esta empresa não tem assinatura (é isenta): não há o que prorrogar.",
    );
  const reativacao = await reativarSeSuspensaPorCobranca(admin, org, ator.userId);
  auditar(ator, orgId, "cobranca.prazo_concedido", {
    ate: ate.toISOString(),
    reativada: reativacao?.reativada ?? false,
  });
  if (!reativacao)
    return recusa("internal_error", "O prazo foi gravado, mas a reativação falhou. Tente de novo.");
  return { ok: true, prazo_ate: ate.toISOString(), reativada: reativacao.reativada };
}

/** Tornar isenta: só sem assinatura viva no provedor; reativa quem foi suspenso por cobrança. */
export async function tornarIsenta(
  admin: SupabaseClient,
  orgId: string,
  ator: Ator,
): Promise<ResultadoDoDono> {
  const org = await lerOrgDoTenant(admin, orgId);
  if (org === "erro") throw new Error("empresa ilegível");
  if (!org) return recusa("not_found", "Empresa não encontrada.");
  const { data: lida, error: erroDeLeitura } = await admin
    .from("cobranca_assinaturas")
    .select("plano_id, provedor, provedor_cliente_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (erroDeLeitura) throw new Error("assinatura ilegível");
  const linha = lida as {
    plano_id: string;
    provedor: ProvedorDeCobranca | null;
    provedor_cliente_id: string | null;
  } | null;
  let apagada: { plano_id: string } | null = null;
  if (linha) {
    let alvo: { provedor: ProvedorDeCobranca; clienteId: string } | null = null;
    if (linha.provedor && linha.provedor_cliente_id) {
      let vivas: number;
      try {
        vivas = (
          await adaptador(linha.provedor).lerSituacao({ clienteRef: linha.provedor_cliente_id })
        ).assinaturasVivas;
      } catch (e) {
        logger.warn("cobranca.isencao_sem_leitura", {
          organization_id: orgId,
          erro: e instanceof Error ? e.message : "desconhecido",
        });
        return recusa(
          "provedor_indisponivel",
          "Não foi possível confirmar com o provedor se ainda há cobrança. Nada foi apagado; tente de novo.",
        );
      }
      if (vivas > 0) {
        return recusa(
          "assinatura_viva_no_provedor",
          "Esta empresa ainda tem assinatura ativa no provedor de pagamento. Cancele lá antes de isentar.",
        );
      }
      alvo = { provedor: linha.provedor, clienteId: linha.provedor_cliente_id };
    }
    const base = admin.from("cobranca_assinaturas").delete().eq("organization_id", orgId);
    const { data, error } = await (
      alvo
        ? base.eq("provedor", alvo.provedor).eq("provedor_cliente_id", alvo.clienteId)
        : base.is("provedor", null)
    )
      .select("plano_id")
      .maybeSingle();
    if (error) throw new Error(`isenção não gravada (${error.code ?? "sem_codigo"})`);
    if (!data) return recusa("state_conflict", "A assinatura mudou no meio. Tente de novo.");
    apagada = data as { plano_id: string };
  }
  const reativacao = await reativarSeSuspensaPorCobranca(admin, org, ator.userId);
  if (apagada || reativacao?.reativada) {
    auditar(ator, orgId, "cobranca.isencao_definida", {
      plano_id: apagada?.plano_id ?? null,
      reativada: reativacao?.reativada ?? false,
    });
  }
  if (!reativacao)
    return recusa("internal_error", "A reativação da empresa falhou. Tente de novo.");
  const modulos = await seguirOPlano(admin, orgId, "isencao");
  return {
    ok: true,
    mudou: !!apagada || reativacao.reativada,
    reativada: reativacao.reativada,
    modulos_mudaram: modulos,
  };
}
