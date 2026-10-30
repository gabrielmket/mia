"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { reais } from "@/lib/cupons/regras";
import { formatarDocumento } from "@/lib/dados-fiscais/regras";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import type { ParceiroNaLista } from "@/lib/parceiros/leitura";

import { gravar, numeroDigitado } from "./chamada";

const SELECT = "h-10 w-full rounded-md border bg-background px-3 text-sm";

interface Rascunho {
  nome: string;
  documento: string;
  email: string;
  chave_pix: string;
  comissao_pct: string;
  comissao_meses: string;
  comissao_setup_pct: string;
}

const texto = (n: number) => String(n).replace(".", ",");
const VAZIO: Rascunho = { nome: "", documento: "", email: "", chave_pix: "", comissao_pct: "", comissao_meses: "12", comissao_setup_pct: "" };

function rascunhoDe(p: ParceiroNaLista): Rascunho {
  return {
    nome: p.nome,
    documento: p.documento ? formatarDocumento(p.documento) : "",
    email: p.email ?? "",
    chave_pix: p.chave_pix ?? "",
    comissao_pct: texto(p.comissao_pct),
    comissao_meses: p.comissao_meses === null ? "0" : String(p.comissao_meses),
    comissao_setup_pct: texto(p.comissao_setup_pct),
  };
}

/**
 * FORK MIA (.98) · ADMIN › PARCEIROS (protótipo "Cupons e parceiros", tela 3): quem
 * indica, quanto gerou e quanto tem a receber. Os dados para o repasse, a comissão
 * da mensalidade (% e prazo) e a do setup (%, venda única), os cupons e os clientes
 * de cada um. Mudar a comissão vale para os clientes novos. LGPD do parceiro: a
 * cópia dos dados e a anonimização.
 */
