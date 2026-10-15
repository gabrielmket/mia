/**
 * FORK MIA — as frases de tela da equipe e do convite que são nossas, em espanhol.
 *
 * Moram num arquivo NOSSO, espalhado no fim do `DICIONARIO` do upstream por uma
 * linha (`...DICIONARIO_DA_EQUIPE_MIA`), para a sincronização com o upstream não
 * conflitar a cada frase nova (docs/FORK-MIA.md, regra 1: o nosso mora ao lado
 * do dele). A chave é o texto em português.
 *
 * ⚠️ Não repita aqui uma chave que o upstream já traduz: o espalhamento vem por
 * último e VENCERIA a tradução dele em silêncio.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_DA_EQUIPE_MIA: Traducoes = {
  // A frase do upstream dizia "janela de 24h". No fork o convite vale 15 dias
  // (`INVITE_TTL_SECONDS`), e a frase deixou de citar o número para não voltar a
  // mentir quando o prazo mudar.
  "Este link não é válido ou o prazo do convite já passou. Peça um novo convite a quem administra a sua empresa.": {
    es: "Este enlace no es válido o el plazo de la invitación ya venció. Pide una nueva invitación a quien administra tu empresa.",
  },
  // 9020: o aviso da tela Convidar membros na empresa de demonstração
  // (`app/app/team/invite/_components/AvisoDeConviteNaDemonstracao.tsx`).
  "Esta é a empresa de demonstração. O convite dá acesso a ela, e nada mais sai daqui.": {
    es: "Esta es la empresa de demostración. La invitación da acceso a ella, y nada más sale de aquí.",
  },
  // 9020: o motivo de falha do convite que o banco não gravou
  // (`app/app/team/invite/_components/motivo-da-falha.ts`).
  "Não foi possível registrar este convite, e nenhum e-mail foi enviado. Tente de novo em instantes.": {
    es: "No fue posible registrar esta invitación, y no se envió ningún correo. Inténtalo de nuevo en unos instantes.",
  },
  // 9023: o link curto do convite (`/c/<código>`). A lista de convites da aba
  // Membros (`app/app/team/_components/LinkCurtoDoConvite.tsx`), o resultado da
  // tela Convidar membros (`app/app/team/invite/_components/LinkCurtoDoEnvio.tsx`)
  // e a rota que gera o link novo. "Link do convite" o upstream já traduz.
  "Copiar link do convite": { es: "Copiar enlace de la invitación" },
  "Link novo copiado. O link anterior deste convite, inclusive o do e-mail, deixou de valer.": {
    es: "Enlace nuevo copiado. El enlace anterior de esta invitación, incluido el del correo, dejó de valer.",
  },
  "O link novo foi gerado, mas não deu para copiar sozinho. Copie abaixo e mande para a pessoa. O link anterior deste convite, inclusive o do e-mail, deixou de valer.": {
    es: "El enlace nuevo se generó, pero no se pudo copiar solo. Cópialo abajo y envíalo a la persona. El enlace anterior de esta invitación, incluido el del correo, dejó de valer.",
  },
  "Não foi possível copiar. Selecione o link e copie à mão.": {
    es: "No fue posible copiar. Selecciona el enlace y cópialo a mano.",
  },
  "Convite reenviado com um link novo. O link anterior deixou de valer.": {
    es: "Invitación reenviada con un enlace nuevo. El enlace anterior dejó de valer.",
  },
  "O link curto do convite não está disponível nesta instalação.": {
    es: "El enlace corto de la invitación no está disponible en esta instalación.",
  },
  "Este convite venceu. Use Reenviar para renovar o prazo, e o e-mail novo já leva um link novo.": {
    es: "Esta invitación venció. Usa Reenviar para renovar el plazo, y el correo nuevo ya lleva un enlace nuevo.",
  },
};
