/**
 * FORK MIA (.101) · O QUE A PÁGINA PÚBLICA DE CONEXÃO MOSTRA (/raio-x/<código>).
 *
 * Quem abre é o dono, sem conta. A página só vê esta forma: a empresa, o número
 * (o que ele vai autorizar), o período, a etapa e o andamento. Nada de custo,
 * de relatório ou de dado de cliente.
 */
import type { LinhaDoRaioX } from "./banco";
import { andamentoDaLeitura, podeConectar, termoDoRaioX } from "./banco";
import { diaEMes } from "./prazos";
import { whatsappParaLer, type FonteDoRaioX } from "./regras";

/** As cercas de quem pede código e QR (a página e as três rotas públicas). */
export const ROTULO_DO_LIMITE_DA_PAGINA = "raio_x_conexao";
export const LIMITE_DA_PAGINA = { ip: 60, windowSec: 600 } as const;
/**
 * FORK MIA (.103) · A cerca do que a PRÓPRIA página repete sozinha: o andamento
 * (a cada 5 s) e o QR (a cada 20 s), ~150 pedidos em 10 minutos de tela aberta.
 * Na cerca da página (60), o dono era barrado depois de ~4 minutos esperando, e
 * o QR virava imagem quebrada. 400 cobre duas abas abertas com folga; adivinhar
 * um código de 40 bits a esse ritmo continua fora de alcance.
 */
export const ROTULO_DO_LIMITE_DO_ANDAMENTO = "raio_x_andamento";
export const LIMITE_DO_ANDAMENTO = { ip: 400, windowSec: 600 } as const;
export const ROTULO_DO_LIMITE_DO_CODIGO = "raio_x_codigo";
/** O código do WhatsApp vale ~3 minutos: 1 pedido a cada 30 s por raio-X, 10 por IP em 10 min. */
export const LIMITE_DO_CODIGO = { ip: 10, id: 6, windowSec: 600 } as const;

/** FORK MIA (.107): as "duas perguntas" da página de conexão (quem atende e o horário). */
export const ROTULO_DO_LIMITE_DO_HORARIO = "raio_x_horario";
export const LIMITE_DO_HORARIO = { ip: 30, windowSec: 600 } as const;

/**
 * FORK MIA (.107) · A pessoa do cadastro ainda pode dizer quem atende e o
 * horário? Só no raio-X do CADASTRO (o da Time tem o horário que a Time
 * combinou), pela conexão, e só ANTES do relatório: a análise lê o horário do
 * banco na hora de analisar, então o que for salvo antes vale para ele.
 */
export function podeMudarOHorario(r: Pick<LinhaDoRaioX, "origem" | "fonte" | "situacao" | "ultimo_relatorio_em">): boolean {
  if (r.origem !== "cadastro" || r.fonte === "conversas_da_mia") return false;
  if (r.ultimo_relatorio_em) return false;
  return r.situacao === "aguardando" || r.situacao === "conectando" || r.situacao === "lendo" || r.situacao === "analisando";
}

export type EtapaPublica = "termo" | "conectar" | "numero_diferente" | "lendo" | "pronto" | "vencido";

export interface SituacaoPublica {
  /** FORK MIA (.102): o cliente ativo só autoriza (duas etapas: autorizar e pronto). */
  fonte: FonteDoRaioX;
  /** FORK MIA (.107): o raio-X do cadastro (o relatório chega no e-mail, sem a Time no meio). */
  origem?: "time" | "cadastro";
  /**
   * FORK MIA (.107): quem atende e o horário que o relatório vai usar, e se a
   * página ainda pode perguntar ("Enquanto isso: duas perguntas", só no cadastro
   * e só antes do relatório).
   */
  horario?: { quemAtende: string; abre: string; fecha: string; sabadoAte: string | null; domingoAte: string | null };
  podeMudarOHorario?: boolean;
  /** FORK MIA (.102): os rótulos dos números da conta (fonte da MIA). */
  numeros: string[];
  /** FORK MIA (.102): o período fixado, "dd/mm" no fuso (fonte da MIA). */
  periodo: { inicio: string; fim: string } | null;
  empresa: string;
  whatsapp: string;
  periodoDias: number;
  tipo: "unico" | "mensal";
  etapa: EtapaPublica;
  /** Só na etapa do termo: o texto da versão em vigor, que o aceite grava. */
  termo: string | null;
  percentual: number | null;
  sincronizando: boolean;
  conversasLidas: number;
  linkExpiraEm: string | null;
}

