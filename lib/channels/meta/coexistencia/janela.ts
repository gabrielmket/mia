/**
 * FORK MIA · coexistência (S3): a JANELA da Meta que conecta o número do app.
 *
 * O cadastro incorporado roda no navegador pelo SDK JS da Meta (`FB.login`
 * com `config_id` e `extras.featureType = "whatsapp_business_app_onboarding"`,
 * a opção do app WhatsApp Business). Para abrir a janela, a tela precisa de
 * três coisas desta instalação:
 *
 * - `META_APP_ID`: o app da MIA na Meta (a variável já existe no `.env`);
 * - `META_COEXISTENCIA_CONFIG_ID`: a configuração do cadastro incorporado criada
 *   no painel do app, com a opção do app WhatsApp Business;
 * - a versão da Graph (`lib/graph-version.ts`).
 *
 * Sem os dois ids a janela não abre e a tela diz o que falta. Nada disto é
 * segredo (vai ao navegador); o segredo é o App Secret, que só o servidor usa
 * para trocar o código pelo token (`conectar.ts`).
 *
 * ─── O nonce da janela ───────────────────────────────────────────────────────
 *
 * A ida assina empresa e pessoa (`estado-da-volta.ts`, o mesmo HMAC da conexão
 * por um clique) e vale 10 minutos. A volta só conecta quando a assinatura
 * confere, o prazo não venceu e a empresa e a pessoa são as da sessão que
 * concluiu: quem trocou de empresa no meio da janela não amarra o número na
 * empresa errada. O código da Meta é de uso único do lado dela, e a gravação é
 * idempotente do nosso (`conectar.ts`), então a mesma volta duas vezes dá uma
 * sessão e um ciclo.
 */
import { graphVersion } from "@/lib/graph-version";

import { emitirEstadoDaVolta, verificarEstadoDaVolta } from "../../estado-da-volta";

/** A opção do cadastro incorporado que conecta o número do app WhatsApp Business. */
export const RECURSO_DA_JANELA = "whatsapp_business_app_onboarding";

/** O evento do `postMessage` da janela quando o cliente termina pelo app. */
export const FIM_DA_JANELA_PELO_APP = "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";

/** O que o nonce leva no lugar do perfil do provedor: marca que é desta janela. */
const MARCA_DO_NONCE = "coexistencia";

export const VALIDADE_DO_NONCE_MS = 10 * 60 * 1000;

export const VARIAVEIS_DA_JANELA = ["META_APP_ID", "META_COEXISTENCIA_CONFIG_ID"] as const;

export type ConfiguracaoDaJanela =
  | { ok: true; appId: string; configId: string; graphVersion: string }
  | { ok: false; faltaNoAmbiente: string[] };

function texto(v: string | undefined): string {
  return (v ?? "").trim();
}

/** O que a tela precisa para abrir a janela. Vazio é ausente, como no resto do `.env`. */
export function configuracaoDaJanela(
  source: Record<string, string | undefined> = process.env,
): ConfiguracaoDaJanela {
  const appId = texto(source.META_APP_ID);
  const configId = texto(source.META_COEXISTENCIA_CONFIG_ID);
  const faltam = VARIAVEIS_DA_JANELA.filter((nome) => texto(source[nome]) === "");
  if (faltam.length > 0 || !appId || !configId) return { ok: false, faltaNoAmbiente: [...faltam] };
  return { ok: true, appId, configId, graphVersion: graphVersion() };
}

export function emitirNonceDaJanela(
  dados: { organizationId: string; userId: string },
  opcoes: { segredo: string; agora: Date },
): string {
  return emitirEstadoDaVolta(
    { ...dados, profileId: MARCA_DO_NONCE },
    { segredo: opcoes.segredo, agora: opcoes.agora, validadeMs: VALIDADE_DO_NONCE_MS },
  );
}

/**
 * O nonce vale para ESTA empresa e ESTA pessoa? Falso para tudo o que não for
 * um nonce nosso, íntegro, da janela e no prazo. Nunca lança por entrada ruim.
 */
export function nonceDaJanelaConfere(
  nonce: string | null | undefined,
  esperado: { organizationId: string; userId: string },
  opcoes: { segredo: string; agora: Date },
): boolean {
  const lido = verificarEstadoDaVolta(nonce, opcoes);
  return (
    lido !== null &&
    lido.profileId === MARCA_DO_NONCE &&
    lido.organizationId === esperado.organizationId &&
    lido.userId === esperado.userId
  );
}
