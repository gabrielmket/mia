/**
 * FORK MIA (.98) · O CUPOM GUARDADO NO NAVEGADOR POR 30 DIAS (decisão 8).
 *
 * Um cookie comum, não `localStorage`: a página de preços e o cadastro são
 * desenhados no servidor e precisam ler o cupom já na primeira resposta. Não é
 * sessão nem segredo: é o código que o parceiro divulga. Só para o navegador.
 */
import { COOKIE_DO_CUPOM, DIAS_DO_CUPOM_NO_NAVEGADOR } from "./regras";

export function guardarCupomNoNavegador(codigo: string): void {
  try {
    const segundos = DIAS_DO_CUPOM_NO_NAVEGADOR * 24 * 3600;
    document.cookie = `${COOKIE_DO_CUPOM}=${encodeURIComponent(codigo)}; Max-Age=${segundos}; Path=/; SameSite=Lax`;
  } catch {
    // Navegador que recusa cookie: o cupom vale só nesta página.
  }
}

export function esquecerCupomNoNavegador(): void {
  try {
    document.cookie = `${COOKIE_DO_CUPOM}=; Max-Age=0; Path=/; SameSite=Lax`;
  } catch {
    // Nada a fazer.
  }
}
