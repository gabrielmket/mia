/**
 * FORK MIA · EMPRESA ÚNICA — a LISTA de empresas da tela (protótipo aprovado em 15/10/2026, tela 1).
 *
 * Cada linha responde o que a pessoa precisa para decidir em qual empresa
 * entrar: nome e razão social, o CNPJ e a situação na Receita, quantas pessoas
 * e quem são, quantos negócios abertos, as obrigações (em dia ou pedindo
 * atenção), e se ela PARECE outra (nome parecido e sem CNPJ, a "possível
 * duplicada" que alguém precisa mesclar).
 *
 * Os quatro filtros do protótipo (todas, com negócio aberto, sem CNPJ, possível
 * duplicada) dependem da organização inteira, não da página: por isso a lista
 * lê TODAS as empresas (até 5 mil, `lerTodasAsEmpresas`), filtra e só então
 * corta a página, e os números de cada linha são lidos só para a página.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";
import { buscaEmLotesSemTeto } from "@/lib/leitura/em-lotes-sem-teto";
import { urgencia } from "@/lib/obrigacoes/situacao";
import type { Dia } from "@/lib/obrigacoes/datas";
import type { ItemParaSituacao } from "@/lib/obrigacoes/tipos";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { nomeComparavel } from "@/lib/empresas/nome-comparavel";
import { duplicadasPossiveis } from "@/lib/empresas/parecida";
import { lerTodasAsEmpresas, paraEmpresa, type EmpresaUnica } from "@/lib/empresas/fonte-unica";

export const FILTROS_DA_LISTA = ["todas", "abertos", "semcnpj", "dup"] as const;
export type FiltroDaLista = (typeof FILTROS_DA_LISTA)[number];

export interface LinhaDaListaDeEmpresas extends EmpresaUnica {
  pessoas: { total: number; nomes: string[] };
  negocios_abertos: number;
  obrigacoes: { total: number; atencao: number };
  /** A outra empresa que esta parece (só para quem não tem CNPJ). */
  parece_com: { id: string; nome: string } | null;
}

export interface ListaDeEmpresas {
  linhas: LinhaDaListaDeEmpresas[];
  /** Quantas passam no filtro e na busca. */
  total: number;
  /** Quantas a organização tem. */
  total_da_organizacao: number;
  /** A organização passou de 5 mil empresas: a lista é um recorte. */
  truncado: boolean;
}

const COLUNAS_DA_OBRIGACAO =
  "id, empresa_id, categoria, recorrencia, recorrencia_meses, validade_meses, avisos_dias, dias_sem_resposta, " +
  "pedido_em, prazo_em, cobrado_em, recebido_em, valido_ate, renovado_em, proxima_em, feita_em";

/** A busca: um trecho do nome ou da razão social, ou dos dígitos do CNPJ. */
export function casaComABusca(e: Pick<EmpresaUnica, "nome" | "razao_social" | "cnpj">, busca: string): boolean {
  const q = busca.trim();
  if (!q) return true;
  const digitos = q.replace(/\D/g, "");
  if (digitos.length >= 3 && (e.cnpj ?? "").includes(digitos)) return true;
  const alvo = nomeComparavel(`${e.nome} ${e.razao_social ?? ""}`);
  const termo = nomeComparavel(q);
  return termo.length > 0 && alvo.includes(termo);
}

