import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * FORK MIA — GET|POST /api/v1/obrigacoes — documentos e obrigações com vencimento.
 *
 * GET lê por ESCOPO: `?lead_id=` (o cartão aberto: os itens do negócio, da
 * empresa dele e do contato dele), `?empresa_id=` (a ficha da empresa),
 * `?contact_id=` (a ficha do contato) ou sem nada (a lista geral, a agenda de
 * renovações da carteira). Devolve as DATAS; a situação é calculada na tela pela
 * mesma função pura que o servidor usa (`lib/obrigacoes/situacao.ts`), com o
 * `hoje` que vai junto na resposta (o dia do fuso da empresa).
 *
 * POST adiciona um item. `viewer` lê; `agent` em diante grava. A organização é a
 * do cookie; o que a pessoa vê e grava é decidido pela RLS (migration 9018).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { lerObrigacoes, paraATela } from "@/lib/obrigacoes/leitura";
import { adicionarObrigacao } from "@/lib/obrigacoes/operacoes";
import { prepararRota, registrarAto, respostaDoErro } from "@/lib/obrigacoes/rota";
import { CATEGORIAS, QUEM_ENTREGA, RECORRENCIAS, type EscopoDaLeitura } from "@/lib/obrigacoes/tipos";

export const dynamic = "force-dynamic";

const UUID = z.string().uuid();
const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Corpo = z
  .object({
    nome: z.string().trim().min(1).max(120),
    nome_curto: z.string().trim().max(60).nullish(),
    tipo_id: UUID.nullish(),
    categoria: z.enum(CATEGORIAS),
    lead_id: UUID.nullish(),
    empresa_id: UUID.nullish(),
    contact_id: UUID.nullish(),
    quem_entrega: z.enum(QUEM_ENTREGA).optional(),
    recorrencia: z.enum(RECORRENCIAS).optional(),
    recorrencia_meses: z.number().int().min(1).max(240).nullish(),
    validade_meses: z.number().int().min(0).max(600).optional(),
    avisos_dias: z.array(z.number().int().min(1).max(3650)).max(3).optional(),
    dias_sem_resposta: z.number().int().min(1).max(365).optional(),
    pedido_em: DIA.nullish(),
    prazo_em: DIA.nullish(),
    recebido_em: DIA.nullish(),
    valido_ate: DIA.nullish(),
    proxima_em: DIA.nullish(),
    responsavel_user_id: UUID.nullish(),
    observacao: z.string().max(2000).nullish(),
  })
  .strict();

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const rota = await prepararRota("viewer", requestId);
  if (!rota.ok) return rota.resposta;

  const busca = new URL(req.url).searchParams;
  const ler = (chave: string) => {
    const valor = busca.get(chave);
    return valor && UUID.safeParse(valor).success ? valor : null;
  };
  const leadId = ler("lead_id");
  const empresaId = ler("empresa_id");
  const contatoId = ler("contact_id");
  const escopo: EscopoDaLeitura = leadId
    ? { tipo: "negocio", id: leadId }
    : empresaId
      ? { tipo: "empresa", id: empresaId }
      : contatoId
        ? { tipo: "contato", id: contatoId }
        : { tipo: "lista" };

  try {
    const leitura = await lerObrigacoes(rota.supabase, rota.orgId, escopo);
    if (!leitura) return fail("not_found", rota.t("Não encontrado."), 404, { requestId });
    return ok({ ...leitura, hoje: rota.hoje }, { requestId });
  } catch (err) {
    return respostaDoErro(err, rota);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const rota = await prepararRota("agent", requestId);
  if (!rota.ok) return rota.resposta;

  const lido = Corpo.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail("validation_failed", rota.t("Revise os campos do item."), 422, {
      requestId,
      details: { issues: lido.error.issues },
    });
  }

  try {
    const item = await adicionarObrigacao(rota.ctx, { ...lido.data, origem: "tela" });
    await registrarAto(rota, { acao: "obrigacao.adicionada", item, porque: "Adicionou um item em Documentos e obrigações" });
    const [naTela] = await paraATela(rota.supabase, rota.orgId, [item]);
    return ok({ item: naTela, hoje: rota.hoje }, { requestId, status: 201 });
  } catch (err) {
    return respostaDoErro(err, rota);
  }
}
