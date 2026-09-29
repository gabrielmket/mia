/**
 * FORK MIA — NO E2E, QUEM ESCOLHE A IA DE UM AGENTE É O DONO DA PLATAFORMA.
 *
 * Neste fork, provedor, modelo, chave e modelo do Operador de um agente são
 * escolha de quem opera a plataforma: `lib/ai/trava-da-ia.ts` no servidor, a
 * migration 9002 no banco. Para o admin da EMPRESA o servidor ignora esses
 * campos — a versão nova herda a IA atual do agente, e o agente novo nasce com
 * o par da plataforma e "a chave desta instalação" (`credential_id` nulo).
 *
 * Specs do upstream que PREPARAM um agente com a IA escolhida à mão (a
 * credencial semeada de `seed-e2e-followup-agent`, o modelo que o QA quer
 * medir) faziam isso como admin da empresa, e aqui passaram a receber o par da
 * plataforma no lugar do pedido. Esta é a preparação feita por quem a faz em
 * produção: o dono da plataforma (`e2e-dono`, em `platform_admins`). O resto de
 * cada spec, e todas as asserções dela, seguem com o usuário que ela escolheu.
 *
 * ── Por que não pôr o par da plataforma (`platform_ia`) no ambiente ─────────
 *
 * Não basta, e o que bastaria muda o resto da suíte. O agente novo do cliente
 * nasce com `credential_id` nulo — "a chave desta instalação" —, e a suíte roda
 * SEM chave de IA de propósito (`INTERNAL_AGENT_RUN_STUB`, o `.env.e2e` sem
 * `*_API_KEY`). Com o par semeado, criar versão cai no mesmo
 * `credential_required` e publicar no mesmo `credential_missing`. Uma chave de
 * provedor no ambiente destravaria as duas, e trocaria a premissa "instalação
 * sem chave" que dezenas de specs medem.
 *
 * O lado do cliente (o corpo ignorado, o painel só de leitura) é cobrado porta
 * a porta em `tests/unit/trava-da-ia-portas.test.ts`.
 */
import type { APIRequestContext, APIResponse, Browser, TestInfo } from "@playwright/test";

import { afirmarDonoDoServidor } from "../utils/precondicao";
import { lerCreds, loginComoDono } from "./login-admin";

/** O que a spec lê de uma resposta, já lido — vale depois de o contexto fechar. */
export interface RespostaLida {
  status(): number;
  ok(): boolean;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/**
 * Lê status e corpo enquanto o contexto do dono está aberto, e devolve o mesmo
 * formato que a spec já usava (`res.status()`, `await res.json()`). Assim a
 * troca na spec é só de QUEM pede; as linhas que conferem a resposta não mudam.
 */
export async function respostaLida(pedido: Promise<APIResponse>): Promise<RespostaLida> {
  const res = await pedido;
  const status = res.status();
  const corpo = await res.text();
  return {
    status: () => status,
    ok: () => status >= 200 && status < 300,
    text: async () => corpo,
    json: async () => JSON.parse(corpo) as unknown,
  };
}

/**
 * Roda `fazer` com uma sessão do dono da plataforma, num contexto de navegador
 * PRÓPRIO — a `page` da spec continua logada com o usuário dela.
 *
 * Leia a resposta (status e corpo) DENTRO de `fazer`: o contexto fecha ao sair
 * daqui, e resposta de contexto fechado não tem mais corpo.
 *
 * Afirma (e, se faltar, concede) o `platform_admins` do `e2e-dono`: quem o
 * promove é `seed-e2e-system-update`, que o CI não roda como passo — sem isto a
 * spec mediria a ordem de execução em vez do produto (`utils/precondicao.ts`).
 */
export async function comoDonoDaPlataforma<T>(
  browser: Browser,
  testInfo: TestInfo,
  fazer: (req: APIRequestContext) => Promise<T>,
): Promise<T> {
  const creds = lerCreds();
  await afirmarDonoDoServidor(creds.users.dono!.email);

  const contexto = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    storageState: undefined,
  });
  try {
    const pagina = await contexto.newPage();
    await loginComoDono(pagina, creds);
    return await fazer(contexto.request);
  } finally {
    await contexto.close();
  }
}
