import type { Metadata } from "next";

// FORK MIA (.79, empresa única): a lista é a do fork, em cima do cadastro do
// upstream (components/empresas/ListaDeEmpresas.tsx). A do upstream
// (`./_client.tsx`) fica no repositório como ele a escreveu.
import { ListaDeEmpresas } from "@/components/empresas/ListaDeEmpresas";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Empresas" };

export default function CompaniesPage() {
  return <ListaDeEmpresas />;
}
