"use client";

/**
 * FORK MIA (.91) — A FAIXA DOS PRIMEIROS PASSOS no topo de `/app`: "Faltam N
 * para o seu funcionário atender por conta própria · Ver o que falta".
 *
 * Só monta para gestor e administrador de uma empresa que passou pelo passo a
 * passo desta versão (o layout de `/app` confere o segmento gravado antes de
 * desenhar); a rota do "o que falta" confere o resto do critério e diz quantos
 * faltam. Zerou, a faixa some, e com ela o Início.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useOQueFalta } from "@/hooks/assistente/usePrimeirosPassos";
import { useT } from "@/hooks/i18n/useT";

export function FaixaDosPrimeirosPassos() {
  const t = useT();
  const caminho = usePathname();
  const estado = useOQueFalta({ guardar: false });
  const faltam = estado.data?.rotulo?.contas.faltam ?? 0;
  if (!estado.data?.criterio.aparece || faltam === 0 || caminho === "/app/inicio") return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b bg-info-bg px-4 py-2 text-sm text-info-fg" data-testid="faixa-dos-primeiros-passos">
      <span>
        {t("Primeiros passos:")} <strong>{faltam}</strong> {t("ainda faltam para")} {estado.data.rotulo?.agente ?? t("seu funcionário")}{" "}
        {t("atender por conta própria.")}
      </span>
      <Link href="/app/inicio" className="font-medium underline">
        {t("Ver o que falta")}
      </Link>
    </div>
  );
}
