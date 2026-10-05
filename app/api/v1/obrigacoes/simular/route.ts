/**
 * FORK MIA — GET /api/v1/obrigacoes/simular — o que uma regra faria HOJE.
 *
 * A tela de automações mostra, antes de a regra ser ligada, para quais itens da
 * empresa o gatilho dispararia hoje e quais ficariam segurados (documento não
 * enviado com arquivo do cliente esperando confirmação). É a MESMA conta da
 * varredura (`lib/obrigacoes/avisos.ts`), sem a trava e sem gravar nada.
 *
 * `?gatilho=obrigacao.documento_vencendo&dias=30&tipo=Alvará de funcionamento`.
 * Só leitura; gerente em diante, como a tela de automações.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { lerTodasAsPaginas, TAMANHO_DA_PAGINA } from "@/lib/leitura/todas-as-paginas";
import { simularRegra } from "@/lib/obrigacoes/avisos";
import { configDoGatilhoDeObrigacao, ehGatilhoDeObrigacao } from "@/lib/obrigacoes/gatilhos";
import { prepararRota, respostaDoErro } from "@/lib/obrigacoes/rota";
import { COLUNAS_DA_OBRIGACAO, type Obrigacao } from "@/lib/obrigacoes/tipos";

export const dynamic = "force-dynamic";

/** Quantos itens a simulação lê. Acima disso, a resposta diz que cortou. */
const TETO = 3000;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const rota = await prepararRota("manager", requestId);
  if (!rota.ok) return rota.resposta;

  const busca = new URL(req.url).searchParams;
  const gatilho = busca.get("gatilho") ?? "";
  if (!ehGatilhoDeObrigacao(gatilho)) {
    return fail("validation_failed", rota.t("Escolha um gatilho de obrigação."), 422, { requestId });
  }
  const diasBrutos = busca.get("dias");
  const config = configDoGatilhoDeObrigacao(gatilho, {
    ...(diasBrutos !== null && diasBrutos !== "" ? { dias: Number(diasBrutos) } : {}),
    tipo: busca.get("tipo") ?? undefined,
  });
  if (!config) {
    return fail("validation_failed", rota.t("Diga com quantos dias a regra dispara (de 1 a 3650)."), 422, { requestId });
  }

  try {
    // PAGINADO. O `.limit(TETO + 1)` que estava aqui nunca trouxe 3001 linhas:
    // o PostgREST corta em 1000 sem avisar, a simulação contava quem a regra
    // alcança só entre 1000 itens arbitrários, e o `cortada` nunca ligava. As
    // propostas pendentes paginam junto, porque sem elas um item "segurado"
    // apareceria como "dispara hoje".
    const [itens, propostas] = await Promise.all([
      lerTodasAsPaginas<Obrigacao>(
        (de, ate, pedirContagem) =>
          rota.supabase
            .from("mia_obrigacoes")
            .select(COLUNAS_DA_OBRIGACAO, pedirContagem ? { count: "exact" } : undefined)
            .eq("organization_id", rota.orgId)
            .is("arquivado_em", null)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(de, ate),
        { paginasMaximas: TETO / TAMANHO_DA_PAGINA },
      ),
      lerTodasAsPaginas<{ obrigacao_id: string }>(
        (de, ate, pedirContagem) =>
          rota.supabase
            .from("mia_obrigacoes_propostas")
            .select("obrigacao_id", pedirContagem ? { count: "exact" } : undefined)
            .eq("organization_id", rota.orgId)
            .eq("situacao", "pendente")
            .order("obrigacao_id", { ascending: true })
            .order("id", { ascending: true })
            .range(de, ate),
        { paginasMaximas: TETO / TAMANHO_DA_PAGINA },
      ),
    ]);
    if (itens.erro) throw new Error(itens.erro);
    if (propostas.erro) throw new Error(propostas.erro);
    const todos = itens.linhas;
    const comProposta = new Set(propostas.linhas.map((p) => p.obrigacao_id));
    const alcancados = simularRegra(todos.slice(0, TETO), gatilho, config, rota.hoje, comProposta);
    return ok(
      {
        hoje: rota.hoje,
        dispara_hoje: alcancados.filter((a) => a.quando === "hoje"),
        segurados: alcancados.filter((a) => a.quando === "segurado"),
        cortada: itens.truncado || propostas.truncado,
      },
      { requestId },
    );
  } catch (err) {
    return respostaDoErro(err, rota);
  }
}
