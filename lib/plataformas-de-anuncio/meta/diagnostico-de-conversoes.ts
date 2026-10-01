/**
 * FORK MIA — o que a META responde sobre a conexão de conversões, na hora.
 *
 * Três perguntas feitas à plataforma, todas de LEITURA (nenhum evento é enviado
 * por um diagnóstico):
 *
 *   1. o token é aceito?                 GET /me
 *   2. o destino de conversões existe e  GET /<destino>?fields=id,name
 *      o token o alcança?
 *   3. o que o token pode fazer?         GET /me/permissions
 *
 * Mora nesta fronteira porque só ela escreve o endereço e os campos da
 * plataforma (`scripts/lint-channels.ts`). Quem decide o que cada resposta
 * SIGNIFICA para quem opera é `lib/conversoes-meta/diagnostico.ts`, que junta
 * estas três com o que o livro-razão sabe (último envio aceito, recusas).
 *
 * ⚠️ O token entra no cabeçalho e não sai daqui: nem no retorno, nem em log. O
 * detalhe devolvido é a frase da plataforma, cortada.
 */
import { baseDaGraphDeAnuncio } from "./graph-base";

const TEMPO_LIMITE_MS = 10_000;

/** As permissões com que a Meta deixa um token enviar eventos de conversão. */
export const PERMISSOES_DE_ENVIO = ["ads_management", "whatsapp_business_manage_events"] as const;

export type RespostaDoToken =
  | { estado: "aceito" }
  /** A Meta disse que o token não vale (vencido, revogado, malformado). */
  | { estado: "recusado"; detalhe: string }
  /** Rede, tempo esgotado ou erro da própria Meta: não dá para afirmar nada. */
  | { estado: "indisponivel"; detalhe: string };

export type RespostaDoDestino =
  | { estado: "encontrado"; nome: string | null }
  /** O destino não existe, ou o token não o alcança: a Meta responde igual nos dois casos. */
  | { estado: "nao_encontrado"; detalhe: string }
  /** O token vale, mas a Meta negou a leitura deste destino. */
  | { estado: "sem_acesso"; detalhe: string }
  | { estado: "nao_conferido"; detalhe: string };

export type RespostaDasPermissoes =
  | { estado: "lidas"; concedidas: string[] }
  | { estado: "nao_conferido"; detalhe: string };

export interface ConexaoNaMeta {
  token: RespostaDoToken;
  destino: RespostaDoDestino;
  permissoes: RespostaDasPermissoes;
}

interface Resposta {
  ok: boolean;
  status: number;
  corpo: Record<string, unknown> | null;
  /** O código de erro da plataforma, quando ela mandou um. */
  codigo: number | null;
  mensagem: string;
  /** A chamada não chegou a ter resposta (rede, tempo esgotado). */
  semResposta: boolean;
}

async function ler(caminho: string, token: string): Promise<Resposta> {
  let resposta: Response;
  try {
    resposta = await fetch(`${baseDaGraphDeAnuncio()}${caminho}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch (erro) {
    return {
      ok: false,
      status: 0,
      corpo: null,
      codigo: null,
      mensagem: erro instanceof Error ? erro.message : "falha de rede",
      semResposta: true,
    };
  }
  const texto = await resposta.text().catch(() => "");
  let corpo: Record<string, unknown> | null = null;
  try {
    const lido: unknown = JSON.parse(texto);
    if (lido && typeof lido === "object") corpo = lido as Record<string, unknown>;
  } catch {
    // Gateway no meio devolve HTML: fica sem corpo e com o texto cortado.
  }
  const erro = (corpo?.error ?? null) as { code?: unknown; message?: unknown } | null;
  return {
    ok: resposta.ok,
    status: resposta.status,
    corpo,
    codigo: typeof erro?.code === "number" ? erro.code : null,
    mensagem: (typeof erro?.message === "string" ? erro.message : texto).slice(0, 300),
    semResposta: false,
  };
}

/** Os códigos com que a Meta diz "este token não vale". */
const CODIGOS_DE_TOKEN = new Set([190, 102, 463, 467]);
/** Os códigos com que a Meta diz "o token vale, e não pode isto". */
const CODIGOS_DE_PERMISSAO = new Set([10, 200, 272, 294]);

/**
 * Confere a conexão com a Meta. Nunca lança: cada pergunta que não pôde ser
 * feita volta como "não conferido", com o motivo.
 */
export async function conferirConexaoNaMeta(credencial: {
  datasetId: string;
  accessToken: string;
}): Promise<ConexaoNaMeta> {
  const eu = await ler("/me?fields=id", credencial.accessToken);

  let token: RespostaDoToken;
  if (eu.ok) token = { estado: "aceito" };
  else if (eu.semResposta || eu.status >= 500 || eu.status === 429) {
    token = { estado: "indisponivel", detalhe: eu.mensagem };
  } else if (eu.codigo !== null && CODIGOS_DE_TOKEN.has(eu.codigo)) {
    token = { estado: "recusado", detalhe: eu.mensagem };
  } else if (eu.status === 401) {
    token = { estado: "recusado", detalhe: eu.mensagem };
  } else {
    // Um 4xx que não fala de token (há tipo de token que não responde `/me`):
    // não dá para afirmar que ele é ruim. As outras duas perguntas decidem.
    token = { estado: "indisponivel", detalhe: eu.mensagem };
  }

  if (token.estado === "recusado") {
    return {
      token,
      destino: { estado: "nao_conferido", detalhe: "Depende de um token aceito." },
      permissoes: { estado: "nao_conferido", detalhe: "Depende de um token aceito." },
    };
  }

  const [alvo, lista] = await Promise.all([
    ler(`/${encodeURIComponent(credencial.datasetId)}?fields=id,name`, credencial.accessToken),
    ler("/me/permissions", credencial.accessToken),
  ]);

  let destino: RespostaDoDestino;
  if (alvo.ok) {
    const nome = typeof alvo.corpo?.name === "string" ? alvo.corpo.name : null;
    destino = { estado: "encontrado", nome };
    // O destino respondeu com este token: o token vale, mesmo que `/me` não tenha dito.
    if (token.estado === "indisponivel") token = { estado: "aceito" };
  } else if (alvo.codigo !== null && CODIGOS_DE_TOKEN.has(alvo.codigo)) {
    token = { estado: "recusado", detalhe: alvo.mensagem };
    destino = { estado: "nao_conferido", detalhe: "Depende de um token aceito." };
  } else if (alvo.codigo !== null && CODIGOS_DE_PERMISSAO.has(alvo.codigo)) {
    destino = { estado: "sem_acesso", detalhe: alvo.mensagem };
  } else if (alvo.semResposta || alvo.status >= 500 || alvo.status === 429) {
    destino = { estado: "nao_conferido", detalhe: alvo.mensagem };
  } else {
    destino = { estado: "nao_encontrado", detalhe: alvo.mensagem };
  }

  let permissoes: RespostaDasPermissoes;
  const dados = lista.ok && Array.isArray(lista.corpo?.data) ? (lista.corpo.data as unknown[]) : null;
  if (dados) {
    permissoes = {
      estado: "lidas",
      concedidas: dados
        .map((d) => (d && typeof d === "object" ? (d as { permission?: unknown; status?: unknown }) : null))
        .filter((d): d is { permission: string; status?: unknown } => typeof d?.permission === "string")
        .filter((d) => d.status === undefined || d.status === "granted")
        .map((d) => d.permission),
    };
  } else {
    permissoes = { estado: "nao_conferido", detalhe: lista.mensagem };
  }

  return { token, destino, permissoes };
}
