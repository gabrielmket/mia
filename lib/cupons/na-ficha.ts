/**
 * FORK MIA (.98) · O CUPOM E O PARCEIRO NA FICHA DA EMPRESA (lado da Time;
 * decisão 5 do protótipo; docs/fork/cupons-e-parceiros.md).
 *
 * O cliente fica ligado ao parceiro pelo cupom da primeira mensalidade, e isso
 * não muda sozinho. Depois de pago, trocar o cupom ou o parceiro é da Time, na
 * ficha da empresa (Admin › Tenants), com a verificação em duas etapas e o Audit
 * Log: a rota confere; aqui mora a regra. A mesma leitura alimenta
 * `plataforma_ver_cliente` no MCP. Sem documento nem Pix do parceiro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { lerParceiro } from "@/lib/parceiros/banco";
import { lerSetupDaEmpresa } from "@/lib/setup-de-implantacao/servico";

import { aplicarCupomNaEmpresa, lerCupomDaEmpresa } from "./banco";
import { garantirDescontoNoAsaas } from "./desconto-no-asaas";
import { fraseDoMotivo, textoDoBeneficio, textoDoSetup } from "./regras";

export interface CupomEParceiroDaEmpresa {
  cupom: {
    codigo: string;
    beneficio: string;
    /** O que dá, em palavras. */
    o_que_da: string;
    setup: string;
    origem: string;
    aplicado_em: string;
    dias_aplicados: number | null;
    desconto_encerrado_em: string | null;
  } | null;
  parceiro: {
    id: string;
    nome: string;
    desde: string;
    comissao_pct: number | null;
    comissao_meses: number | null;
    comissao_setup_pct: number | null;
    termos_fixados_em: string | null;
    primeira_mensalidade_em: string | null;
  } | null;
  setup: { situacao: string; valor_cents: number; preco_cents: number; pago_em: string | null; nota_ref: string | null; nota_erro: string | null; link: string | null } | null;
  comissoes: { lancadas: number; total_cents: number };
}

/** A leitura da ficha e do MCP. LANÇA na falha (quem chama diz "não lido"). */
export async function lerCupomEParceiroDaEmpresa(admin: SupabaseClient, orgId: string): Promise<CupomEParceiroDaEmpresa> {
  const [uso, setup, comissoes] = await Promise.all([
    lerCupomDaEmpresa(admin, orgId),
    lerSetupDaEmpresa(admin, orgId),
    admin.from("mia_comissoes").select("comissao_cents").eq("organization_id", orgId).limit(5000),
  ]);
  if (comissoes.error) throw new Error(`cupons: comissões ilegíveis (${comissoes.error.code ?? "sem_codigo"})`);
  const linhas = (comissoes.data ?? []) as Array<{ comissao_cents: number }>;
  const parceiro = uso?.parceiro_id ? await lerParceiro(admin, uso.parceiro_id) : null;
  return {
    cupom: uso
      ? {
          codigo: uso.codigo,
          beneficio: uso.beneficio,
          o_que_da: textoDoBeneficio(uso),
          setup: textoDoSetup(uso),
          origem: uso.origem,
          aplicado_em: uso.aplicado_em,
          dias_aplicados: uso.dias_aplicados,
          desconto_encerrado_em: uso.desconto_encerrado_em,
        }
      : null,
    parceiro:
      uso && parceiro
        ? {
            id: parceiro.id,
            nome: parceiro.nome,
            desde: uso.parceiro_desde,
            comissao_pct: uso.comissao_pct,
            comissao_meses: uso.comissao_meses,
            comissao_setup_pct: uso.comissao_setup_pct,
            termos_fixados_em: uso.termos_fixados_em,
            primeira_mensalidade_em: uso.primeira_mensalidade_em,
          }
        : null,
    setup: setup
      ? {
          situacao: setup.situacao,
          valor_cents: setup.valor_cents,
          preco_cents: setup.preco_cents,
          pago_em: setup.pago_em,
          nota_ref: setup.nota_ref,
          nota_erro: setup.nota_erro,
          // O link da cobrança em aberto: a Time também vende o setup por link (decisão 10).
          link: setup.situacao === "aguardando" ? setup.fatura_url : null,
        }
      : null,
    comissoes: { lancadas: linhas.length, total_cents: linhas.reduce((s, l) => s + Number(l.comissao_cents), 0) },
  };
}

