"use client";

import { Component, type ReactNode } from "react";

/**
 * FORK MIA (.90) — o bloco NOSSO dentro de uma tela do upstream nunca derruba a
 * tela dele. Um erro de renderização aqui dentro (dado inesperado, um plano que
 * chegou depois do primeiro desenho) some com o bloco e deixa o resto da página
 * de pé, em vez de levar a página inteira para a tela de erro.
 *
 * Usado na página dos módulos dos planos (`/admin/cobranca/modulos-dos-planos`):
 * se o bloco cair, a página segue com o caminho de volta para a aba do upstream.
 */
export class ContornoDoBloco extends Component<{ children: ReactNode }, { quebrou: boolean }> {
  state = { quebrou: false };

  static getDerivedStateFromError(): { quebrou: boolean } {
    return { quebrou: true };
  }

  componentDidCatch(erro: unknown): void {
    console.warn("[planos-mia] o bloco caiu e a tela seguiu", erro);
  }

  render(): ReactNode {
    return this.state.quebrou ? null : this.props.children;
  }
}
