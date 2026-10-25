// Mesma porta do módulo de empresas (doc 68): desligado, 404.
// FORK MIA (.90): com a cobrança ligada, a empresa num plano sem Vendas B2B vê
// "não está no plano" (components/planos-mia/PortaDeVendasB2b.tsx).
import type { ReactNode } from "react";

import { PortaDeVendasB2b } from "@/components/planos-mia/PortaDeVendasB2b";

export default function Layout({ children }: { children: ReactNode }) {
  return <PortaDeVendasB2b>{children}</PortaDeVendasB2b>;
}
