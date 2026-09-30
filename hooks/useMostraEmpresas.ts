"use client";

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";

import { mostraEmpresas, type ModoDeVenda } from "@/lib/empresas/modo-de-venda";

/**
 * O modo de venda da organização ativa, entregue PRONTO pelo layout de `/app`.
 *
 * ── Por que um contexto próprio, e não `useAuth()` ────────────────────────
 *
 * Era `useAuth().activeOrg?.modo_de_venda`, e isso amarrou o `NewLeadDialog` —
 * componente do upstream, onde o seletor de empresa entra — ao
 * `<AuthProvider>`. O upstream monta esse diálogo SOZINHO nos testes dele
 * (`novo-lead-escolhe-contato`), e a fusão da v1.60 derrubou quatro casos com
 * "useAuth must be used inside <AuthProvider>". É o mesmo acoplamento que o
 * upstream já pagou com o idioma (ver o comentário do `IdiomaProvider` em
 * `app/app/layout.tsx`), e o conserto é o dele: o provedor recebe o valor e não
 * pergunta quem está logado.
 *
 * `null` = nenhum provedor na árvore. Ver `useMostraEmpresas`.
 */
const ModoDeVendaCtx = createContext<{ modo: ModoDeVenda | undefined } | null>(null);

/**
 * Montado UMA vez, em `app/app/layout.tsx`, com o `modo_de_venda` que o layout
 * já leu de `organizations.settings` — nenhuma consulta a mais.
 */
export function ProvedorDoModoDeVenda({
  modo,
  children,
}: {
  modo: ModoDeVenda | undefined;
  children: ReactNode;
}) {
  const valor = useMemo(() => ({ modo }), [modo]);
  return createElement(ModoDeVendaCtx.Provider, { value: valor }, children);
}

/**
 * Esta organização enxerga a entidade empresa? (item C2)
 *
 * Um hook e não `modo_de_venda === "b2b"` espalhado pelas telas: a pergunta que
 * a tela faz é "mostro o campo?", e quem escreve um formulário não deveria
 * precisar saber que B2B é o modo que mostra.
 *
 * ⚠️ NÃO é autorização. As rotas de `/api/v1/empresas` continuam atendendo — o
 * modo esconde a porta, não tranca. Ver `lib/empresas/modo-de-venda.ts`.
 *
 * Três estados, e eles não são o mesmo:
 *
 *  - provedor com modo → o modo decide;
 *  - provedor SEM modo → `true`: na dúvida o produto mostra de mais. Esconder
 *    um campo porque o valor não chegou faria o operador abrir o cadastro, não
 *    achar a empresa, e concluir que o sistema perdeu o dado;
 *  - SEM provedor → `false`. Fora da casca de `/app` (um componente montado
 *    sozinho, num teste ou num fragmento) não há organização de quem listar
 *    empresas, e o seletor seria uma lista que não carrega. Dentro da casca o
 *    provedor sempre existe — vigiado por
 *    `tests/unit/modo-de-venda-desce-pelo-layout.test.tsx`.
 */
export function useMostraEmpresas(): boolean {
  const ctx = useContext(ModoDeVendaCtx);
  if (!ctx) return false;
  return mostraEmpresas(ctx.modo);
}
