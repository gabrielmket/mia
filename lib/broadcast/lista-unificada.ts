/**
 * FORK MIA — a LISTA ÚNICA do Broadcast: os disparos dos dois motores juntos.
 *
 * O operador pensa em "os disparos que eu fiz", não em "os do motor A e os do
 * motor B". Então a tela mostra uma lista só, do mais novo para o mais velho,
 * cada linha com o selo do canal — e é esta função que decide a ordem, o estado
 * e para onde cada linha leva, sem depender de React (testada em
 * `lista-unificada.test.ts`).
 *
 * ── Um vocabulário de estado, o das Campanhas ─────────────────────────────
 *
 * As Campanhas têm nove estados; o Broadcast oficial tem seis, e cada um deles
 * tem par exato lá. Traduzir para o vocabulário das Campanhas deixa a tela usar
 * UM selo (`EstadoDaCampanha`) e UM filtro de situação para as duas — dois
 * rótulos para "enviando" na mesma lista seriam lidos como duas coisas.
 */
import type { StatusDaCampanha } from "@/lib/campanhas/tipos";

export type CanalDoDisparo = "oficial" | "qr";

export type StatusDoBroadcast =
  | "rascunho"
  | "agendada"
  | "enviando"
  | "pausada"
  | "concluida"
  | "cancelada";

export const STATUS_DO_BROADCAST_NA_LISTA: Record<StatusDoBroadcast, StatusDaCampanha> = {
  rascunho: "draft",
  agendada: "scheduled",
  enviando: "running",
  pausada: "paused",
  concluida: "completed",
  cancelada: "cancelled",
};

