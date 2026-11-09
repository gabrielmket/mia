/**
 * FORK MIA (.107) · POST /api/v1/publico/raio-x/[codigo]/horario — "Enquanto
 * isso: duas perguntas (opcional)" (protótipo de 06/11/2026, tela 3). Enquanto o
 * histórico chega, a pessoa do CADASTRO diz quem atende hoje e o horário
 * (segunda a sexta, sábado e domingo). Corpo:
 * `{ quem_atende, abre, fecha, sabado_ate, domingo_ate }`, com a régua do
 * cadastro (`lerHorario`: sábado e domingo vazios = fechado, abrem no horário da
 * semana e fecham depois de abrir).
 *
 * Só ANTES do relatório (situação antes de "pronto", sem relatório nenhum):
 * depois, 409 com a frase. Só no raio-X do cadastro: o da Time tem o horário
 * combinado com ela. A análise lê o horário do banco na hora de analisar, então
 * o que for salvo aqui vale para o relatório.
 *
 * Público: a identidade é o código do link; confere a origem (a própria página)
 * e tem uma cerca pequena por IP.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { veioDoProprioApp } from "@/lib/raio-x/acesso";
import { raioXPeloCodigo } from "@/lib/raio-x/banco";
import { FRASE_DO_CAMPO, lerHorario } from "@/lib/raio-x/cadastro";
import { LIMITE_DO_HORARIO, podeMudarOHorario, ROTULO_DO_LIMITE_DO_HORARIO } from "@/lib/raio-x/publico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const DEPOIS_DO_RELATORIO = "O relatório já saiu com o horário que estava: ele não muda mais. Na próxima análise, dá para dizer de novo.";
const DA_TIME = "O horário deste Raio-X foi combinado com a Time Company.";

export async function POST(req: NextRequest, { params }: { params: Promise<{ codigo: string }> }): Promise<Response> {
  const requestId = randomUUID();
  if (!veioDoProprioApp(req.headers)) return fail("forbidden", "Pedido de fora da página do Raio-X.", 403, { requestId });
  if (await authRateLimited(ROTULO_DO_LIMITE_DO_HORARIO, null, LIMITE_DO_HORARIO)) {
    return fail("rate_limited", "Muitas tentativas seguidas. Aguarde alguns minutos.", 429, { requestId, headers: { "Retry-After": "600" } });
  }
  const { codigo } = await params;
  const admin = createAdminClient();
  const r = await raioXPeloCodigo(admin, codigo);
  if (!r) return fail("not_found", "Link inválido ou encerrado.", 404, { requestId });
  if (r.origem !== "cadastro" || r.fonte === "conversas_da_mia") return fail("conflict", DA_TIME, 409, { requestId });
  if (!podeMudarOHorario(r)) return fail("conflict", DEPOIS_DO_RELATORIO, 409, { requestId });

  const corpo = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const h = lerHorario(corpo);
  if (!h.ok) {
    return fail("validation_failed", h.campos.map((c) => FRASE_DO_CAMPO[c]).join(" "), 400, { requestId, details: { campos: h.campos } });
  }
  // Condicional: o relatório não pode ter nascido entre a leitura e a escrita.
  const { data, error } = await admin
    .from("mia_raio_x")
    .update({ quem_atende: h.valor.quem_atende, abre: h.valor.abre, fecha: h.valor.fecha, sabado_ate: h.valor.sabado_ate, domingo_ate: h.valor.domingo_ate })
    .eq("id", r.id)
    .is("ultimo_relatorio_em", null)
    .in("situacao", ["aguardando", "conectando", "lendo", "analisando"])
    .select("id");
  if (error) return fail("internal_error", "Não deu para salvar agora. Tente de novo.", 500, { requestId });
  if ((data ?? []).length === 0) return fail("conflict", DEPOIS_DO_RELATORIO, 409, { requestId });
  void audit({
    action: "raio_x.alterado",
    actorUserId: null,
    actingAsPlatformAdmin: false,
    resourceType: "mia_raio_x",
    resourceId: r.id,
    requestId,
    metadata: { campos: ["quem_atende", "horario"], origem: "pagina_de_conexao" },
  });
  return ok({ salvo: true, horario: h.valor }, { requestId });
}