export async function montarListaDeEmpresas(
  db: SupabaseClient,
  organizationId: string,
  opcoes: { busca?: string; filtro: FiltroDaLista; limit: number; offset: number; hoje: Dia },
): Promise<ListaDeEmpresas> {
  const lidas = await lerTodasAsEmpresas(db, organizationId);
  if (lidas.erro) throw new Error(lidas.erro);
  const todas = lidas.linhas.map(paraEmpresa).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const parece = duplicadasPossiveis(todas);

  // Os negócios abertos de cada empresa (uma leitura para a organização).
  const abertos = await lerTodasAsPaginas<{ empresa_id: string }>(
    (de, ate, pedirContagem) =>
      db
        .from("crm_leads")
        .select("empresa_id", pedirContagem ? { count: "exact" } : undefined)
        .eq("organization_id", organizationId)
        .eq("status", "open")
        .not("empresa_id", "is", null)
        .order("id", { ascending: true })
        .range(de, ate),
    { paginasMaximas: 20 },
  );
  if (abertos.erro) throw new Error(abertos.erro);
  const abertosPorEmpresa = new Map<string, number>();
  for (const n of abertos.linhas) abertosPorEmpresa.set(n.empresa_id, (abertosPorEmpresa.get(n.empresa_id) ?? 0) + 1);

  const filtradas = todas.filter((e) => {
    if (opcoes.busca && !casaComABusca(e, opcoes.busca)) return false;
    if (opcoes.filtro === "abertos") return (abertosPorEmpresa.get(e.id) ?? 0) > 0;
    if (opcoes.filtro === "semcnpj") return !e.cnpj;
    if (opcoes.filtro === "dup") return parece.has(e.id);
    return true;
  });
  const pagina = filtradas.slice(opcoes.offset, opcoes.offset + opcoes.limit);
  const ids = pagina.map((e) => e.id);

  const [vinculos, obrigacoes] = await Promise.all([
    buscaEmLotesSemTeto<{ company_id: string; person_id: string; is_primary: boolean }>(ids, (lote, contagem) =>
      db
        .from("company_people")
        .select("company_id, person_id, is_primary", contagem)
        .eq("organization_id", organizationId)
        .in("company_id", lote),
    ),
    buscaEmLotesSemTeto<ItemParaSituacao & { empresa_id: string }>(ids, (lote, contagem) =>
      db
        .from("mia_obrigacoes")
        .select(COLUNAS_DA_OBRIGACAO, contagem)
        .eq("organization_id", organizationId)
        .in("empresa_id", lote),
    ),
  ]);
  if (vinculos.error) throw new Error(vinculos.error.message);
  if (obrigacoes.error) throw new Error(obrigacoes.error.message);

  // O primeiro nome de cada pessoa, pelo primeiro número vivo dela.
  const idsDasPessoas = [...new Set(vinculos.data.map((v) => v.person_id))];
  const contatos = await buscaEmLotesSemTeto<{ person_id: string; name: string | null; display_name: string | null }>(
    idsDasPessoas,
    (lote, contagem) =>
      db
        .from("contacts")
        .select("person_id, name, display_name", contagem)
        .eq("organization_id", organizationId)
        .in("person_id", lote)
        .is("is_merged_into", null)
        .eq("is_anonymized", false),
  );
  if (contatos.error) throw new Error(contatos.error.message);
  const nomeDaPessoa = new Map<string, string>();
  for (const c of contatos.data) {
    const nome = nomeDoContato(c) ?? "";
    if (nome && !nomeDaPessoa.has(c.person_id)) nomeDaPessoa.set(c.person_id, nome.split(/\s+/)[0]!);
  }

  const linhas = pagina.map<LinhaDaListaDeEmpresas>((e) => {
    const daEmpresa = vinculos.data
      .filter((v) => v.company_id === e.id)
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
    const obr = obrigacoes.data.filter((o) => o.empresa_id === e.id);
    const outra = !e.cnpj ? parece.get(e.id) : undefined;
    return {
      ...e,
      pessoas: {
        total: daEmpresa.length,
        nomes: daEmpresa.map((v) => nomeDaPessoa.get(v.person_id)).filter((n): n is string => Boolean(n)),
      },
      negocios_abertos: abertosPorEmpresa.get(e.id) ?? 0,
      obrigacoes: { total: obr.length, atencao: obr.filter((o) => urgencia(o, opcoes.hoje).tipo !== null).length },
      parece_com: outra ? { id: outra.id, nome: outra.nome } : null,
    };
  });

  return { linhas, total: filtradas.length, total_da_organizacao: todas.length, truncado: lidas.truncado };
}
