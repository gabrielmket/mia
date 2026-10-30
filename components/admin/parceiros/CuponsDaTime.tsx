"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import type { CupomComUsos } from "@/lib/cupons/banco";
import { diaCivilFormatado, motivoDoCupom, textoDoBeneficio, textoDoSetup } from "@/lib/cupons/regras";

import { gravar, numeroDigitado } from "./chamada";

const SELECT = "h-10 w-full rounded-md border bg-background px-3 text-sm";

export interface PlanoDaTela {
  id: string;
  nome: string;
  arquivado: boolean;
}
export interface ParceiroDoSeletor {
  id: string;
  nome: string;
  comissao_pct: number;
  comissao_meses: number | null;
}

interface Rascunho {
  codigo: string;
  beneficio: "pct" | "reais" | "dias";
  valor: string;
  meses: string;
  setup_tipo: "nenhum" | "pct" | "reais";
  setup_valor: string;
  planos: string[];
  vale_ate: string;
  limite_de_usos: string;
  parceiro_id: string;
  comissao_pct: string;
}

const paraTexto = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

/**
 * FORK MIA (.98) · ADMIN › CUPONS (protótipo "Cupons e parceiros", tela 2): o que
 * cada cupom dá (desconto em % ou em R$ por N mensalidades, ou dias grátis), o
 * desconto no setup, os planos, a validade, o limite de usos, o parceiro e a
 * comissão própria. Cupom não se apaga: pausa.
 */
