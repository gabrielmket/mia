/**
 * FORK MIA (.88, ampliado na .89) — "COMO FAÇO?" e "ONDE FICA?": as fontes do suporte de uso.
 *
 *   1. os manuais do sistema (`manuais.ts`, `manuais-das-telas.ts`,
 *      `roteiros.ts`): o "como faço", escrito pelo fork;
 *   2. o guia de operação do upstream (`guia-de-operacao.ts`): o produto tela a
 *      tela, gerado de `.claude/skills/deskcomm-operacao/`;
 *   3. o mapa das telas (`NAV_CATALOG`, por `telas.ts`): o "onde fica";
 *   4. a base própria da empresa (`mia_assistente_conhecimento`, 9050): o
 *      "como trabalhamos aqui", que o administrador escreve.
 *
 * Todas passam pela mesma régua (`busca-da-ajuda.ts`): sem acento, com
 * sinônimos, e a tela em que a pessoa está pesa mais. Volta pouco e curto,
 * para não estourar o contexto do turno.
 *
 * Cada achado diz se a pessoa ABRE a tela. Quando não abre, o assistente
 * explica e diz quem pode (regra "Pergunta fora da permissão"), em vez de
 * levar a pessoa a um 403.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { roleAtLeast, type Role } from "@/lib/auth/types";

import { buscar, indexar, mesmaTela, type DocumentoDeBusca, type Indice } from "../busca-da-ajuda";
import { TRECHOS_DA_MIA, type TrechoDaMia } from "../guia-de-operacao";
import { MANUAIS, comEnderecoDoSistema, type Manual } from "../manuais";
import { destinoDaTela, quemAbre, type TelaConhecida } from "../telas";

export interface ItemDaBaseDaEmpresa {
  titulo: string;
  texto: string;
}

export interface ManualAchado {
  id: string;
  titulo: string;
  passos: string[];
  observacao: string | null;
  tela: string;
  href: string;
  voce_pode: boolean;
  quem_pode: string;
  /** É um roteiro (tarefa que cruza telas)? */
  roteiro: boolean;
  /** É a ajuda da tela em que a pessoa está? */
  desta_tela: boolean;
  /** A outra coisa que a pessoa pode estar querendo (o "MCP" que é outra coisa). */
  veja_tambem: Array<{ titulo: string; tela: string; href: string }>;
}

export interface TrechoAchado {
  titulo: string;
  texto: string;
  /** O nome da tela na MIA, quando o trecho tem tela. */
  tela: string | null;
  href: string | null;
  voce_abre: boolean | null;
  quem_abre: string | null;
  desta_tela: boolean;
}

export interface AchadosDaAjuda {
  /** A tela em que a pessoa perguntou, quando é uma porta conhecida. */
  tela_atual: string | null;
  manuais: ManualAchado[];
  guia: TrechoAchado[];
  telas: Array<{ rotulo: string; descricao: string; href: string; voce_abre: boolean; quem_abre: string }>;
  base_da_empresa: ItemDaBaseDaEmpresa[];
  nada_encontrado: boolean;
  fontes: string[];
}

/** Quantos achados de cada fonte voltam, no máximo. */
export const LIMITES_DA_AJUDA = { manuais: 3, guia: 3, telas: 3, base: 3 } as const;
/** O texto de um trecho do guia, no máximo. */
const TAMANHO_DO_TRECHO = 320;

/** A base própria inteira da empresa (o que está ativo), pela sessão. */
export async function lerBaseDaEmpresa(
  db: SupabaseClient,
  organizationId: string,
): Promise<ItemDaBaseDaEmpresa[]> {
  const { data } = await db
    .from("mia_assistente_conhecimento")
    .select("titulo, texto")
    .eq("organization_id", organizationId)
    .eq("ativo", true)
    .order("titulo", { ascending: true })
    .limit(60);
  return ((data ?? []) as ItemDaBaseDaEmpresa[]).map((i) => ({ titulo: i.titulo, texto: i.texto }));
}

