/**
 * FORK MIA (.89) — GET /api/v1/email-marketing/estado: o retrato da
 * configuração do disparo de e-mail (módulo, Amazon, domínio e os seis
 * registros, remetentes, rodapé, ritmo, aquecimento, saúde, supressão, preço).
 *
 * manager+ lê (o gestor vê a configuração, sem mudar); só o admin muda, nas
 * rotas de escrita. Nenhum segredo sai: da Amazon, só "ligado" e o que falta.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { retratoDaConfiguracao } from "@/lib/email-marketing/retrato";
import { portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<Response> {
  // O retrato abre também SEM o módulo: a tela diz "não contratado" com a
  // explicação, em vez de um 403 cru.
  const porta = await portaDoEmail("manager", { escreve: false, exigeModulo: false });
  if (!porta.ok) return porta.response;
  try {
    const retrato = await retratoDaConfiguracao(porta.admin, porta.org.orgId);
    return ok(
      { ...retrato, pode_mudar: porta.org.role === "admin" },
      { requestId: porta.requestId },
    );
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
