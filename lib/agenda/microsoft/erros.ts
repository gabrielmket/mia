/**
 * O mapa de desfechos de um erro da Microsoft (Graph e Entra).
 *
 * Usa os MESMOS desfechos do classificador do Google (`lib/agenda/google/erros.ts`,
 * upstream): o que o sistema faz com "reconectar", "esperar", "o evento sumiu" ou
 * "recomeçar a leitura" é o mesmo, e `estadoDaConexaoApos` /
 * `deveTentarDeNovo` dele são reaproveitados. Muda só a leitura do erro:
 *
 *  - a Graph manda `{ error: { code, message } }`, com `code` textual
 *    (`ErrorItemNotFound`, `SyncStateNotFound`, `ErrorIrresolvableConflict`);
 *  - o Entra manda `{ error, error_description }`, com o motivo real no código
 *    `AADSTSnnnnn` da descrição.
 *
 * A operação continua obrigatória pelo mesmo motivo de lá: 404/410 na exclusão é
 * "já está feito", na leitura incremental é "recomeçar do zero".
 *
 * A frase que sai daqui é persistida e mostrada: só leva status e o `code`, nunca
 * o `message` da Microsoft (que pode trazer e-mail e nome de convidado).
 */

import type { DesfechoDoGoogle, OperacaoNoGoogle } from "@/lib/agenda/google/erros";

export type { DesfechoDoGoogle as DesfechoDaMicrosoft } from "@/lib/agenda/google/erros";
export { estadoDaConexaoApos, deveTentarDeNovo } from "@/lib/agenda/google/erros";

export type OperacaoNaMicrosoft = OperacaoNoGoogle;

/** A recusa de uma chamada à Graph, com o corpo guardado para ler o `code`. */
export class GraphHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: number | null = null,
    readonly corpo: unknown = null,
    readonly alvo: "evento" | "calendario" | "assinatura" | "conta" = "evento",
  ) {
    super(status === 412 ? "O evento mudou no Outlook. Releia antes de publicar." : `Microsoft HTTP ${status}`);
  }
}

export interface ClassificacaoDaMicrosoft {
  desfecho: DesfechoDoGoogle;
  status: number | null;
  /** O `code` da Graph ou o erro do Entra, em minúsculas. */
  motivo: string | null;
  esperarSegundos: number | null;
  mensagem: string;
}

const CODIGOS_DE_COTA = new Set(["toomanyrequests", "applicationthrottled", "throttledrequest", "mailboxconcurrency"]);
const CODIGOS_DE_REAUTENTICAR = new Set([
  "invalid_grant",
  "interaction_required",
  "invalidauthenticationtoken",
  "compacttoken validation failed",
  "authenticationerror",
]);
const CODIGOS_DE_APP_ERRADO = new Set(["invalid_client", "unauthorized_client", "invalid_request"]);
const CODIGOS_TRANSITORIOS = new Set(["temporarily_unavailable", "server_error", "serviceunavailable", "generalexception"]);
const CODIGOS_DE_RESSINCRONIZAR = new Set([
  "syncstatenotfound",
  "syncstateinvalid",
  "resyncrequired",
  "errorsyncstateinvalid",
  "errorinvalidsyncstatedata",
]);

function comoObjeto(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function motivosDe(erro: unknown): string[] {
  const achados: string[] = [];
  const empilhar = (v: unknown) => {
    if (typeof v === "string" && /^[A-Za-z_ .]{1,64}$/.test(v.trim())) achados.push(v.trim().toLowerCase());
  };
  const e = comoObjeto(erro);
  if (!e) return achados;
  // O corpo da Graph guardado pelo transporte.
  const corpo = comoObjeto(e.corpo);
  const erroDoCorpo = corpo ? comoObjeto(corpo.error) : null;
  if (erroDoCorpo) {
    empilhar(erroDoCorpo.code);
    const interno = comoObjeto(erroDoCorpo.innerError) ?? comoObjeto(erroDoCorpo.innererror);
    if (interno) empilhar(interno.code);
  }
  // O corpo cru, entregue direto.
  const erroNoTopo = comoObjeto(e.error);
  if (erroNoTopo) empilhar(erroNoTopo.code);
  // O endpoint de token: `error` é string, às vezes com o código AADSTS junto.
  if (typeof e.error === "string") {
    const [primeiro] = e.error.split(/\s+/);
    empilhar(primeiro);
  }
  return [...new Set(achados)];
}

function statusDe(erro: unknown): number | null {
  const e = comoObjeto(erro);
  if (!e) return null;
  if (typeof e.status === "number" && Number.isFinite(e.status)) return e.status;
  return null;
}

const FRASE: Record<DesfechoDoGoogle, string> = {
  reautenticar: "a agenda do Outlook perdeu a autorização. É preciso conectar de novo",
  recuar: "a Microsoft pediu para desacelerar (limite de uso)",
  sem_permissao: "sem permissão neste calendário do Outlook",
  evento_sumiu: "o evento não existe mais no Outlook",
  calendario_sumiu: "o calendário do Outlook não existe mais, ou a conta perdeu acesso a ele",
  ressincronizar: "a leitura incremental expirou. Recomeçando do zero",
  ja_esta_feito: "o Outlook já estava no estado desejado",
  transitorio: "falha passageira da Microsoft. Tentando de novo",
  permanente: "a Microsoft recusou e repetir não muda o resultado",
};

export function classificarErroDaMicrosoft(erro: unknown, operacao: OperacaoNaMicrosoft): ClassificacaoDaMicrosoft {
  const status = statusDe(erro);
  const motivos = motivosDe(erro);
  const motivo = motivos[0] ?? null;
  const esperarSegundos =
    erro instanceof GraphHttpError && erro.retryAfter !== null && Number.isFinite(erro.retryAfter)
      ? Math.max(0, Math.ceil(erro.retryAfter))
      : null;
  const tem = (conjunto: Set<string>) => motivos.some((m) => conjunto.has(m));
  const alvo = comoObjeto(erro)?.alvo;

  const desfecho: DesfechoDoGoogle = (() => {
    if (tem(CODIGOS_DE_APP_ERRADO)) return "permanente";
    if (tem(CODIGOS_DE_REAUTENTICAR)) return "reautenticar";
    if (tem(CODIGOS_DE_RESSINCRONIZAR)) return "ressincronizar";
    if (tem(CODIGOS_TRANSITORIOS)) return "transitorio";
    if (status === 401) return "reautenticar";
    if (status === 429 || tem(CODIGOS_DE_COTA)) return "recuar";
    if (status === 403) return "sem_permissao";
    if ((status === 404 || status === 410) && alvo === "calendario") return "calendario_sumiu";
    if (status === 404) {
      if (operacao === "apagar") return "ja_esta_feito";
      if (operacao === "criar") return "calendario_sumiu";
      return "evento_sumiu";
    }
    if (status === 410) {
      if (operacao === "apagar") return "ja_esta_feito";
      if (operacao === "listar" || operacao === "sincronizar") return "ressincronizar";
      return "evento_sumiu";
    }
    if (status === 503 || status === 504) return "transitorio";
    if (status !== null && status >= 500) return "transitorio";
    if (status === null) return motivos.length > 0 ? "permanente" : "transitorio";
    return "permanente";
  })();

  const numero = status !== null ? `HTTP ${status}` : "sem resposta";
  const detalhe = motivo ? ` (${motivo})` : "";
  return { desfecho, status, motivo, esperarSegundos, mensagem: `${FRASE[desfecho]}. ${numero}${detalhe}` };
}