/** As telas de um manual: a principal e as outras em que ele vale. */
export function telasDoManual(m: Manual): string[] {
  return [m.href, ...(m.telas ?? [])];
}

/** O que a busca indexa de cada fonte. */
export type FonteDaAjuda =
  | { fonte: "manual"; manual: Manual }
  | { fonte: "guia"; trecho: TrechoDaMia };

function documentoDoManual(m: Manual): DocumentoDeBusca<FonteDaAjuda> {
  return {
    item: { fonte: "manual", manual: m },
    titulo: m.titulo,
    chaves: m.palavras.join(" "),
    corpo: `${m.passos.join(" ")} ${m.observacao ?? ""}`,
    telas: telasDoManual(m),
    // O roteiro desempata a favor de si: a pergunta geral ("como faço uma campanha") é a tarefa inteira.
    peso: m.tipo === "roteiro" ? 1.45 : 1.4,
  };
}

function documentoDoTrecho(t: TrechoDaMia): DocumentoDeBusca<FonteDaAjuda> {
  return {
    item: { fonte: "guia", trecho: t },
    titulo: t.titulo,
    chaves: t.tipo === "mapa" ? "" : t.secao,
    corpo: t.texto,
    telas: t.tela ? [t.tela] : [],
    peso: t.tipo === "funcionalidade" ? 1 : t.tipo === "sem-tela" ? 0.8 : 0.7,
  };
}

let indiceDoSistema: Indice<FonteDaAjuda> | null = null;

/** O índice dos manuais e do guia: montado uma vez por processo (é tudo código). */
export function indiceDaAjuda(): Indice<FonteDaAjuda> {
  if (!indiceDoSistema) {
    indiceDoSistema = indexar<FonteDaAjuda>([
      ...MANUAIS.map(documentoDoManual),
      ...TRECHOS_DA_MIA.map(documentoDoTrecho),
    ]);
  }
  return indiceDoSistema;
}

/** O texto para o turno: curto, e sem o travessão que o guia do upstream usa. */
function curto(texto: string, limite = TAMANHO_DO_TRECHO): string {
  const limpo = texto.replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim();
  if (limpo.length <= limite) return limpo;
  const corte = limpo.slice(0, limite);
  const ultimo = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("; "));
  return `${(ultimo > limite * 0.5 ? corte.slice(0, ultimo + 1) : corte).trim()}…`;
}

/**
 * A ajuda em ordem, sem cortar por fonte: é o que a cerca de perguntas reais
 * confere ("o trecho certo entre os primeiros").
 */
export function ajudaEmOrdem(pergunta: string, caminho?: string | null, limite = 8) {
  return buscar(indiceDaAjuda(), pergunta, { caminho, limite });
}

