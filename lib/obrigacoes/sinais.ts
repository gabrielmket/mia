/**
 * FORK MIA — OBRIGAÇÕES · o aviso do CARTÃO FECHADO, lido uma vez por quadro.
 *
 * A regra do cartão fechado: nada aparece enquanto está tudo em dia. Com algo
 * vencido, vencendo ou pedido sem resposta, UM aviso curto no rodapé, o mais
 * urgente. Os itens do cartão são os do negócio, os da empresa dele e os do
 * contato dele (a herança).
 *
 * Plugado em `lib/cartoes/sinais-do-quadro.ts`. Três leituras por quadro (por
 * negócio, por empresa, por contato), nunca uma por cartão. Falha aqui devolve
 * o quadro sem aviso: o aviso é o acessório, o quadro é o principal.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { buscaEmLotesSemTeto } from "@/lib/leitura/em-lotes-sem-teto";

import { diaNoFuso } from "./datas";
import { avisoDoCartao, type AvisoDoCartao } from "./situacao";
import type { ItemParaSituacao } from "./tipos";

type ItemDoSinal = ItemParaSituacao & {
  nome: string;
  nome_curto: string | null;
  lead_id: string | null;
  empresa_id: string | null;
  contact_id: string | null;
};

const COLUNAS =
  "id, nome, nome_curto, categoria, lead_id, empresa_id, contact_id, recorrencia, recorrencia_meses, validade_meses, " +
  "avisos_dias, dias_sem_resposta, pedido_em, prazo_em, cobrado_em, recebido_em, valido_ate, renovado_em, proxima_em, feita_em";

interface NegocioDoQuadro {
  id: string;
  status: string;
  empresa_id?: string | null;
  contact_id: string | null;
}

export async function avisosDeObrigacaoDoQuadro(
  db: SupabaseClient,
  org: string,
  negocios: readonly NegocioDoQuadro[],
  agora: Date,
): Promise<Map<string, AvisoDoCartao>> {
  const avisos = new Map<string, AvisoDoCartao>();
  // Negócio perdido não cobra documento de ninguém.
  const vivos = negocios.filter((n) => n.status !== "lost");
  if (vivos.length === 0) return avisos;
  try {
    const ler = (coluna: "lead_id" | "empresa_id" | "contact_id", ids: string[]) =>
      // VÁRIAS obrigações por dono: um lote de 100 negócios passa de 1000
      // linhas com 11 documentos por negócio, e o PostgREST cortaria ali sem
      // avisar. O cartão que ficasse depois do corte perdia o aviso de vencido.
      buscaEmLotesSemTeto<ItemDoSinal>(ids, (lote, contagem) =>
        db
          .from("mia_obrigacoes")
          .select(COLUNAS, contagem)
          .eq("organization_id", org)
          .is("arquivado_em", null)
          .in(coluna, lote),
      );
    const unicos = (valores: Array<string | null | undefined>) => [...new Set(valores.filter((v): v is string => !!v))];
    // Função `async` de propósito: se o cliente lançar na hora (e não numa
    // promessa), o erro vira rejeição e chega ao `Promise.all` junto das outras
    // leituras. Chamado direto na lista, o lançamento abortava a lista no meio e
    // deixava as leituras já disparadas rejeitando sem ninguém ouvir.
    const lerFuso = async () => db.from("organizations").select("timezone").eq("id", org).maybeSingle();
    const [doNegocio, daEmpresa, doContato, organizacao] = await Promise.all([
      ler("lead_id", vivos.map((n) => n.id)),
      ler("empresa_id", unicos(vivos.map((n) => n.empresa_id))),
      ler("contact_id", unicos(vivos.map((n) => n.contact_id))),
      lerFuso(),
    ]);
    for (const r of [doNegocio, daEmpresa, doContato]) {
      if (r.error) throw new Error(r.error.message);
    }
    if (doNegocio.data.length + daEmpresa.data.length + doContato.data.length === 0) return avisos;

    const hoje = diaNoFuso(agora, (organizacao.data as { timezone?: string | null } | null)?.timezone ?? null);
    const agrupar = (itens: ItemDoSinal[], chave: "lead_id" | "empresa_id" | "contact_id") => {
      const mapa = new Map<string, ItemDoSinal[]>();
      for (const item of itens) {
        const id = item[chave];
        if (!id) continue;
        const lista = mapa.get(id) ?? [];
        lista.push(item);
        mapa.set(id, lista);
      }
      return mapa;
    };
    const porNegocio = agrupar(doNegocio.data, "lead_id");
    const porEmpresa = agrupar(daEmpresa.data, "empresa_id");
    const porContato = agrupar(doContato.data, "contact_id");

    for (const n of vivos) {
      const porId = new Map<string, ItemDoSinal>();
      const juntar = (lista: ItemDoSinal[] | undefined) => {
        for (const item of lista ?? []) porId.set((item as ItemDoSinal & { id: string }).id, item);
      };
      juntar(porNegocio.get(n.id));
      if (n.empresa_id) juntar(porEmpresa.get(n.empresa_id));
      if (n.contact_id) juntar(porContato.get(n.contact_id));
      if (porId.size === 0) continue;
      const aviso = avisoDoCartao([...porId.values()], hoje);
      if (aviso) avisos.set(n.id, aviso);
    }
  } catch (err) {
    logger.warn("obrigacoes_sinais_falhou", {
      organization_id: org,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return avisos;
}
