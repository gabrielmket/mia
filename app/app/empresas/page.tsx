import type { Metadata } from "next";

import { EmpresasClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Empresas" };

export default function EmpresasPage() {
  return <EmpresasClient />;
}