export function buscarAjuda(entrada: {
  pergunta: string;
  papel: Role;
  telas: readonly TelaConhecida[];
  base: readonly ItemDaBaseDaEmpresa[];
  /** A tela em que a pessoa está (`/app/...`, sem query string). */
  caminho?: string | null;
  /** O endereço que a pessoa usa no navegador (`https://...`), para o passo que o cita. */
  enderecoDoSistema?: string | null;
}): AchadosDaAjuda {
  const caminho = entrada.caminho ?? null;
  const porHref = new Map(entrada.telas.map((t) => [t.href, t]));
  const telaPorHref = (href: string): TelaConhecida | null => {
    const direta = porHref.get(href);
    if (direta) return direta;
    const porta = destinoDaTela(href);
    return porta ? (porHref.get(porta.href) ?? null) : null;
  };
  const rotuloDe = (href: string) => telaPorHref(href)?.rotulo ?? destinoDaTela(href)?.label ?? href;

  const emOrdem = ajudaEmOrdem(entrada.pergunta, caminho, 12);
  const topo = emOrdem[0]?.pontos ?? 0;
  const relevantes = emOrdem.filter((a) => a.pontos >= topo * 0.3);

  const vistos = new Set<string>();
  const manuais: ManualAchado[] = [];
  const guia: TrechoAchado[] = [];
  for (const a of relevantes) {
    if (a.item.fonte === "manual") {
      const m = a.item.manual;
      if (manuais.length >= LIMITES_DA_AJUDA.manuais || vistos.has(m.id)) continue;
      vistos.add(m.id);
      const vejaTambem = (m.vejaTambem ?? [])
        .map((id) => MANUAIS.find((x) => x.id === id))
        .filter((x): x is Manual => !!x)
        .map((x) => ({ titulo: x.titulo, tela: rotuloDe(x.href), href: x.href }));
      manuais.push({
        id: m.id,
        titulo: m.titulo,
        passos: m.passos.map((p) => comEnderecoDoSistema(p, entrada.enderecoDoSistema)),
        observacao: m.observacao ? comEnderecoDoSistema(m.observacao, entrada.enderecoDoSistema) : null,
        tela: rotuloDe(m.href),
        href: m.href,
        // A tela do dono da instalação não é de papel da empresa. A rota do chat não lê a
        // marca de plataforma (cerca admin-escrita-exige-scope-full): o manual diz quem faz.
        voce_pode: m.soDaPlataforma ? false : roleAtLeast(entrada.papel, m.papelMinimo),
        quem_pode: m.soDaPlataforma ? "o dono da instalação (na MIA, a Time Company)" : quemAbre(m.papelMinimo),
        roteiro: m.tipo === "roteiro",
        desta_tela: a.daTela,
        veja_tambem: vejaTambem,
      });
    } else {
      const t = a.item.trecho;
      if (guia.length >= LIMITES_DA_AJUDA.guia || vistos.has(t.id)) continue;
      vistos.add(t.id);
      const tela = t.tela ? telaPorHref(t.tela) : null;
      guia.push({
        titulo: t.titulo,
        texto: curto(t.texto),
        tela: t.tela ? rotuloDe(t.tela) : null,
        href: t.tela,
        voce_abre: t.tela ? (tela?.abre ?? false) : null,
        quem_abre: tela ? quemAbre(tela.papelMinimo) : null,
        desta_tela: a.daTela,
      });
    }
  }

  const indiceDasTelas = indexar(
    entrada.telas.map((t) => ({
      item: t,
      titulo: t.rotulo,
      corpo: `${t.descricao} ${t.grupo}`,
      telas: [t.href],
      peso: 1,
    })),
  );
  const telas = buscar(indiceDasTelas, entrada.pergunta, { caminho, limite: LIMITES_DA_AJUDA.telas }).map(({ item: t }) => ({
    rotulo: t.rotulo,
    descricao: t.descricao,
    href: t.href,
    voce_abre: t.abre,
    quem_abre: quemAbre(t.papelMinimo),
  }));

  const indiceDaBase = indexar(
    entrada.base.map((b) => ({ item: b, titulo: b.titulo, corpo: b.texto, telas: [], peso: 1 })),
  );
  const base = buscar(indiceDaBase, entrada.pergunta, { limite: LIMITES_DA_AJUDA.base })
    // Só a tela não basta para trazer um item da base: ele não tem tela.
    .filter((a) => a.pontos > 0)
    .map((a) => a.item);

  const fontes: string[] = [];
  if (manuais.length > 0) fontes.push("Manual do sistema");
  if (guia.length > 0) fontes.push("Guia de operação");
  if (telas.length > 0) fontes.push("Mapa das telas");
  if (base.length > 0) fontes.push("Como trabalhamos aqui");

  const atual = caminho ? destinoDaTela(caminho) : null;
  return {
    tela_atual: atual && mesmaTela(caminho, atual.href) ? atual.label : null,
    manuais,
    guia,
    telas,
    base_da_empresa: base,
    nada_encontrado: manuais.length === 0 && guia.length === 0 && telas.length === 0 && base.length === 0,
    fontes,
  };
}
