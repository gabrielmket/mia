/**
 * FORK MIA (.64) — o botão "Entrar com Google" só aparece quando o Google está
 * LIGADO no GoTrue desta instalação.
 *
 * ─── O defeito ─────────────────────────────────────────────────────────────
 *
 * A tela de entrar mostrava o botão sempre. Numa instalação sem o provedor
 * Google (a da MIA), o clique só servia para receber "O Google não está
 * habilitado nesta instalação..." — um botão que existe para dizer que não
 * funciona. A conferência na hora do clique (`estadoDoProvedorGoogle`, issue
 * #1652 do upstream) continua valendo; esta é a mesma pergunta feita ANTES,
 * na hora de desenhar a tela.
 *
 * ─── Por que falha FECHADO aqui, e aberto lá ───────────────────────────────
 *
 * `estadoDoProvedorGoogle` devolve `desconhecido` quando não consegue ler as
 * settings, e a action do clique trata isso como "tenta o redirect": lá, a
 * pessoa JÁ clicou, e recusar por falta de rede trancaria quem tem o Google
 * ligado. Aqui a decisão é outra — desenhar ou não um botão. Sem saber, não
 * desenha: o pior caso é alguém entrar com e-mail e senha num dia em que o
 * GoTrue não respondeu as settings, e não um botão que leva a um erro.
 *
 * ─── Cache curto, no processo ──────────────────────────────────────────────
 *
 * A tela de entrar é a porta mais aberta do produto, e perguntar ao GoTrue a
 * cada pintura é uma ida de rede por visita. A resposta muda quando alguém
 * liga o provedor no GoTrue e reinicia o contêiner dele — raro, e um minuto de
 * atraso não engana ninguém. `desconhecido` guarda por menos tempo: é uma falha
 * passageira, e o botão deve voltar logo que o GoTrue responder.
 *
 * Pedidos simultâneos com o cache vencido esperam a MESMA leitura (`emVoo`):
 * uma rajada de visitas não vira uma rajada de pedidos ao GoTrue.
 */
import { estadoDoProvedorGoogle, type EstadoDoProvedorGoogle } from "./provedor-google";

/** Quanto vale a resposta lida (`ligado`/`desligado`). */
export const VALIDADE_DA_RESPOSTA_MS = 60_000;
/** Quanto vale "não deu para ler": curto, para o botão voltar logo. */
export const VALIDADE_DO_DESCONHECIDO_MS = 10_000;

let guardado: { estado: EstadoDoProvedorGoogle; valeAte: number } | null = null;
let emVoo: Promise<EstadoDoProvedorGoogle> | null = null;

async function estadoEmCache(): Promise<EstadoDoProvedorGoogle> {
  if (guardado && guardado.valeAte > Date.now()) return guardado.estado;
  emVoo ??= estadoDoProvedorGoogle()
    // `estadoDoProvedorGoogle` não lança (devolve `desconhecido`), mas a
    // promessa compartilhada não pode ficar presa num erro inesperado.
    .catch((): EstadoDoProvedorGoogle => "desconhecido")
    .then((estado) => {
      const validade =
        estado === "desconhecido" ? VALIDADE_DO_DESCONHECIDO_MS : VALIDADE_DA_RESPOSTA_MS;
      guardado = { estado, valeAte: Date.now() + validade };
      return estado;
    })
    .finally(() => {
      emVoo = null;
    });
  return emVoo;
}

/**
 * A tela deve desenhar o botão do Google? Só com `ligado` lido nas settings do
 * GoTrue. `desligado` e `desconhecido` escondem o botão e o separador "ou".
 */
export async function googleNaTelaDeEntrar(): Promise<boolean> {
  return (await estadoEmCache()) === "ligado";
}

/** Só para teste: esquece a leitura guardada. */
export function esquecerEstadoDoGoogleNaTela(): void {
  guardado = null;
  emVoo = null;
}
