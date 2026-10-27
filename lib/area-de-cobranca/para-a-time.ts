/**
 * FORK MIA (.96, segunda frente) · AS COBRANÇAS DA EMPRESA VISTAS PELA TIME (MCP
 * de plataforma, `plataforma_ver_cliente`; protótipo "Pagamento no início",
 * tela 4, "No MCP de plataforma").
 *
 * As cobranças do cliente do Asaas da empresa, com o número da nota fiscal e o
 * link do PDF, para a Time mandar uma nota a quem pedir; e o chamado "A nota
 * saiu errada" de cada uma (que se responde com `plataforma_responder_chamado`).
 * Só LÊ. Nada do cartão além do final; nada do pagador além do que a nota é.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { asaasDaMia, type NotaLida } from "@/lib/asaas-mia/cobrancas";
import type { DependenciasDoAsaasDaMia } from "@/lib/asaas-mia/api";
import { moduloLigado } from "@/lib/instalacao/modulos";

import { correcoesPedidas, lerAssinaturaDaEmpresa, paraCobrancaDaArea } from "./leitura";

/** Quantas cobranças o MCP devolve (as mais novas). */
const TETO_DO_MCP = 24;

export interface CobrancaParaATime {
  cobranca: string;
  vencimento: string;
  valor_cents: number;
  forma: string;
  situacao: string;
  paga_em: string | null;
  mensalidade: boolean;
  nota_numero: string | null;
  nota_situacao: NotaLida["situacao"] | null;
  nota_pdf_url: string | null;
  correcao_pedida: { chamado: number; situacao: string } | null;
}

/**
 * `null` = a empresa não tem cobrança pelo Asaas (cobrança desligada, isenta,
 * outro provedor, nunca gerou cobrança); `"nao_lido"` = o Asaas não respondeu.
 * Nunca lança.
 */
export async function cobrancasParaATime(
  admin: SupabaseClient,
  orgId: string,
  deps: { asaas?: DependenciasDoAsaasDaMia; cobrancaLigada?: () => Promise<boolean> } = {},
): Promise<CobrancaParaATime[] | null | "nao_lido"> {
  try {
    if (!(await (deps.cobrancaLigada ?? (() => moduloLigado(admin, "cobranca")))())) return null;
    const assinatura = await lerAssinaturaDaEmpresa(admin, orgId);
    const cliente = assinatura?.provedor === "asaas" ? assinatura.provedor_cliente_id : null;
    if (!cliente) return null;
    const asaas = asaasDaMia(deps.asaas);
    const [cobrancas, notas, correcoes] = await Promise.all([
      asaas.listarCobrancasDoCliente(cliente),
      asaas.listarNotas({ clienteRef: cliente }).catch(() => [] as NotaLida[]),
      correcoesPedidas(admin, orgId),
    ]);
    return cobrancas.slice(0, TETO_DO_MCP).map((c) => {
      const a = paraCobrancaDaArea(c, notas, correcoes);
      return {
        cobranca: a.ref,
        vencimento: a.vencimento,
        valor_cents: a.valor_cents,
        forma: a.forma,
        situacao: a.situacao,
        paga_em: a.paga_em,
        mensalidade: a.mensalidade,
        nota_numero: a.nota?.numero ?? null,
        nota_situacao: a.nota?.situacao ?? null,
        nota_pdf_url: a.nota?.pdf_url ?? null,
        correcao_pedida: a.correcao ? { chamado: a.correcao.chamado, situacao: a.correcao.situacao } : null,
      };
    });
  } catch {
    return "nao_lido";
  }
}
