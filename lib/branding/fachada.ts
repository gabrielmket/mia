/**
 * FORK MIA (.64) — a fachada de acesso JÁ mostra a marca?
 *
 * A casca de `app/(public)/layout.tsx` desenha, acima de toda tela de acesso:
 *
 *   · o LOGO configurado (claro e/ou escuro), quando há um;
 *   · senão, o logotipo do PRODUTO (símbolo + nome), quando a marca é a padrão;
 *   · senão, nada: nome próprio sem logo.
 *
 * O subtítulo com o nome da marca logo abaixo de "Entrar" repetia o que o logo
 * acabou de dizer (na MIA: o logo, "Entrar" e "MIA" de novo). Ele só tem
 * função no terceiro caso, em que é o ÚNICO lugar da tela que nomeia a marca.
 *
 * Mesma condição do layout, lida da mesma resolução (`marcaDaSaida(null)`):
 * se o layout mudar a regra, `tests/unit/login-sem-subtitulo-e-google-so-ligado.test.tsx`
 * mede as duas pontas pelo que a tela mostra.
 */
import { marcaEhADoProduto } from "@/lib/branding";

import type { MarcaDeSaida } from "./saida";

export function fachadaMostraAMarca(
  marca: Pick<MarcaDeSaida, "nome" | "logoUrl" | "logoDarkUrl">,
): boolean {
  if (marca.logoUrl || marca.logoDarkUrl) return true;
  return marcaEhADoProduto({ name: marca.nome, logoUrl: null });
}
