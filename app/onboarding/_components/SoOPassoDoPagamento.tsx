"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * FORK MIA (.96) · a empresa que espera o primeiro pagamento só vê o passo
 * "Pagamento" (o resto do início não abre antes de pagar). Os passos do
 * upstream que perguntam a organização já são levados para lá pelo servidor
 * (`resolveActiveOrg`); esta guarda cobre a página que não pergunta.
 */
export function SoOPassoDoPagamento({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const noPasso = pathname.startsWith("/onboarding/pagamento");
  useEffect(() => {
    if (!noPasso) router.replace("/onboarding/pagamento");
  }, [noPasso, router]);
  return noPasso ? <>{children}</> : null;
}