export function ParceirosDaTime({ parceiros, semAliquota }: { parceiros: readonly ParceiroNaLista[]; semAliquota: boolean }) {
  const t = useT();
  const idioma = useIdioma();
  const router = useRouter();
  const [selecionado, setSelecionado] = useState<string | "novo" | null>(parceiros[0]?.id ?? null);
  const atual = parceiros.find((p) => p.id === selecionado) ?? null;
  const [r, setR] = useState<Rascunho>(atual ? rascunhoDe(atual) : VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const muda = (m: Partial<Rascunho>) => setR((x) => ({ ...x, ...m }));
  const dia = (iso: string | null) => (iso ? new Intl.DateTimeFormat(idioma, { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso)) : "-");

  function escolher(id: string | "novo") {
    setSelecionado(id);
    setErro(null);
    const p = parceiros.find((x) => x.id === id);
    setR(p ? rascunhoDe(p) : VAZIO);
  }

  async function salvar() {
    setErro(null);
    setOcupado(true);
    const corpo = {
      nome: r.nome,
      documento: r.documento,
      email: r.email,
      chave_pix: r.chave_pix,
      comissao_pct: numeroDigitado(r.comissao_pct) ?? -1,
      comissao_meses: r.comissao_meses === "0" ? null : Number(r.comissao_meses),
      comissao_setup_pct: numeroDigitado(r.comissao_setup_pct) ?? 0,
    };
    const res = atual
      ? await gravar<{ parceiro: { id: string } }>(`/api/v1/admin/parceiros/${atual.id}`, "PUT", corpo, t)
      : await gravar<{ parceiro: { id: string } }>("/api/v1/admin/parceiros", "POST", corpo, t);
    setOcupado(false);
    if (!res.ok) {
      setErro(res.campos ? `${res.mensagem} (${Object.keys(res.campos).join(", ")})` : res.mensagem);
      return;
    }
    toast.success(t("Salvo. A comissão nova vale para os clientes que entrarem daqui para a frente."));
    setSelecionado(res.data.parceiro.id);
    router.refresh();
  }

  async function anonimizar() {
    if (!atual) return;
    if (!window.confirm(t("Anonimizar este parceiro? Nome, CPF ou CNPJ, e-mail, Pix e os anexos dos repasses saem de vez. Os valores ficam, como registro financeiro."))) return;
    setOcupado(true);
    const res = await gravar(`/api/v1/admin/parceiros/${atual.id}/anonimizar`, "POST", {}, t);
    setOcupado(false);
    if (!res.ok) {
      toast.error(res.mensagem);
      return;
    }
    toast.success(t("Parceiro anonimizado."));
    router.refresh();
  }

  return (
    <div className="space-y-4" data-parceiros="tela">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => escolher("novo")} data-parceiros="novo">
          {t("Novo parceiro")}
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin/parceiros/repasses">{t("Repasses do mês")}</Link>
        </Button>
      </div>
      {semAliquota ? (
        <p className="rounded-md border border-warning-fg/30 bg-warning-bg px-3 py-2 text-sm text-warning-fg" role="alert">
          {t("Sem a alíquota do imposto, nenhuma comissão é lançada. Preencha em Admin › Cobrança › Conexão.")}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        {parceiros.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={selecionado === p.id}
            onClick={() => escolher(p.id)}
            className={`space-y-2 rounded-md border bg-card p-3 text-left ${selecionado === p.id ? "border-primary" : ""}`}
            data-parceiro={p.id}
          >
            <span className="block text-sm font-semibold">{p.nome}</span>
            <span className="block text-xs text-muted-foreground">
              {p.anonimizado_em ? t("anonimizado") : p.tipo_documento === "cnpj" ? t("Pessoa jurídica · CNPJ") : t("Pessoa física · CPF")}
            </span>
            <Linha rotulo={t("Comissão da mensalidade")} valor={`${texto(p.comissao_pct)}% · ${p.comissao_meses === null ? t("sempre") : t("{n} meses").replace("{n}", String(p.comissao_meses))}`} />
            <Linha rotulo={t("Setup de implantação")} valor={`${texto(p.comissao_setup_pct)}% · ${t("venda única")}`} />
            <Linha rotulo={t("Clientes")} valor={String(p.clientes.length)} />
            <Linha rotulo={t("Pago pelos clientes no mês")} valor={reais(p.pago_no_mes_cents)} />
            <Linha rotulo={t("A receber no próximo fechamento")} valor={reais(p.a_receber_cents)} />
          </button>
        ))}
      </div>

      {selecionado ? (
        <Card className="space-y-4 p-4" data-parceiros="formulario">
          <h2 className="text-sm font-semibold">{atual ? atual.nome : t("Novo parceiro")}</h2>
          {atual?.anonimizado_em ? (
            <p className="text-sm text-muted-foreground">{t("Este parceiro foi anonimizado em {data}. Os valores ficam, como registro financeiro.").replace("{data}", dia(atual.anonimizado_em))}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="parceiro-nome">{t("Nome")}</Label>
                  <Input id="parceiro-nome" value={r.nome} onChange={(e) => muda({ nome: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="parceiro-doc">{t("CPF ou CNPJ")}</Label>
                  <Input id="parceiro-doc" value={r.documento} onChange={(e) => muda({ documento: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="parceiro-email">{t("E-mail do extrato")}</Label>
                  <Input id="parceiro-email" type="email" value={r.email} onChange={(e) => muda({ email: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="parceiro-pix">{t("Chave Pix para o repasse")}</Label>
                  <Input id="parceiro-pix" value={r.chave_pix} onChange={(e) => muda({ chave_pix: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="parceiro-comissao">{t("Comissão da mensalidade (%)")}</Label>
                  <Input id="parceiro-comissao" inputMode="decimal" value={r.comissao_pct} onChange={(e) => muda({ comissao_pct: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="parceiro-meses">{t("Por quanto tempo")}</Label>
                  <select id="parceiro-meses" className={SELECT} value={r.comissao_meses} onChange={(e) => muda({ comissao_meses: e.target.value })}>
                    <option value="6">{t("6 meses de cada cliente")}</option>
                    <option value="12">{t("12 meses de cada cliente")}</option>
                    <option value="24">{t("24 meses de cada cliente")}</option>
                    <option value="0">{t("Enquanto o cliente pagar")}</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="parceiro-setup">{t("Comissão do setup de implantação (%)")}</Label>
                  <Input id="parceiro-setup" inputMode="decimal" value={r.comissao_setup_pct} onChange={(e) => muda({ comissao_setup_pct: e.target.value })} />
                  <p className="text-xs text-muted-foreground">{t("Venda única: paga uma vez, quando o cliente paga o setup.")}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("Mudar a comissão vale para os clientes que entrarem daqui para a frente. Quem já entrou fica com a comissão do dia em que pagou a primeira vez.")}
              </p>
              {erro ? (
                <p className="text-sm text-destructive" role="alert">
                  {erro}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={ocupado} onClick={() => void salvar()} data-parceiros="salvar">
                  {t("Salvar")}
                </Button>
                {atual ? <span className="text-xs text-muted-foreground">{t("Cupons dele:")} {atual.cupons.length ? atual.cupons.join(", ") : t("nenhum")}</span> : null}
              </div>
            </>
          )}
          {atual ? (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3" data-parceiros="lgpd">
              <span className="text-xs text-muted-foreground">{t("LGPD do parceiro:")}</span>
              <Button asChild size="sm" variant="outline">
                <a href={`/api/v1/admin/parceiros/${atual.id}/dados`}>{t("Baixar os dados dele")}</a>
              </Button>
              {!atual.anonimizado_em ? (
                <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void anonimizar()}>
                  {t("Anonimizar")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      {atual ? (
        <Card className="space-y-2 overflow-x-auto p-4" data-parceiros="clientes">
          <h2 className="text-sm font-semibold">{t("Clientes de {nome}").replace("{nome}", atual.nome)}</h2>
          {atual.clientes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("Nenhum cliente ainda.")}</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">{t("Cliente")}</th>
                  <th className="pr-4 font-medium">{t("Plano")}</th>
                  <th className="pr-4 font-medium">{t("Cupom")}</th>
                  <th className="pr-4 font-medium">{t("Entrou em")}</th>
                  <th className="pr-4 font-medium">{t("Comissão")}</th>
                </tr>
              </thead>
              <tbody>
                {atual.clientes.map((c) => (
                  <tr key={c.organization_id} className="border-t">
                    <td className="py-2 pr-4">
                      <Link href={`/admin/tenants/${c.organization_id}`} className="underline">
                        {c.nome}
                      </Link>
                    </td>
                    <td className="pr-4">{c.plano ?? "-"}</td>
                    <td className="pr-4 font-mono">{c.codigo}</td>
                    <td className="pr-4">{dia(c.entrou_em)}</td>
                    <td className="pr-4">
                      {c.termos_fixados
                        ? `${texto(c.comissao_pct ?? 0)}% · ${c.comissao_meses === null ? t("enquanto pagar") : t("{n} meses").replace("{n}", String(c.comissao_meses))}`
                        : t("fixada no primeiro pagamento")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-muted-foreground">
            {t("O cliente fica ligado ao parceiro pelo cupom da primeira mensalidade. Trocar o parceiro de um cliente é feito na ficha da empresa, com a verificação em duas etapas, e fica no Audit Log.")}
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <span className="flex justify-between gap-2 text-xs text-muted-foreground">
      <span>{rotulo}</span>
      <b className="text-foreground tabular-nums">{valor}</b>
    </span>
  );
}