export function CuponsDaTime({
  cupons,
  planos,
  parceiros,
  enderecoDoSistema,
}: {
  cupons: readonly CupomComUsos[];
  planos: readonly PlanoDaTela[];
  parceiros: readonly ParceiroDoSeletor[];
  enderecoDoSistema: string;
}) {
  const t = useT();
  const router = useRouter();
  const ativos = planos.filter((p) => !p.arquivado);
  const vazio: Rascunho = {
    codigo: "",
    beneficio: "pct",
    valor: "10",
    meses: "3",
    setup_tipo: "nenhum",
    setup_valor: "",
    planos: ativos.map((p) => p.id),
    vale_ate: "",
    limite_de_usos: "",
    parceiro_id: "",
    comissao_pct: "",
  };
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState(false);
  const [n, setN] = useState<Rascunho>(vazio);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const muda = (m: Partial<Rascunho>) => setN((x) => ({ ...x, ...m }));
  const nomeDoPlano = new Map(planos.map((p) => [p.id, p.nome]));
  const parceiroDe = new Map(parceiros.map((p) => [p.id, p]));

  function abrirNovo() {
    setN(vazio);
    setEditando(false);
    setErro(null);
    setAberto((v) => !v);
  }
  function abrirEdicao(c: CupomComUsos) {
    setN({
      codigo: c.codigo,
      beneficio: c.beneficio,
      valor: paraTexto(c.valor),
      meses: c.meses === null ? "0" : String(c.meses),
      setup_tipo: c.setup_tipo,
      setup_valor: paraTexto(c.setup_valor || null),
      planos: [...c.planos],
      vale_ate: c.vale_ate ?? "",
      limite_de_usos: c.limite_de_usos === null ? "" : String(c.limite_de_usos),
      parceiro_id: c.parceiro_id ?? "",
      comissao_pct: paraTexto(c.comissao_pct),
    });
    setEditando(true);
    setErro(null);
    setAberto(true);
  }

  async function salvar() {
    setErro(null);
    setOcupado("salvar");
    const r = await gravar<{ cupom: { codigo: string } }>(
      "/api/v1/admin/cupons",
      "POST",
      {
        codigo: n.codigo,
        beneficio: n.beneficio,
        valor: numeroDigitado(n.valor) ?? 0,
        meses: n.beneficio === "dias" || n.meses === "0" ? null : Number(n.meses),
        setup_tipo: n.setup_tipo,
        setup_valor: n.setup_tipo === "nenhum" ? 0 : (numeroDigitado(n.setup_valor) ?? 0),
        planos: n.planos,
        vale_ate: n.vale_ate || null,
        limite_de_usos: n.limite_de_usos ? Number(n.limite_de_usos) : null,
        parceiro_id: n.parceiro_id || null,
        comissao_pct: n.parceiro_id && n.comissao_pct ? numeroDigitado(n.comissao_pct) : null,
      },
      t,
    );
    setOcupado(null);
    if (!r.ok) {
      setErro(r.campos ? `${r.mensagem} (${Object.keys(r.campos).join(", ")})` : r.mensagem);
      return;
    }
    setAberto(false);
    toast.success(t("Cupom salvo. O link é {link}").replace("{link}", `${enderecoDoSistema}/precos?cupom=${r.data.cupom.codigo}`));
    router.refresh();
  }

  async function mudarSituacao(c: CupomComUsos) {
    setOcupado(c.id);
    const r = await gravar(`/api/v1/admin/cupons/${c.id}`, "PATCH", { ativo: !c.ativo }, t);
    setOcupado(null);
    if (!r.ok) {
      toast.error(r.mensagem);
      return;
    }
    toast.success(c.ativo ? t("Cupom pausado. Quem já entrou com ele continua com o desconto.") : t("Cupom ativado."));
    router.refresh();
  }

  const situacao = (c: CupomComUsos) => {
    const m = motivoDoCupom(c, { planoId: null, usos: c.usos, agora: new Date() });
    if (m === "pausado") return t("pausado");
    if (m === "esgotado") return t("esgotado");
    if (m === "vencido") return t("vencido");
    return t("ativo");
  };

  return (
    <div className="space-y-4" data-cupons="tela">
      <div>
        <Button onClick={abrirNovo} data-cupons="novo">
          {t("Novo cupom")}
        </Button>
      </div>
      {aberto ? (
        <Card className="space-y-4 p-4" data-cupons="formulario">
          <h2 className="text-sm font-semibold">{editando ? t("Mudar o cupom") : t("Novo cupom")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cupom-codigo">{t("Código")}</Label>
              <Input id="cupom-codigo" value={n.codigo} readOnly={editando} placeholder={t("Ex.: MARIA15")} className="uppercase" onChange={(e) => muda({ codigo: e.target.value })} />
              <p className="text-xs text-muted-foreground">{t("Letras e números, sem espaço. É o que vai no link do parceiro.")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cupom-beneficio">{t("O que o cupom dá")}</Label>
              <select id="cupom-beneficio" className={SELECT} value={n.beneficio} onChange={(e) => muda({ beneficio: e.target.value as Rascunho["beneficio"] })}>
                <option value="pct">{t("Desconto em %")}</option>
                <option value="reais">{t("Desconto em R$")}</option>
                <option value="dias">{t("Dias grátis")}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cupom-valor">{n.beneficio === "dias" ? t("Quantos dias grátis") : n.beneficio === "pct" ? t("Desconto (%)") : t("Desconto (R$)")}</Label>
              <Input id="cupom-valor" inputMode="decimal" value={n.valor} onChange={(e) => muda({ valor: e.target.value })} />
            </div>
            {n.beneficio === "dias" ? (
              <div className="space-y-1.5">
                <Label>{t("Depois dos dias grátis")}</Label>
                <p className="pt-2 text-xs text-muted-foreground">{t("Paga o preço cheio do plano. Se o plano já tem teste, vale o maior, sem somar.")}</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="cupom-meses">{t("Por quantas mensalidades")}</Label>
                <select id="cupom-meses" className={SELECT} value={n.meses} onChange={(e) => muda({ meses: e.target.value })}>
                  <option value="1">{t("Só a primeira")}</option>
                  <option value="3">{t("3 primeiras")}</option>
                  <option value="6">{t("6 primeiras")}</option>
                  <option value="12">{t("12 primeiras")}</option>
                  <option value="0">{t("Todas, enquanto for cliente")}</option>
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="cupom-setup">{t("Desconto no setup de implantação")}</Label>
              <select id="cupom-setup" className={SELECT} value={n.setup_tipo} onChange={(e) => muda({ setup_tipo: e.target.value as Rascunho["setup_tipo"] })}>
                <option value="nenhum">{t("Nenhum")}</option>
                <option value="pct">{t("Em %")}</option>
                <option value="reais">{t("Em R$")}</option>
              </select>
            </div>
            {n.setup_tipo === "nenhum" ? (
              <div className="space-y-1.5">
                <Label>{t("Setup")}</Label>
                <p className="pt-2 text-xs text-muted-foreground">{t("Sai pelo preço cheio do plano.")}</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="cupom-setup-valor">{n.setup_tipo === "pct" ? t("Desconto no setup (%)") : t("Desconto no setup (R$)")}</Label>
                <Input id="cupom-setup-valor" inputMode="decimal" value={n.setup_valor} onChange={(e) => muda({ setup_valor: e.target.value })} />
              </div>
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("Vale nos planos")}</Label>
              <div className="flex flex-wrap gap-3">
                {ativos.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={n.planos.includes(p.id)}
                      onChange={(e) => muda({ planos: e.target.checked ? [...n.planos, p.id] : n.planos.filter((x) => x !== p.id) })}
                    />
                    {p.nome}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cupom-ate">
                {t("Vale até")} <span className="font-normal text-muted-foreground">{t("(opcional)")}</span>
              </Label>
              <Input id="cupom-ate" type="date" value={n.vale_ate} onChange={(e) => muda({ vale_ate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cupom-limite">
                {t("Quantas vezes pode ser usado")} <span className="font-normal text-muted-foreground">{t("(opcional)")}</span>
              </Label>
              <Input id="cupom-limite" inputMode="numeric" placeholder={t("sem limite")} value={n.limite_de_usos} onChange={(e) => muda({ limite_de_usos: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cupom-parceiro">{t("Parceiro")}</Label>
              <select id="cupom-parceiro" className={SELECT} value={n.parceiro_id} onChange={(e) => muda({ parceiro_id: e.target.value })}>
                <option value="">{t("Sem parceiro (cupom da Time)")}</option>
                {parceiros.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome} · {paraTexto(p.comissao_pct)}%
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cupom-comissao">
                {t("Comissão deste cupom")} <span className="font-normal text-muted-foreground">{t("(opcional)")}</span>
              </Label>
              <Input
                id="cupom-comissao"
                inputMode="decimal"
                placeholder={t("usa a do parceiro")}
                disabled={!n.parceiro_id}
                value={n.comissao_pct}
                onChange={(e) => muda({ comissao_pct: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">{t("Vazio usa a comissão padrão do parceiro.")}</p>
            </div>
          </div>
          {erro ? (
            <p className="text-sm text-destructive" role="alert">
              {erro}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button disabled={ocupado === "salvar"} onClick={() => void salvar()} data-cupons="salvar">
              {editando ? t("Salvar") : t("Criar o cupom")}
            </Button>
            <Button variant="outline" onClick={() => setAberto(false)}>
              {t("Cancelar")}
            </Button>
          </div>
          {editando ? <p className="text-xs text-muted-foreground">{t("Mudar um cupom vale para quem entrar daqui para a frente. Quem já entrou fica com o combinado do dia em que entrou.")}</p> : null}
        </Card>
      ) : null}

      <Card className="overflow-x-auto p-4">
        {cupons.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Ainda não há cupom. Crie o primeiro com o botão acima.")}</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">{t("Cupom")}</th>
                <th className="pr-4 font-medium">{t("O que dá")}</th>
                <th className="pr-4 font-medium">{t("Planos")}</th>
                <th className="pr-4 font-medium">{t("Parceiro e comissão")}</th>
                <th className="pr-4 text-right font-medium">{t("Usos")}</th>
                <th className="pr-4 font-medium">{t("Vale até")}</th>
                <th className="pr-4 font-medium">{t("Situação")}</th>
                <th>
                  <span className="sr-only">{t("Ações")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {cupons.map((c) => {
                const p = c.parceiro_id ? parceiroDe.get(c.parceiro_id) : null;
                const pct = c.comissao_pct ?? p?.comissao_pct ?? null;
                return (
                  <tr key={c.id} className="border-t align-top" data-cupom={c.codigo}>
                    <td className="py-2 pr-4 font-mono font-semibold">{c.codigo}</td>
                    <td className="py-2 pr-4">
                      {textoDoBeneficio(c, t)}
                      <span className="block text-xs text-muted-foreground">{textoDoSetup(c, t)}</span>
                    </td>
                    <td className="py-2 pr-4">{c.planos.map((id) => nomeDoPlano.get(id) ?? "-").join(", ")}</td>
                    <td className="py-2 pr-4">
                      {p ? (
                        <>
                          {p.nome}
                          <span className="block text-xs text-muted-foreground">
                            {paraTexto(pct)}% {p.comissao_meses === null ? t("enquanto for cliente") : t("por {n} meses").replace("{n}", String(p.comissao_meses))}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("sem parceiro")}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {c.usos}
                      {c.limite_de_usos !== null ? ` ${t("de")} ${c.limite_de_usos}` : ""}
                    </td>
                    <td className="py-2 pr-4">{c.vale_ate ? diaCivilFormatado(c.vale_ate) : t("sem prazo")}</td>
                    <td className="py-2 pr-4">{situacao(c)}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => abrirEdicao(c)}>
                          {t("Mudar")}
                        </Button>
                        <Button size="sm" variant="outline" disabled={ocupado === c.id} onClick={() => void mudarSituacao(c)}>
                          {c.ativo ? t("Pausar") : t("Ativar")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {t("Um cupom usado não se apaga, só se pausa: o cliente que entrou com ele continua com o desconto combinado e o parceiro com a comissão.")}
        </p>
      </Card>
    </div>
  );
}
