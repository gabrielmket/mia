/**
 * FORK MIA · coexistência (S3): o SDK JS da Meta no navegador, só para abrir
 * a janela do cadastro incorporado com a opção do app WhatsApp Business.
 *
 * Lido em 17/11/2026 (embedded-signup/custom-flows/onboarding-business-app-users):
 * `FB.login` com `config_id`, `response_type: "code"`,
 * `override_default_response_type: true` e
 * `extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" }`.
 * A janela devolve o CÓDIGO no callback do `FB.login` e, por `postMessage`
 * (`type: "WA_EMBEDDED_SIGNUP"`), o fim pelo app
 * (`event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"`) com `data.waba_id`.
 * Os dois chegam em qualquer ordem: a volta só termina com os dois.
 *
 * Decisão D2 (17/11/2026): o `featureType` é a opção da v4 do cadastro
 * incorporado; na v5 ela já vem ligada por padrão e o campo é ignorado. O
 * fluxo é o mesmo nas duas.
 *
 * Nada de credencial aqui: o código é de uso único e só vale com o App Secret,
 * que mora no servidor. Testes de tela usam um dublê de `window.FB` (o script
 * não é carregado quando ele já existe).
 */

/** O endereço do SDK, por idioma. Host declarado em `tests/unit/branding.test.ts`. */
const SDK_DA_META = (locale: string) => `https://connect.facebook.net/${locale}/sdk.js`;

/** Só aceita o `postMessage` vindo da Meta. */
const ORIGENS_DA_META = /^https:\/\/([a-z0-9-]+\.)*facebook\.com$/;

/** A janela pode pedir QR no celular: 15 minutos para terminar. */
const TEMPO_DA_JANELA_MS = 15 * 60 * 1000;

export type MotivoDaJanela = "fechada" | "sem_sdk" | "tempo_esgotado" | "incompleta";

export class JanelaDaMetaNaoTerminou extends Error {
  constructor(readonly motivo: MotivoDaJanela) {
    super(`janela_da_meta:${motivo}`);
  }
}

export interface VoltaDaJanela {
  code: string;
  wabaId: string;
  phoneNumberId: string | null;
}

interface RespostaDoLogin {
  authResponse?: { code?: string } | null;
  status?: string;
}

interface SdkDaMeta {
  init(opcoes: Record<string, unknown>): void;
  login(callback: (r: RespostaDoLogin) => void, opcoes: Record<string, unknown>): void;
}

declare global {
  interface Window {
    FB?: SdkDaMeta;
    fbAsyncInit?: () => void;
  }
}

let carregando: Promise<SdkDaMeta> | null = null;

function carregarSdk(input: { appId: string; graphVersion: string; locale: string }): Promise<SdkDaMeta> {
  if (window.FB) {
    window.FB.init({ appId: input.appId, autoLogAppEvents: true, xfbml: false, version: input.graphVersion });
    return Promise.resolve(window.FB);
  }
  if (carregando) return carregando;
  carregando = new Promise<SdkDaMeta>((resolve, reject) => {
    window.fbAsyncInit = () => {
      if (!window.FB) return reject(new JanelaDaMetaNaoTerminou("sem_sdk"));
      window.FB.init({ appId: input.appId, autoLogAppEvents: true, xfbml: false, version: input.graphVersion });
      resolve(window.FB);
    };
    const script = document.createElement("script");
    script.src = SDK_DA_META(input.locale);
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      carregando = null;
      reject(new JanelaDaMetaNaoTerminou("sem_sdk"));
    };
    document.body.appendChild(script);
  });
  return carregando;
}

/** Lê o `postMessage` da janela. `null` para tudo o que não é o fim pelo app. */
export function lerFimDaJanela(origem: string, dado: unknown): { wabaId: string; phoneNumberId: string | null } | "cancelada" | null {
  if (!ORIGENS_DA_META.test(origem)) return null;
  let corpo: unknown = dado;
  if (typeof dado === "string") {
    try {
      corpo = JSON.parse(dado);
    } catch {
      return null;
    }
  }
  const c = corpo as { type?: unknown; event?: unknown; data?: Record<string, unknown> } | null;
  if (!c || c.type !== "WA_EMBEDDED_SIGNUP") return null;
  if (c.event === "CANCEL") return "cancelada";
  if (c.event !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") return null;
  const wabaId = typeof c.data?.waba_id === "string" ? c.data.waba_id : null;
  if (!wabaId) return null;
  const phoneNumberId = typeof c.data?.phone_number_id === "string" ? c.data.phone_number_id : null;
  return { wabaId, phoneNumberId };
}

export async function abrirJanelaDaMeta(input: {
  appId: string;
  configId: string;
  graphVersion: string;
  locale: string;
}): Promise<VoltaDaJanela> {
  const sdk = await carregarSdk(input);
  return new Promise<VoltaDaJanela>((resolve, reject) => {
    let code: string | null = null;
    let fim: { wabaId: string; phoneNumberId: string | null } | null = null;
    let loginVoltou = false;

    const terminar = (erro?: JanelaDaMetaNaoTerminou) => {
      window.removeEventListener("message", ouvir);
      clearTimeout(relogio);
      if (erro) return reject(erro);
      if (code && fim) resolve({ code, wabaId: fim.wabaId, phoneNumberId: fim.phoneNumberId });
    };
    const talvezTerminar = () => {
      if (code && fim) terminar();
      // O login voltou sem código: o cliente fechou a janela.
      else if (loginVoltou && !code) terminar(new JanelaDaMetaNaoTerminou("fechada"));
    };
    const ouvir = (ev: MessageEvent) => {
      const lido = lerFimDaJanela(ev.origin, ev.data);
      if (lido === null) return;
      if (lido === "cancelada") return terminar(new JanelaDaMetaNaoTerminou("fechada"));
      fim = lido;
      talvezTerminar();
    };
    const relogio = setTimeout(() => terminar(new JanelaDaMetaNaoTerminou("tempo_esgotado")), TEMPO_DA_JANELA_MS);
    window.addEventListener("message", ouvir);

    sdk.login(
      (r) => {
        loginVoltou = true;
        code = typeof r?.authResponse?.code === "string" ? r.authResponse.code : null;
        // O código chegou e o fim ainda não: espera o `postMessage` por 30 s.
        if (code && !fim) {
          setTimeout(() => {
            if (!fim) terminar(new JanelaDaMetaNaoTerminou("incompleta"));
          }, 30_000);
        }
        talvezTerminar();
      },
      {
        config_id: input.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      },
    );
  });
}