/** O que a lista precisa de uma campanha por QR (a linha de `GET /api/v1/campaigns`). */
export interface CampanhaQrNaEntrada {
  id: string;
  name: string;
  status: StatusDaCampanha;
  snapshot_eligible: number;
  snapshot_excluded: number;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

/** O que a lista precisa de um disparo oficial (a linha de `GET /api/v1/broadcasts`). */
export interface DisparoOficialNaEntrada {
  id: string;
  nome: string;
  template_name: string;
  status: StatusDoBroadcast;
  preco_cents: number | null;
  agendado_para: string | null;
  iniciado_em: string | null;
  concluido_em: string | null;
  created_at: string;
  andamento: { total: number; enviada?: number; entregue?: number; lida?: number; falhou?: number };
}

/** Qual data importa agora — mostrar "criada em" num disparo que já terminou é ruído. */
export type Quando =
  | { tipo: "comeca"; em: string }
  | { tipo: "terminou"; em: string }
  | { tipo: "comecou"; em: string }
  | { tipo: "criada"; em: string };

export type ResumoDaLinha =
  | { canal: "qr"; naLista: number; fora: number }
  | {
      canal: "oficial";
      naLista: number;
      saiu: number;
      falhou: number;
      modelo: string;
      /** `null` = sem preço gravado na campanha; não é "de graça". */
      custoCents: number | null;
    };

export interface DisparoNaLista {
  id: string;
  canal: CanalDoDisparo;
  nome: string;
  status: StatusDaCampanha;
  criadoEm: string;
  quando: Quando;
  resumo: ResumoDaLinha;
  /** Para onde a linha leva: o detalhe do motor dela. */
  href: string;
}

function quando(
  status: StatusDaCampanha,
  datas: { agendada: string | null; comecou: string | null; terminou: string | null; criada: string },
): Quando {
  if (status === "scheduled" && datas.agendada) return { tipo: "comeca", em: datas.agendada };
  if (datas.terminou) return { tipo: "terminou", em: datas.terminou };
  if (datas.comecou) return { tipo: "comecou", em: datas.comecou };
  return { tipo: "criada", em: datas.criada };
}

export function daCampanhaQr(c: CampanhaQrNaEntrada): DisparoNaLista {
  return {
    id: c.id,
    canal: "qr",
    nome: c.name,
    status: c.status,
    criadoEm: c.created_at,
    quando: quando(c.status, {
      agendada: c.scheduled_at,
      comecou: c.started_at,
      terminou: c.completed_at,
      criada: c.created_at,
    }),
    resumo: { canal: "qr", naLista: c.snapshot_eligible, fora: c.snapshot_excluded },
    // O detalhe do upstream, intacto — é ele que sabe preparar, testar e iniciar.
    href: `/app/campaigns/${c.id}`,
  };
}

export function doDisparoOficial(b: DisparoOficialNaEntrada): DisparoNaLista {
  const status = STATUS_DO_BROADCAST_NA_LISTA[b.status] ?? "draft";
  const a = b.andamento;
  // "Saiu" é o que deixou de estar na fila: enviada, entregue e lida são o
  // mesmo envio em momentos diferentes, e somá-los contaria a pessoa três vezes.
  const saiu = (a.enviada ?? 0) + (a.entregue ?? 0) + (a.lida ?? 0);
  return {
    id: b.id,
    canal: "oficial",
    nome: b.nome,
    status,
    criadoEm: b.created_at,
    quando: quando(status, {
      agendada: b.agendado_para,
      comecou: b.iniciado_em,
      terminou: b.concluido_em,
      criada: b.created_at,
    }),
    resumo: {
      canal: "oficial",
      naLista: a.total,
      saiu,
      falhou: a.falhou ?? 0,
      modelo: b.template_name,
      custoCents: b.preco_cents === null ? null : b.preco_cents * a.total,
    },
    href: `/app/broadcast/${b.id}`,
  };
}

export interface FiltrosDaLista {
  /** Vazio = todas as situações. No vocabulário das Campanhas. */
  status?: StatusDaCampanha | "";
  /** Vazio = os dois canais. */
  canal?: CanalDoDisparo | "";
}

/**
 * Junta as duas listas numa só, do mais novo para o mais velho.
 *
 * ── A página que ainda não chegou ─────────────────────────────────────────
 *
 * As campanhas por QR vêm paginadas (30 por vez); os disparos oficiais vêm de
 * uma vez. Misturar sem cuidado poria um disparo oficial de março logo depois da
 * 30ª campanha de setembro, e a campanha de agosto que ainda não carregou
 * apareceria DEPOIS dele quando o operador clicasse "Carregar mais" — uma lista
 * que se reordena sozinha. Por isso, enquanto houver página de QR por vir, o
 * oficial mais velho que a última campanha carregada espera a sua vez.
 */
export function mesclarDisparos(
  qr: readonly CampanhaQrNaEntrada[],
  oficiais: readonly DisparoOficialNaEntrada[],
  opcoes: { qrTemMais: boolean; filtros?: FiltrosDaLista } = { qrTemMais: false },
): DisparoNaLista[] {
  const filtros = opcoes.filtros ?? {};
  // O filtro de QR que vale é o de fora da lista, e a API já filtra, então aqui a
  // lista chega recortada. Filtrar de novo é idempotente e deixa a função honesta
  // para quem a chamar com a lista inteira.
  const noFiltro = (d: DisparoNaLista) => !filtros.status || d.status === filtros.status;
  const deQr = (filtros.canal === "oficial" ? [] : qr.map(daCampanhaQr)).filter(noFiltro);
  let deOficial = (filtros.canal === "qr" ? [] : oficiais.map(doDisparoOficial)).filter(noFiltro);

  // O piso é medido na página de QR que CHEGOU, antes de qualquer filtro de canal:
  // com o filtro "só oficial", não há página de QR em jogo e nada espera.
  if (opcoes.qrTemMais && filtros.canal !== "oficial" && qr.length > 0) {
    const piso = Math.min(...qr.map((c) => Date.parse(c.created_at)));
    deOficial = deOficial.filter((d) => Date.parse(d.criadoEm) >= piso);
  }

  return [...deQr, ...deOficial].sort((a, b) => {
    const diferenca = Date.parse(b.criadoEm) - Date.parse(a.criadoEm);
    if (diferenca !== 0) return diferenca;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}