export function situacaoPublica(r: LinhaDoRaioX, agora: Date = new Date(), numeros: readonly string[] = []): SituacaoPublica {
  const leitura = r.leitura as { fase?: string; conversas_lidas?: number; erro?: string | null };
  if (r.fonte === "conversas_da_mia") return situacaoDoClienteAtivo(r, agora, numeros);
  let etapa: EtapaPublica;
  if (r.situacao === "aguardando") etapa = podeConectar(r, agora) ? "termo" : "vencido";
  else if (r.situacao === "conectando") {
    if (!podeConectar(r, agora)) etapa = "vencido";
    else etapa = leitura.erro === "numero_diferente" ? "numero_diferente" : "conectar";
  } else if (r.situacao === "lendo") etapa = "lendo";
  else etapa = "pronto";
  return {
    fonte: "conexao",
    origem: r.origem === "cadastro" ? "cadastro" : "time",
    horario: {
      quemAtende: r.quem_atende,
      abre: r.abre.slice(0, 5),
      fecha: r.fecha.slice(0, 5),
      sabadoAte: r.sabado_ate ? r.sabado_ate.slice(0, 5) : null,
      domingoAte: r.domingo_ate ? r.domingo_ate.slice(0, 5) : null,
    },
    podeMudarOHorario: podeMudarOHorario(r),
    numeros: [],
    periodo: null,
    empresa: r.empresa,
    whatsapp: whatsappParaLer(r.whatsapp),
    periodoDias: r.periodo_dias,
    tipo: r.tipo,
    etapa,
    termo: etapa === "termo" ? termoDoRaioX(r) : null,
    percentual: andamentoDaLeitura(r),
    sincronizando: r.situacao === "lendo" && leitura.fase === "sincronizando",
    conversasLidas: Number(leitura.conversas_lidas) || 0,
    linkExpiraEm: r.conexao_expira_em,
  };
}

/**
 * FORK MIA (.102) · a página do dono no cliente ativo: autorizar e pronto. Não
 * há conexão: depois do aceite a etapa é "lendo" (a leitura da conta e a
 * análise) até o rascunho sair, e "pronto" depois.
 */
function situacaoDoClienteAtivo(r: LinhaDoRaioX, agora: Date, numeros: readonly string[]): SituacaoPublica {
  const leitura = r.leitura as { conversas_lidas?: number };
  let etapa: EtapaPublica;
  if (r.situacao === "aguardando") etapa = podeConectar(r, agora) ? "termo" : "vencido";
  else if (r.situacao === "lendo" || r.situacao === "analisando" || r.situacao === "conectando") etapa = "lendo";
  else etapa = "pronto";
  const periodo =
    r.periodo_inicio && r.periodo_fim
      ? { inicio: diaEMes(new Date(r.periodo_inicio)), fim: diaEMes(new Date(Date.parse(r.periodo_fim) - 1)) }
      : null;
  return {
    fonte: "conversas_da_mia",
    origem: "time",
    numeros: [...numeros],
    periodo,
    empresa: r.empresa,
    whatsapp: whatsappParaLer(r.whatsapp),
    periodoDias: r.periodo_dias,
    tipo: r.tipo,
    etapa,
    termo: etapa === "termo" ? termoDoRaioX(r, numeros) : null,
    percentual: r.situacao === "lendo" ? 25 : r.situacao === "analisando" ? 60 : etapa === "pronto" ? 100 : null,
    sincronizando: false,
    conversasLidas: Number(leitura.conversas_lidas) || 0,
    linkExpiraEm: r.conexao_expira_em,
  };
}
