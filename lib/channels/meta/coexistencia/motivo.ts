/**
 * FORK MIA · coexistência (S4): o MOTIVO que a Meta dá para tirar o número da
 * API, em palavras. Puro e sem servidor: o aviso da Central (`avisos.ts`) e o
 * cartão do canal (`components/connections/coexistencia/`) dizem a mesma frase.
 *
 * Um literal por ramo dentro de `t(...)`: a cerca de i18n cobra o espanhol do
 * que lê escrito. O vocabulário é o do CHECK da 9162.
 */
export function motivoDaSaidaEmPalavras(motivo: string | null | undefined, t: (texto: string) => string): string {
  switch (motivo) {
    case "ACCOUNT_DISCONNECTED":
      return t("o número foi desconectado pelo dono no app WhatsApp Business.");
    case "BUSINESS_DOWNGRADE":
      return t("o número deixou o WhatsApp Business e virou WhatsApp comum.");
    case "CHANGE_NUMBER":
      return t("o número foi trocado no app.");
    case "COMPANION_INACTIVITY":
      return t("um aparelho conectado ficou parado por cerca de 30 dias.");
    case "PRIMARY_INACTIVITY":
      return t("o celular ficou sem abrir o app WhatsApp Business por cerca de 14 dias.");
    case "USER_RE_REGISTERED":
      return t("o número foi instalado de novo em outro celular.");
    case "ACCOUNT_OFFBOARDED":
      return t("a conta saiu da coexistência.");
    default:
      return t("a Meta não informou o motivo.");
  }
}
