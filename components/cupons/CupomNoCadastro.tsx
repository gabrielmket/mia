"use client";

import { useEffect, useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { esquecerCupomNoNavegador, guardarCupomNoNavegador } from "@/lib/cupons/navegador";
import type { CupomPublico } from "@/lib/cupons/publico";
import { fraseDoMotivo } from "@/lib/cupons/regras";

import { CampoDoCupom } from "./CampoDoCupom";
import { SeloDoCupom } from "./SeloDoCupom";

/**
 * FORK MIA (.98) · O CUPOM NO CADASTRO (protótipo, tela 1): o selo quando vale no
 * plano marcado; a frase do motivo quando não vale; o campo "Tenho um cupom"
 * quando não há. Trocar o plano no formulário reavalia na hora. Quem confere de
 * verdade é a action (a tela é adulterável).
 */
export function CupomNoCadastro({
  cupom,
  planoId,
  planos,
  erroDoServidor,
  aoMudar,
}: {
  cupom: CupomPublico | null;
  planoId: string | null;
  planos: ReadonlyArray<{ id: string; nome: string }>;
  erroDoServidor: string | null;
  aoMudar: (c: CupomPublico | null) => void;
}) {
  const t = useT();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // O cupom que chegou pelo link fica guardado por 30 dias.
  useEffect(() => {
    if (cupom?.valido) guardarCupomNoNavegador(cupom.codigo);
  }, [cupom?.valido, cupom?.codigo]);

  async function aplicar(codigo: string) {
    setErro(null);
    if (!codigo) {
      setErro(t("Digite o código do cupom."));
      return;
    }
    setOcupado(true);
    try {
      const r = await fetch(`/api/v1/publico/cupom?codigo=${encodeURIComponent(codigo)}`, { cache: "no-store" });
      const corpo = (await r.json().catch(() => ({}))) as { data?: { cupom?: CupomPublico | null } };
      const lido = corpo.data?.cupom ?? null;
      if (!lido) {
        setErro(r.status === 429 ? t("Muitas tentativas. Aguarde alguns minutos.") : fraseDoMotivo("inexistente", { codigo }, t));
        return;
      }
      aoMudar(lido);
    } catch {
      setErro(t("Não deu para falar com o servidor. Confira a conexão e tente de novo."));
    } finally {
      setOcupado(false);
    }
  }

  const tirar = () => {
    esquecerCupomNoNavegador();
    setErro(null);
    aoMudar(null);
  };

  if (cupom?.valido && cupom.beneficio !== null && (planoId === null || cupom.planos.includes(planoId))) {
    return <SeloDoCupom codigo={cupom.codigo} cupom={{ beneficio: cupom.beneficio, valor: cupom.valor ?? 0, meses: cupom.meses }} parceiro={cupom.parceiro} aoTirar={tirar} />;
  }
  const nomeDoPlano = planos.find((p) => p.id === planoId)?.nome ?? "";
  const nomes = planos.filter((p) => cupom?.planos.includes(p.id)).map((p) => p.nome);
  const motivo = cupom ? (cupom.valido ? ("fora_do_plano" as const) : (cupom.motivo ?? "inexistente")) : null;
  const fraseDoCupom = cupom && motivo ? fraseDoMotivo(motivo, { codigo: cupom.codigo, data: cupom.vale_ate, plano: nomeDoPlano, planos: nomes }, t) : null;
  return <CampoDoCupom aoAplicar={aplicar} erro={erro ?? erroDoServidor ?? fraseDoCupom} ocupado={ocupado} prefixo="cadastro-cupom" />;
}