export type ResultadoDaFicha = { ok: true; mudou: boolean } | { ok: false; status: number; code: string; message: string };

/**
 * A Time põe ou troca o cupom da empresa, mesmo depois de pago. O desconto vai ao
 * Asaas na hora (a próxima cobrança em aberto e a assinatura). Dias grátis só
 * valem para quem nunca pagou e ainda não tem assinatura no Asaas.
 */
export async function trocarCupomPelaTime(
  admin: SupabaseClient,
  p: { orgId: string; codigo: unknown; ator: string; requestId: string },
): Promise<ResultadoDaFicha> {
  const antes = await lerCupomDaEmpresa(admin, p.orgId);
  const r = await aplicarCupomNaEmpresa(admin, { orgId: p.orgId, codigo: p.codigo, origem: "time", ator: p.ator });
  if (!r.ok) return { ok: false, status: 422, code: `cupom_${r.motivo}`, message: fraseDoMotivo(r.motivo, { codigo: r.codigo, data: r.valeAte ?? null }) };
  if (r.jaEstava) return { ok: true, mudou: false };
  await garantirDescontoNoAsaas(admin, p.orgId);
  void audit({
    action: "cupom.trocado_pela_time",
    actorUserId: p.ator,
    actingAsPlatformAdmin: true,
    organizationId: p.orgId,
    resourceType: "mia_cupom_da_empresa",
    resourceId: p.orgId,
    requestId: p.requestId,
    metadata: { de: antes?.codigo ?? null, para: r.codigo, dias_aplicados: r.diasAplicados },
  });
  return { ok: true, mudou: true };
}

/**
 * A Time troca (ou tira) o parceiro de um cliente. O novo recebe comissão só dos
 * pagamentos a partir de hoje, com a comissão dele fixada no próximo pagamento; o
 * que já foi lançado para o antigo fica com ele. O prazo continua contando da
 * primeira mensalidade do cliente. Sem cupom não há ligação: aplique um antes.
 */
export async function trocarParceiroDoCliente(
  admin: SupabaseClient,
  p: { orgId: string; parceiroId: string | null; ator: string; requestId: string },
): Promise<ResultadoDaFicha> {
  const uso = await lerCupomDaEmpresa(admin, p.orgId);
  if (!uso) return { ok: false, status: 409, code: "sem_cupom", message: "Esta empresa não tem cupom. Aplique um cupom antes de ligar o parceiro." };
  if (uso.parceiro_id === p.parceiroId) return { ok: true, mudou: false };
  if (p.parceiroId) {
    const novo = await lerParceiro(admin, p.parceiroId);
    if (!novo || novo.anonimizado_em) return { ok: false, status: 404, code: "parceiro_nao_encontrado", message: "Parceiro não encontrado." };
  }
  const { error } = await admin
    .from("mia_cupom_da_empresa")
    .update({
      parceiro_id: p.parceiroId,
      parceiro_desde: new Date().toISOString(),
      comissao_pct: null,
      comissao_meses: null,
      comissao_setup_pct: null,
      termos_fixados_em: null,
    })
    .eq("organization_id", p.orgId);
  if (error) return { ok: false, status: 500, code: "internal_error", message: "Não foi possível trocar o parceiro. Tente de novo." };
  void audit({
    action: "parceiro.trocado_no_cliente",
    actorUserId: p.ator,
    actingAsPlatformAdmin: true,
    organizationId: p.orgId,
    resourceType: "mia_cupom_da_empresa",
    resourceId: p.orgId,
    requestId: p.requestId,
    metadata: { de: uso.parceiro_id, para: p.parceiroId },
  });
  return { ok: true, mudou: true };
}
