import type { ReactNode } from "react";

import { CoexistenciaPorEmpresa } from "@/components/admin/coexistencia/CoexistenciaPorEmpresa";

/**
 * FORK MIA · coexistência (S3; docs/fork/coexistencia.md): a tela 5 do
 * protótipo v3, "Coexistência por empresa", abaixo dos cartões de hoje de
 * /admin/meta.
 *
 * Mora num layout do fork, e não dentro de `page.tsx`, para a página do
 * upstream seguir intocada: ela entrega o `FormularioDaMeta` como raiz, e o
 * teste do upstream (`app-da-meta-tela-nao-devolve-segredo.test.tsx`) lê as
 * props desse elemento para provar que nenhum segredo chega ao navegador.
 */
export default function LayoutDaMetaComCoexistencia({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <div className="mt-6">
        <CoexistenciaPorEmpresa />
      </div>
    </>
  );
}
