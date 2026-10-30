"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useT } from "@/hooks/i18n/useT";
import { esquecerCupomNoNavegador, guardarCupomNoNavegador } from "@/lib/cupons/navegador";
import type { CupomPublico } from "@/lib/cupons/publico";
import { fraseDoMotivo } from "@/lib/cupons/regras";

import { CampoDoCupom } from "./CampoDoCupom";
import { SeloDoCupom } from "./SeloDoCupom";

/**
 * FORK MIA (.98) · O CUPOM NA PÁGINA DE PREÇOS (protótipo, tela 1): o link
 * `/precos?cupom=CODIGO` guarda o cupom por 30 dias e os cartões já saem com o
 * desconto (desenhados no servidor). Sem cupom, o campo "Tenho um cupom".
 */
export function CupomNaPaginaDePrecos({ cupom }: { cupom: CupomPublico | null }) {
  const t = useT();
  const router = useRouter();

  useEffect(() => {
    if (cupom?.valido) guardarCupomNoNavegador(cupom.codigo);
  }, [cupom?.valido, cupom?.codigo]);

  const aplicar = (codigo: string) => {
    if (codigo) router.push(`/precos?cupom=${encodeURIComponent(codigo)}`);
  };
  const tirar = () => {
    esquecerCupomNoNavegador();
    router.push("/precos?cupom=");
  };

  if (cupom?.valido && cupom.beneficio !== null) {
    return <SeloDoCupom codigo={cupom.codigo} cupom={{ beneficio: cupom.beneficio, valor: cupom.valor ?? 0, meses: cupom.meses }} parceiro={cupom.parceiro} aoTirar={tirar} />;
  }
  const erro = cupom?.motivo ? fraseDoMotivo(cupom.motivo, { codigo: cupom.codigo, data: cupom.vale_ate }, t) : null;
  return (
    <div className="mx-auto max-w-sm">
      <CampoDoCupom aoAplicar={aplicar} erro={erro} prefixo="precos-cupom" />
    </div>
  );
}
