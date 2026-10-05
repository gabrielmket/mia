/**
 * FORK MIA · OS SEGMENTOS DA GALERIA DE MODELOS.
 *
 * A galeria nasceu só de clínica (upstream). A MIA atende também imobiliária,
 * loja de carros, academia, empresa que vende serviço para empresa e a indústria
 * que vende para revendas e profissionais, e o dono dessas
 * não se reconhece em "paciente" e "consulta". Cada segmento tem as mesmas
 * quatro jornadas (`jornadas.ts`) com a linguagem dele, e a tela mostra um
 * segmento por vez.
 *
 * "geral" é o padrão: quem abre a galeria sem escolher nada vê texto que serve
 * para qualquer negócio.
 *
 * O rótulo chega à tela por `t(ROTULO_DO_SEGMENTO[nicho])`, chave dinâmica: quem
 * cobra o espanhol de cada um é `modelos.test.ts`.
 */
import type { NichoDeModelo } from "./tipos";

export const SEGMENTO_PADRAO: NichoDeModelo = "geral";

export const ROTULO_DO_SEGMENTO = {
  geral: "Geral",
  clinica: "Saúde e estética",
  imobiliario: "Imobiliário",
  automotivo: "Automotivo",
  academia: "Academias e bem-estar",
  servicos_b2b: "Serviços B2B",
  industria_b2b: "Indústria e distribuição B2B",
} as const satisfies Record<NichoDeModelo, string>;
