/**
 * FORK MIA — a marca POR EMPRESA fica TRAVADA na plataforma MIA.
 *
 * ─── O pedido ────────────────────────────────────────────────────────────────
 *
 * Do dono da plataforma (29/09/2026): "no sistema só a MINHA logo aparece; o
 * cliente não pode colocar a dele". O upstream deixa o admin de cada empresa
 * trocar nome, cor e logo em `/app/settings/marca`, por cima da marca da
 * instalação (`/admin/marca`). Na MIA, quem vende e atende é a plataforma: a
 * marca que o cliente vê dentro do sistema é a dela.
 *
 * ─── Onde a trava mora, e por que ali ────────────────────────────────────────
 *
 * Na LEITURA, antes de tudo: `marcaDaOrganizacaoDeSettings`
 * (`lib/branding/organizacao.ts`) devolve `null` quando a marca está travada.
 * É o único lugar que sabe que a marca da empresa mora em
 * `organizations.settings.branding` — a casca de `/app`, o e-mail, o PDF da
 * proposta e a rota do logo passam por ele. Travar ali é a trava de verdade:
 * mesmo que alguém grave pelo banco ou pela RPC, nada aparece.
 *
 * A escrita também recusa (server action e rota do logo), e a tela sai do menu
 * e do hub — mas essas são a CORTESIA, não a garantia.
 *
 * O dado gravado NÃO é apagado. Destravar devolve cada empresa à marca que ela
 * tinha, sem ninguém precisar refazer nada.
 *
 * ─── Por que é uma variável, e por que o padrão é o do upstream ──────────────
 *
 * As e2e do upstream (`marca-logo.spec.ts`, `logo-moldura-no-tema-escuro.spec.ts`)
 * sobem logo de EMPRESA pela tela, e rodam no CI do fork. Travar sem condição
 * reprovaria teste do upstream — e mudar teste dele para passar é afrouxar
 * cerca. Então: sem a variável, o produto se comporta como o upstream (e as e2e
 * dele continuam provando a feature dele); o `docker-compose.easypanel.yml`, que
 * é NOSSO e é o único jeito como a MIA vai ao ar, grava `travada`. Os testes do
 * fork provam a trava com a variável ligada.
 *
 * Lida de `process.env` e não de `@/lib/env` de propósito: o valor é lido no
 * caminho de render do layout de `/app`, e um `z.enum` em `lib/env.ts` lançaria
 * no import (ver o comentário ao lado de `APP_ACCENT_HEX` lá). Valor
 * irreconhecível conta como LIBERADA — igual à ausência.
 */

/** O `href` da tela do upstream que edita a marca da empresa. */
export const TELA_DA_MARCA_DA_ORGANIZACAO = "/app/settings/marca";

/**
 * A chave que o MENU cobra para mostrar essa tela (ver `lib/modulos/vendaveis.ts`).
 * Não é módulo vendável: é uma decisão da INSTALAÇÃO, e quem a põe na lista do
 * menu é `modulosDaOrganizacao` quando a marca por empresa está liberada.
 */
export const CHAVE_DA_MARCA_DA_ORGANIZACAO = "marca_da_organizacao";

type Ambiente = Readonly<Record<string, string | undefined>>;

export function marcaDaOrganizacaoTravada(ambiente: Ambiente = process.env): boolean {
  return (ambiente.MARCA_DA_ORGANIZACAO ?? "").trim().toLowerCase() === "travada";
}

/** A frase que a tela e as recusas mostram. Uma só, para não divergir. */
export const MARCA_DEFINIDA_PELA_PLATAFORMA =
  "A marca é definida pela plataforma: nome, cor e logo são os mesmos para todas as empresas.";
