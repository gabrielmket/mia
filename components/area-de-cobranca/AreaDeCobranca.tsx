"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { MOTIVOS_DA_NOTA_ERRADA, nomeDaBandeira, ROTULO_DO_MOTIVO, type MotivoDaNotaErrada } from "@/lib/area-de-cobranca/regras";
import type { AreaDeCobranca as Area, CobrancaDaArea } from "@/lib/area-de-cobranca/tipos";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";

import { CamposFiscais, valoresDe, type ValoresFiscais } from "@/components/pagamento-inicial/CamposFiscais";

interface Resposta {
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string; details?: { campos?: Record<string, string>; campo?: string; chamado?: number } };
}

/**
 * Uma chamada da área. `fetch` direto, e não o cliente de API: ele REPETE 503
 * sozinho, e a troca do cartão nunca se repete sem a pessoa decidir.
 */
async function chamar(caminho: string, corpo: unknown): Promise<{ ok: boolean; corpo: Resposta }> {
  const r = await fetch(caminho, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { ok: r.ok, corpo: ((await r.json().catch(() => ({}))) ?? {}) as Resposta };
}

const CLASSE_DO_CHIP = {
  ok: "border-success-fg bg-success-bg text-success-fg",
  info: "border-info-fg bg-info-bg text-info-fg",
  warn: "border-warning-fg bg-warning-bg text-warning-fg",
  neutro: "border-border bg-muted text-muted-foreground",
} as const;

function Chip({ tom, children }: { tom: keyof typeof CLASSE_DO_CHIP; children: React.ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${CLASSE_DO_CHIP[tom]}`}>{children}</span>;
}

function LinkDoAsaas({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted"
    >
      {children}
    </a>
  );
}

/**
 * FORK MIA (.96) · A ÁREA DE COBRANÇA em Configurações › Plano e cobrança
 * (protótipo "Pagamento no início", tela 3; docs/fork/area-de-cobranca.md).
 * Só o administrador da empresa vê (decisão 11). O histórico das cobranças com
 * a nota fiscal (PDF e XML) e o recibo de cada uma, "Pagar agora" e a segunda
 * via, a troca do cartão das próximas mensalidades (o cartão vai do campo ao
 * servidor, que o repassa ao Asaas, e esta tela limpa os campos ao enviar), os
 * dados fiscais e "A nota saiu errada", que vira um chamado para a Time.
 */
export function AreaDeCobranca({ area }: { area: Area }) {
  const t = useT();
  const idioma = useIdioma();
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // "A nota saiu errada"
  const [notaAberta, setNotaAberta] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<MotivoDaNotaErrada>("razao_social");
  const [textoDaNota, setTextoDaNota] = useState("");
  // o cartão
  const [trocandoCartao, setTrocandoCartao] = useState(false);
  // os dados fiscais
  const [editandoFiscais, setEditandoFiscais] = useState(false);
  const [fiscais, setFiscais] = useState<ValoresFiscais>(valoresDe(area.fiscais?.campos));
  const [errosFiscais, setErrosFiscais] = useState<Record<string, string>>({});

  const brl = new Intl.NumberFormat(idioma, { style: "currency", currency: "BRL" });
  const dia = (civil: string | null) =>
    civil
      ? new Intl.DateTimeFormat(idioma, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${civil.slice(0, 10)}T12:00:00Z`))
      : "";
  const mes = (civil: string) => {
    const texto = new Intl.DateTimeFormat(idioma, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${civil.slice(0, 10)}T12:00:00Z`));
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  };
  const formaDaCobranca = (c: CobrancaDaArea) =>
    c.forma === "pix"
      ? t("Pix")
      : c.forma === "boleto"
        ? t("Boleto")
        : c.forma === "cartao"
          ? c.cartao_final
            ? t("Cartão final {final}").replace("{final}", c.cartao_final)
            : t("Cartão de crédito")
          : c.forma === "a_escolher"
            ? t("Pix, boleto ou cartão")
            : t("Outra forma");

  async function executar(acao: () => Promise<{ ok: boolean; corpo: Resposta }>, pronto: string): Promise<Resposta | null> {
    setErro(null);
    setAviso(null);
    setOcupado(true);
    try {
      const r = await acao();
      if (!r.ok) {
        setErro(r.corpo.error?.message ?? t("Não deu para salvar. Tente de novo em instantes."));
        return r.corpo;
      }
      setAviso(pronto);
      router.refresh();
      return r.corpo;
    } catch {
      setErro(t("Não deu para falar com o servidor. Confira a conexão e tente de novo."));
      return null;
    } finally {
      setOcupado(false);
    }
  }

  async function pedirCorrecao(ref: string) {
    const r = await executar(
      () => chamar("/api/v1/cobranca/area/nota-errada", { cobranca_ref: ref, motivo, texto: textoDaNota }),
      t("Pedido enviado. Virou um chamado para a Time, e a resposta chega no seu e-mail."),
    );
    if (r && !r.error) {
      setNotaAberta(null);
      setTextoDaNota("");
    }
  }

  async function trocarCartao(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const dados = new FormData(form);
    const cartao = {
      numero: String(dados.get("numero") ?? ""),
      nome: String(dados.get("nome") ?? ""),
      validade: String(dados.get("validade") ?? ""),
      cvv: String(dados.get("cvv") ?? ""),
    };
    const r = await executar(
      () => chamar("/api/v1/cobranca/area/cartao", cartao),
      t("Cartão trocado. As próximas mensalidades caem no cartão novo."),
    );
    // O código de segurança nunca fica na tela depois do envio; o número, só se recusado.
    const cvv = form.elements.namedItem("cvv");
    if (cvv instanceof HTMLInputElement) cvv.value = "";
    if (r && !r.error) {
      form.reset();
      setTrocandoCartao(false);
    }
  }

  async function salvarFiscais() {
    setErrosFiscais({});
    const r = await executar(
      () => chamar("/api/v1/cobranca/area/dados-fiscais", fiscais),
      t("Dados fiscais salvos. Valem a partir da próxima nota."),
    );
    const campos = r?.error?.details?.campos;
    if (campos) setErrosFiscais(campos);
    else if (r && !r.error) setEditandoFiscais(false);
  }

  const situacao = (c: CobrancaDaArea) => {
    switch (c.situacao) {
      case "paga":
        return <Chip tom="ok">{c.paga_em ? t("paga em {data}").replace("{data}", dia(c.paga_em)) : t("paga")}</Chip>;
      case "aberta":
        return <Chip tom="info">{t("em aberto · vence {data}").replace("{data}", dia(c.vencimento))}</Chip>;
      case "vencida":
        return <Chip tom="warn">{t("vencida em {data}").replace("{data}", dia(c.vencimento))}</Chip>;
      case "em_analise":
        return <Chip tom="info">{t("pagamento em análise")}</Chip>;
      case "estornada":
        return <Chip tom="neutro">{t("estornada")}</Chip>;
      case "cancelada":
        return <Chip tom="neutro">{t("cancelada · sem nota")}</Chip>;
      default:
        return <Chip tom="neutro">{t("em andamento")}</Chip>;
    }
  };

  const acoes = (c: CobrancaDaArea) => {
    if (c.situacao === "paga") {
      const correcaoAberta = c.correcao && c.correcao.situacao !== "resolvido";
      return (
        <div className="flex flex-wrap items-center gap-2">
          {c.nota?.pdf_url ? <LinkDoAsaas href={c.nota.pdf_url}>{t("Nota PDF")}</LinkDoAsaas> : null}
          {c.nota?.xml_url ? <LinkDoAsaas href={c.nota.xml_url}>{t("XML")}</LinkDoAsaas> : null}
          {c.recibo_url ? <LinkDoAsaas href={c.recibo_url}>{t("Recibo")}</LinkDoAsaas> : null}
          {!c.nota ? (
            <span className="text-xs text-muted-foreground">{t("A nota ainda não saiu.")}</span>
          ) : c.nota.situacao === "agendada" || c.nota.situacao === "em_andamento" ? (
            <span className="text-xs text-muted-foreground">{t("A nota está saindo.")}</span>
          ) : null}
          {c.correcao ? (
            <Chip tom={correcaoAberta ? "warn" : "ok"}>
              {(correcaoAberta ? t("correção pedida · chamado nº {n}") : t("correção respondida · chamado nº {n}")).replace("{n}", String(c.correcao.chamado))}
            </Chip>
          ) : null}
          {!correcaoAberta && c.nota ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={ocupado}
              onClick={() => {
                setNotaAberta(notaAberta === c.ref ? null : c.ref);
                setMotivo("razao_social");
                setTextoDaNota("");
              }}
            >
              {t("A nota saiu errada")}
            </Button>
          ) : null}
        </div>
      );
    }
    if (c.situacao === "aberta" || c.situacao === "vencida") {
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* "Pagar esta cobrança", e não "Pagar agora": o nome do upstream já é o do link da assinatura na mesma página, e dois iguais quebram o e2e do link pelo dono. */}
            {c.pagar_url ? <LinkDoAsaas href={c.pagar_url}>{t("Pagar esta cobrança")}</LinkDoAsaas> : null}
            {c.segunda_via_url ? <LinkDoAsaas href={c.segunda_via_url}>{t("Segunda via")}</LinkDoAsaas> : null}
          </div>
          {c.forma === "cartao" && c.situacao === "aberta" ? (
            <p className="text-xs text-muted-foreground">
              {(c.cartao_final ? t("Cai sozinho no cartão final {final} em {data}.").replace("{final}", c.cartao_final) : t("Cai sozinho no cartão em {data}.")).replace(
                "{data}",
                dia(c.vencimento),
              )}
            </p>
          ) : null}
        </div>
      );
    }
    if (c.situacao === "cancelada") {
      return <span className="text-xs text-muted-foreground">{t("Cobrança que não foi paga e foi cancelada. Não gera nota.")}</span>;
    }
    return null;
  };

  const forma = area.forma;
  const bandeira = nomeDaBandeira(forma?.cartao_bandeira ?? null);

  return (
    <div className="max-w-4xl space-y-6" data-area-de-cobranca="area">
      <Card className="space-y-3 p-6" data-area-de-cobranca="cobrancas">
        <h2 className="text-sm font-semibold">{t("Cobranças")}</h2>
        {area.leitura === "falhou" ? (
          <p className="rounded-md border bg-warning-bg p-3 text-sm text-warning-fg" role="status">
            {t("Não deu para ler as cobranças no Asaas agora. Recarregue a página em alguns minutos.")}
          </p>
        ) : area.cobrancas.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("As cobranças aparecem aqui depois da primeira cobrança.")}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t("Mês")}</th>
                  <th className="px-3 py-2 font-medium">{t("Valor")}</th>
                  <th className="px-3 py-2 font-medium">{t("Situação")}</th>
                  <th className="px-3 py-2 font-medium">{t("Nota fiscal e recibo")}</th>
                </tr>
              </thead>
              <tbody>
                {area.cobrancas.map((c) => (
                  <Fragment key={c.ref}>
                    <tr className="border-b align-top" data-cobranca={c.situacao}>
                      <td className="px-3 py-2">
                        <span className="block font-medium">{c.mensalidade ? mes(c.vencimento) : (c.descricao ?? mes(c.vencimento))}</span>
                        <span className="block text-xs text-muted-foreground">
                          {formaDaCobranca(c)}
                          {c.nota?.numero ? ` · ${t("nota nº {n}").replace("{n}", c.nota.numero)}` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{brl.format(c.valor_cents / 100)}</td>
                      <td className="px-3 py-2">{situacao(c)}</td>
                      <td className="px-3 py-2">{acoes(c)}</td>
                    </tr>
                    {notaAberta === c.ref ? (
                      <tr className="border-b bg-muted/40">
                        <td colSpan={4} className="px-3 py-3">
                          <div className="max-w-2xl space-y-3" data-area-de-cobranca="nota-errada">
                            <p className="text-sm font-medium">
                              {c.nota?.numero
                                ? t("O que saiu errado na nota nº {n}?").replace("{n}", c.nota.numero)
                                : t("O que saiu errado na nota?")}
                            </p>
                            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("O que está errado")}>
                              {MOTIVOS_DA_NOTA_ERRADA.map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  role="radio"
                                  aria-checked={motivo === m}
                                  onClick={() => setMotivo(m)}
                                  className={`rounded-md border px-3 py-1.5 text-sm ${motivo === m ? "border-primary bg-background font-medium" : "bg-background"}`}
                                >
                                  {t(ROTULO_DO_MOTIVO[m])}
                                </button>
                              ))}
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor={`nota-errada-${c.ref}`}>{t("Conte o que precisa mudar")}</Label>
                              <Textarea
                                id={`nota-errada-${c.ref}`}
                                rows={3}
                                maxLength={2000}
                                value={textoDaNota}
                                onChange={(ev) => setTextoDaNota(ev.target.value)}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {t(
                                "A Time cancela a nota no Asaas e emite outra com os dados certos, dentro do prazo da prefeitura. Se o erro está nos seus dados fiscais, corrija também em Dados fiscais, para as próximas notas.",
                              )}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" size="sm" disabled={ocupado || textoDaNota.trim().length < 3} onClick={() => void pedirCorrecao(c.ref)}>
                                {t("Pedir a correção")}
                              </Button>
                              <Button type="button" variant="outline" size="sm" disabled={ocupado} onClick={() => setNotaAberta(null)}>
                                {t("Cancelar")}
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {t("A nota de cada mês sai pelo Asaas quando o pagamento confirma, e fica aqui para baixar a qualquer momento.")}
        </p>
      </Card>

      {erro ? (
        <p className="rounded-md border bg-error-bg p-3 text-sm text-error-fg" role="alert">
          {erro}
        </p>
      ) : null}
      {aviso ? (
        <p className="rounded-md border bg-success-bg p-3 text-sm text-success-fg" role="status">
          {aviso}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3 p-6" data-area-de-cobranca="forma">
          <h2 className="text-sm font-semibold">{t("Forma de pagamento")}</h2>
          {!forma ? (
            <p className="text-sm text-muted-foreground">{t("A forma de pagamento aparece aqui depois da primeira cobrança.")}</p>
          ) : trocandoCartao ? (
            <form className="space-y-3" onSubmit={(ev) => void trocarCartao(ev)} autoComplete="on" data-area-de-cobranca="cartao">
              <div className="space-y-1.5">
                <Label htmlFor="area-cartao-numero">{t("Número do novo cartão")}</Label>
                <Input id="area-cartao-numero" name="numero" inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="area-cartao-nome">{t("Nome impresso no cartão")}</Label>
                <Input id="area-cartao-nome" name="nome" autoComplete="cc-name" required />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="area-cartao-validade">{t("Validade")}</Label>
                  <Input id="area-cartao-validade" name="validade" inputMode="numeric" autoComplete="cc-exp" placeholder={t("MM/AA")} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="area-cartao-cvv">{t("Código de segurança")}</Label>
                  <Input id="area-cartao-cvv" name="cvv" inputMode="numeric" autoComplete="cc-csc" maxLength={4} placeholder={t("3 ou 4 números")} required />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={ocupado}>
                  {ocupado ? t("Enviando...") : t("Usar este cartão")}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={ocupado} onClick={() => setTrocandoCartao(false)}>
                  {t("Cancelar")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("O cartão vai direto para o Asaas e não fica guardado aqui. Nada é cobrado agora: ele vale para as próximas mensalidades.")}
              </p>
            </form>
          ) : (
            <>
              {forma.no_cartao ? (
                <p className="text-sm">
                  {forma.cartao_final
                    ? (bandeira ? t("Cartão {bandeira} terminado em {final}.") : t("Cartão de crédito terminado em {final}."))
                        .replace("{bandeira}", bandeira ?? "")
                        .replace("{final}", forma.cartao_final)
                    : t("Cartão de crédito.")}{" "}
                  {t("As mensalidades caem nele.")}
                </p>
              ) : (
                <p className="text-sm">{t("As mensalidades chegam pela fatura do Asaas, para pagar por Pix ou boleto.")}</p>
              )}
              {forma.proxima_em ? (
                <p className="text-xs text-muted-foreground">{t("Próxima mensalidade em {data}.").replace("{data}", dia(forma.proxima_em))}</p>
              ) : null}
              {forma.pode_trocar ? (
                <Button type="button" variant="outline" size="sm" disabled={ocupado} onClick={() => setTrocandoCartao(true)}>
                  {forma.no_cartao ? t("Trocar o cartão") : t("Cadastrar um cartão")}
                </Button>
              ) : null}
            </>
          )}
        </Card>

        <Card className="space-y-3 p-6" data-area-de-cobranca="dados-fiscais">
          <h2 className="text-sm font-semibold">{t("Dados fiscais")}</h2>
          {editandoFiscais ? (
            <div className="space-y-3">
              <CamposFiscais
                valores={fiscais}
                aoMudar={setFiscais}
                erros={errosFiscais}
                comTelefone
                documentoTravado={area.fiscais !== null}
                prefixo="area-fiscal"
              />
              <p className="text-xs text-muted-foreground">
                {t("A mudança vale para as próximas notas. Uma nota já emitida se corrige por A nota saiu errada.")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={ocupado} onClick={() => void salvarFiscais()}>
                  {t("Salvar")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={ocupado}
                  onClick={() => {
                    setEditandoFiscais(false);
                    setFiscais(valoresDe(area.fiscais?.campos));
                    setErrosFiscais({});
                  }}
                >
                  {t("Cancelar")}
                </Button>
              </div>
            </div>
          ) : area.fiscais ? (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border bg-muted/40 p-3 text-sm">
                <dt className="text-muted-foreground">{area.fiscais.tipo === "pf" ? t("CPF") : t("CNPJ")}</dt>
                <dd className="font-medium tabular-nums">{area.fiscais.documento}</dd>
                <dt className="text-muted-foreground">{area.fiscais.tipo === "pf" ? t("Nome") : t("Razão social")}</dt>
                <dd className="font-medium">{area.fiscais.razao_social}</dd>
                <dt className="text-muted-foreground">{t("Endereço")}</dt>
                <dd>{area.fiscais.endereco}</dd>
                {area.fiscais.tipo === "pj" ? (
                  <>
                    <dt className="text-muted-foreground">{t("Inscrição municipal")}</dt>
                    <dd>{area.fiscais.inscricao_municipal ?? t("não informada")}</dd>
                  </>
                ) : null}
              </dl>
              {!area.fiscais.no_asaas ? (
                <p className="text-xs text-muted-foreground">{t("A versão mais nova ainda vai para o Asaas: chega antes da próxima nota.")}</p>
              ) : null}
              <Button type="button" variant="outline" size="sm" disabled={ocupado} onClick={() => setEditandoFiscais(true)}>
                {t("Editar")}
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{t("Os dados fiscais da empresa ainda não foram preenchidos. A nota sai com eles.")}</p>
              <Button type="button" variant="outline" size="sm" disabled={ocupado} onClick={() => setEditandoFiscais(true)}>
                {t("Preencher")}
              </Button>
            </>
          )}
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("Só quem administra a empresa vê as cobranças, baixa as notas, troca o cartão e edita os dados fiscais.")}
      </p>
    </div>
  );
}
