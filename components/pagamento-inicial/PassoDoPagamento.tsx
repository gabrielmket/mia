"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { copyToClipboard } from "@/lib/clipboard";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import type { FormaDoPagamento, PassoDoPagamento as Passo, PlanoDoPasso } from "@/lib/pagamento-inicial/tipos";

import { CamposFiscais, valoresDe, type ValoresFiscais } from "./CamposFiscais";

/** A conferência da tela: a cada poucos segundos enquanto espera (o servidor trava as leituras do Asaas). */
const INTERVALO_DA_CONFERENCIA_MS = 5_000;

interface Resposta {
  data?: { passo?: Passo };
  error?: { code?: string; message?: string; details?: { passo?: Passo; campos?: Record<string, string>; campo?: string } };
}

/**
 * Uma chamada ao passo. `fetch` direto, e não o cliente de API: ele REPETE 503
 * sozinho, e um pagamento com cartão nunca se repete sem a pessoa decidir.
 */
async function chamar(caminho: string, corpo?: unknown): Promise<{ ok: boolean; status: number; corpo: Resposta }> {
  const r = await fetch(caminho, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: corpo === undefined ? "{}" : JSON.stringify(corpo),
  });
  return { ok: r.ok, status: r.status, corpo: ((await r.json().catch(() => ({}))) ?? {}) as Resposta };
}

/**
 * FORK MIA (.96) · O PASSO "PAGAMENTO" DO INÍCIO (protótipo "Pagamento no
 * início", telas 1 e 2; docs/fork/pagamento-no-inicio.md).
 *
 * Entrada paga: a cobrança na própria tela (Pix com QR e copia e cola, cartão
 * digitado, boleto com linha digitável e PDF), a conferência sozinha e o
 * "Pagamento confirmado". Plano com teste: "Nada é cobrado hoje", a escolha do
 * cartão (cadastrado agora) ou do Pix (3 dias antes do fim do teste). O cartão
 * vai do campo direto ao servidor, que o repassa ao Asaas: esta tela não o
 * guarda em lugar nenhum e limpa os campos depois de enviar.
 */
export function PassoDoPagamento({ inicial, marca }: { inicial: Passo; marca: string }) {
  const t = useT();
  const idioma = useIdioma();
  const router = useRouter();
  const [passo, setPasso] = useState<Passo>(inicial);
  const [forma, setForma] = useState<FormaDoPagamento>(
    inicial.forma && inicial.formas.includes(inicial.forma) ? inicial.forma : (inicial.formas[0] ?? "pix"),
  );
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [corrigindo, setCorrigindo] = useState(inicial.pode_pagar && inicial.fiscais === null);
  const [fiscais, setFiscais] = useState<ValoresFiscais>(valoresDe(inicial.fiscais?.campos));
  const [errosFiscais, setErrosFiscais] = useState<Record<string, string>>({});
  const [trocandoPlano, setTrocandoPlano] = useState(false);
  const [planoNovo, setPlanoNovo] = useState<string | null>(null);
  const formCartao = useRef<HTMLFormElement>(null);

  const brl = new Intl.NumberFormat(idioma, { style: "currency", currency: "BRL" });
  const dia = (iso: string | null) => {
    if (!iso) return "";
    const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00-03:00`) : new Date(iso);
    return new Intl.DateTimeFormat(idioma, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" }).format(d);
  };
  const diaEHora = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(idioma, { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso)) : "";
  const valor = passo.valor_cents ?? passo.plano?.preco_cents ?? null;
  const teste = passo.modo === "teste";
  const nomeDaForma = (f: string | null) =>
    f === "pix" ? t("Pix") : f === "cartao" ? t("Cartão de crédito") : f === "boleto" ? t("Boleto") : t("Outra forma");

  const aplicar = useCallback((r: { ok: boolean; corpo: Resposta }) => {
    const novo = r.corpo.data?.passo ?? r.corpo.error?.details?.passo;
    if (novo) setPasso(novo);
    if (!r.ok) setErro(r.corpo.error?.message ?? null);
    return novo;
  }, []);

  // A conferência: ao abrir e a cada poucos segundos, enquanto a entrada paga espera.
  const esperando = passo.espera && passo.pode_pagar && (passo.situacao === "aguardando" || passo.situacao === "em_analise");
  useEffect(() => {
    if (!passo.espera || passo.pago) return;
    let vivo = true;
    const conferir = async () => {
      try {
        const r = await chamar("/api/v1/cobranca/pagamento-inicial/conferir");
        if (vivo && r.ok && r.corpo.data?.passo) setPasso(r.corpo.data.passo);
      } catch {
        // A próxima volta tenta de novo.
      }
    };
    void conferir();
    if (!esperando) return () => {
      vivo = false;
    };
    const id = window.setInterval(() => void conferir(), INTERVALO_DA_CONFERENCIA_MS);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, [passo.espera, passo.pago, esperando]);

  async function executar(acao: () => Promise<{ ok: boolean; status: number; corpo: Resposta }>) {
    setErro(null);
    setAviso(null);
    setOcupado(true);
    try {
      return aplicar(await acao());
    } catch {
      setErro(t("Não deu para falar com o servidor. Confira a conexão e tente de novo."));
      return undefined;
    } finally {
      setOcupado(false);
    }
  }

  async function salvarFiscais() {
    setErrosFiscais({});
    let campos: Record<string, string> | undefined;
    const r = await executar(async () => {
      const resposta = await chamar("/api/v1/cobranca/pagamento-inicial/dados-fiscais", fiscais);
      campos = resposta.corpo.error?.details?.campos;
      return resposta;
    });
    if (campos) setErrosFiscais(campos);
    if (r && !campos) setCorrigindo(false);
  }

  async function enviarCartao(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const dados = new FormData(form);
    const cartao = {
      numero: String(dados.get("numero") ?? ""),
      nome: String(dados.get("nome") ?? ""),
      validade: String(dados.get("validade") ?? ""),
      cvv: String(dados.get("cvv") ?? ""),
    };
    await executar(() => chamar("/api/v1/cobranca/pagamento-inicial/cartao", cartao));
    // O código de segurança nunca fica na tela depois do envio; o número, só se recusado.
    const cvv = form.elements.namedItem("cvv");
    if (cvv instanceof HTMLInputElement) cvv.value = "";
  }

  async function copiar(texto: string, pronto: string) {
    setAviso((await copyToClipboard(texto)) ? pronto : t("Selecione o texto e copie."));
  }

  async function trocarPlano() {
    if (!planoNovo) return;
    const r = await executar(() => chamar("/api/v1/cobranca/pagamento-inicial/plano", { plano_id: planoNovo }));
    if (r) {
      setTrocandoPlano(false);
      setPlanoNovo(null);
      if (r.modo === null) router.replace("/onboarding");
      else router.refresh();
    }
  }

  const continuar = () => router.push("/onboarding");

  // ── quem não administra ──
  if (!passo.pode_pagar) {
    return (
      <Card className="space-y-3 p-6" data-pagamento="sem-permissao">
        <h2 className="text-xl font-semibold">{teste ? t("Como a empresa vai pagar depois do teste") : t("A empresa espera o primeiro pagamento")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Quem administra a empresa escolhe a forma de pagamento nesta tela. Avise a pessoa que administra.")}
        </p>
      </Card>
    );
  }

  // ── pagamento confirmado ──
  if (passo.modo === "entrada_paga" && passo.pago) {
    return (
      <Card className="space-y-4 p-6 text-center" data-pagamento="confirmado">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border-2 border-success-fg bg-success-bg text-success-fg" aria-hidden>
          ✓
        </div>
        <h2 className="text-xl font-semibold">{t("Pagamento confirmado")}</h2>
        <p className="text-sm text-muted-foreground">{t("A sua conta está liberada. Agora vamos montar tudo em poucos passos.")}</p>
        <dl className="mx-auto grid max-w-sm grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border bg-muted/40 p-3 text-left text-sm">
          <dt className="text-muted-foreground">{t("Plano")}</dt>
          <dd className="font-medium">{passo.plano?.nome ?? "-"}</dd>
          <dt className="text-muted-foreground">{t("Valor")}</dt>
          <dd className="font-medium">{valor !== null ? `${brl.format(valor / 100)} ${t("por mês")}` : "-"}</dd>
          <dt className="text-muted-foreground">{t("Forma")}</dt>
          <dd className="font-medium">{nomeDaForma(passo.forma_paga)}</dd>
          <dt className="text-muted-foreground">{t("Confirmado em")}</dt>
          <dd className="font-medium">{diaEHora(passo.pago_em) || "-"}</dd>
          {passo.proxima_cobranca ? (
            <>
              <dt className="text-muted-foreground">{t("Próxima cobrança")}</dt>
              <dd className="font-medium">{dia(passo.proxima_cobranca)}</dd>
            </>
          ) : null}
        </dl>
        <p className="text-xs text-muted-foreground">
          {t("A nota fiscal sai pelo Asaas com a confirmação do pagamento, em nome dos dados fiscais da empresa, e chega no seu e-mail junto com o recibo.")}
        </p>
        <Button onClick={continuar}>{t("Continuar")}</Button>
      </Card>
    );
  }

  // ── modo teste: forma escolhida ──
  if (teste && passo.cumprido && !trocandoPlano && !corrigindo && passo.situacao === "escolhida") {
    return (
      <Card className="space-y-4 p-6" data-pagamento="escolhida">
        <h2 className="text-xl font-semibold">{t("Pronto: nada é cobrado hoje")}</h2>
        <p className="text-sm text-muted-foreground">
          {passo.forma === "cartao"
            ? t("A primeira mensalidade, de {valor}, será debitada no cartão final {final} em {data}, no fim do teste.")
                .replace("{valor}", valor !== null ? brl.format(valor / 100) : "-")
                .replace("{final}", passo.cartao?.final ?? "····")
                .replace("{data}", dia(passo.primeira_cobranca_em))
            : t("O Pix da primeira mensalidade chega por e-mail 3 dias antes do fim do teste, que é em {data}.").replace(
                "{data}",
                dia(passo.primeira_cobranca_em),
              )}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("Sem o pagamento no fim do teste, a conta fica bloqueada até ele ser confirmado.")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={continuar}>{t("Continuar: Seu negócio")}</Button>
          <Button variant="outline" onClick={() => setPasso({ ...passo, cumprido: false, situacao: "sem_cobranca" })}>
            {t("Trocar a forma")}
          </Button>
        </div>
      </Card>
    );
  }

  const titulo = teste
    ? t("Como você vai pagar depois do teste")
    : passo.fim_do_teste
      ? t("Falta só o pagamento para continuar usando o {marca}").replace("{marca}", marca)
      : t("Falta só o pagamento para começar a usar o {marca}").replace("{marca}", marca);
  const ajudaDaForma: Record<FormaDoPagamento, string> = teste
    ? { cartao: "Cadastre agora; o débito sai sozinho no fim do teste", pix: "O Pix chega 3 dias antes do fim do teste", boleto: "" }
    : { pix: "Libera na hora", cartao: "Libera na hora · renova sozinho", boleto: "Libera em 1 a 3 dias úteis" };

  return (
    <div className="space-y-4" data-pagamento={teste ? "teste" : "entrada-paga"}>
      <Card className="space-y-4 p-6">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{titulo}</h2>
          {teste ? (
            <p className="text-sm text-muted-foreground" data-pagamento="nada-hoje">
              {t("Nada é cobrado hoje. O teste grátis vai até {data}.").replace("{data}", dia(passo.teste_ate))}
            </p>
          ) : passo.fim_do_teste ? (
            <p className="text-sm text-muted-foreground">
              {t("O teste grátis terminou e a primeira mensalidade ainda não foi paga. Pague por Pix ou cadastre outro cartão: a conta é liberada na hora.")}
            </p>
          ) : null}
        </div>

        {/* O plano, e o "Trocar de plano" antes de pagar (decisão 7). */}
        <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-md border bg-muted/40 p-3">
          <div>
            <p className="text-sm font-semibold">{t("Plano {nome}").replace("{nome}", passo.plano?.nome ?? "")}</p>
            <p className="text-xs text-muted-foreground">{detalhesDoPlano(passo.plano, t)}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">
              {valor !== null ? brl.format(valor / 100) : "-"}
              <span className="text-xs font-normal text-muted-foreground"> {passo.plano?.intervalo === "ano" ? t("/ano") : t("/mês")}</span>
            </p>
            {!passo.fim_do_teste && passo.planosParaTrocar.length > 1 ? (
              <Button variant="outline" size="sm" className="mt-1" onClick={() => setTrocandoPlano((v) => !v)} data-pagamento="trocar-plano">
                {t("Trocar de plano")}
              </Button>
            ) : null}
          </div>
        </div>

        {trocandoPlano ? (
          <div className="space-y-2 rounded-md border p-3" data-pagamento="planos">
            <p className="text-sm font-medium">{t("Escolha o plano")}</p>
            {passo.planosParaTrocar.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-start gap-3 rounded-md border p-2 has-[:checked]:border-primary">
                <input
                  type="radio"
                  name="plano-novo"
                  value={p.id}
                  checked={(planoNovo ?? passo.plano?.id) === p.id}
                  onChange={() => setPlanoNovo(p.id)}
                  className="mt-1"
                />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium">{p.nome}</span>
                  <span className="block text-xs text-muted-foreground">
                    {detalhesDoPlano(p, t)}
                    {p.trial_dias > 0 ? ` · ${t("{n} dias de teste grátis").replace("{n}", String(p.trial_dias))}` : ` · ${t("paga na entrada")}`}
                  </span>
                </span>
                <span className="text-sm font-semibold">{brl.format(p.preco_cents / 100)}</span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              {t("Se já houver uma cobrança gerada, ela é cancelada e a próxima sai no plano novo.")}
            </p>
            <div className="flex gap-2">
              <Button size="sm" disabled={ocupado || !planoNovo || planoNovo === passo.plano?.id} onClick={() => void trocarPlano()}>
                {t("Trocar para este plano")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setTrocandoPlano(false)}>
                {t("Cancelar")}
              </Button>
            </div>
          </div>
        ) : null}

        {/* Em nome de quem sai a cobrança e a nota; "Corrigir" abre os campos. */}
        {corrigindo ? (
          <div className="space-y-3 rounded-md border p-3">
            <CamposFiscais valores={fiscais} aoMudar={setFiscais} erros={errosFiscais} comTelefone prefixo="passo-fiscal" />
            <p className="text-xs text-muted-foreground">{t("Os dados fiscais ficam guardados na sua conta, visíveis só para quem administra a empresa.")}</p>
            <div className="flex gap-2">
              <Button size="sm" disabled={ocupado} onClick={() => void salvarFiscais()} data-pagamento="salvar-fiscais">
                {t("Salvar os dados")}
              </Button>
              {passo.fiscais ? (
                <Button size="sm" variant="outline" onClick={() => setCorrigindo(false)}>
                  {t("Cancelar")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : passo.fiscais ? (
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3">
            <div className="min-w-0 text-sm">
              <p className="text-xs text-muted-foreground">{t("Cobrança e nota em nome de")}</p>
              <p className="font-semibold">{passo.fiscais.razao_social}</p>
              <p className="text-xs text-muted-foreground">
                {passo.fiscais.documento} · {passo.fiscais.endereco}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setCorrigindo(true)}>
              {t("Corrigir")}
            </Button>
          </div>
        ) : null}

        {/* As formas. */}
        {!corrigindo && passo.fiscais ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">{teste ? t("Como você quer pagar depois do teste") : t("Como você quer pagar")}</p>
            <div className={`grid gap-2 ${passo.formas.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`} role="radiogroup" aria-label={t("Forma de pagamento")}>
              {passo.formas.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={forma === f}
                  onClick={() => {
                    setErro(null);
                    setForma(f);
                  }}
                  className={`rounded-md border p-3 text-left text-sm ${forma === f ? "border-primary bg-muted/60" : "bg-background"}`}
                  data-forma={f}
                >
                  <span className="block font-medium">{nomeDaForma(f)}</span>
                  <span className="block text-xs text-muted-foreground">{t(ajudaDaForma[f])}</span>
                </button>
              ))}
            </div>

            {forma === "pix" && teste ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t("Nada é cobrado hoje. 3 dias antes do fim do teste, mandamos por e-mail o Pix da primeira mensalidade. Sem o pagamento, a conta fica bloqueada no fim do teste até o Pix ser confirmado.")}
                </p>
                <Button disabled={ocupado} onClick={() => void executar(() => chamar("/api/v1/cobranca/pagamento-inicial/gerar", { forma: "pix" }))}>
                  {t("Escolher o Pix")}
                </Button>
              </div>
            ) : null}

            {forma === "pix" && !teste ? (
              passo.pix ? (
                <div className="grid gap-4 sm:grid-cols-[auto_1fr]" data-pagamento="pix">
                  {passo.pix.qr ? (
                    // eslint-disable-next-line @next/next/no-img-element -- QR desenhado no servidor, em data URL.
                    <img src={passo.pix.qr} alt={t("QR Code do Pix")} className="h-48 w-48 rounded-md border bg-white p-2" />
                  ) : null}
                  <div className="min-w-0 space-y-2">
                    <p className="text-sm">{t("Escaneie com o app do seu banco ou use o Pix copia e cola.")}</p>
                    <div className="flex gap-2">
                      <Input readOnly value={passo.pix.copia_e_cola} className="font-mono text-xs" aria-label={t("Pix copia e cola")} />
                      <Button type="button" variant="outline" onClick={() => void copiar(passo.pix?.copia_e_cola ?? "", t("Pix copia e cola copiado."))}>
                        {t("Copiar")}
                      </Button>
                    </div>
                    <Espera texto={t("Esperando o Pix. Conferimos sozinhos a cada poucos segundos; não precisa clicar em nada.")} />
                    <p className="text-xs text-muted-foreground">{t("A nota fiscal chega por e-mail depois que o pagamento confirmar.")}</p>
                  </div>
                </div>
              ) : (
                <Button disabled={ocupado} onClick={() => void executar(() => chamar("/api/v1/cobranca/pagamento-inicial/gerar", { forma: "pix" }))}>
                  {valor !== null ? t("Gerar o Pix de {valor}").replace("{valor}", brl.format(valor / 100)) : t("Gerar o Pix")}
                </Button>
              )
            ) : null}

            {forma === "cartao" ? (
              passo.situacao === "em_analise" && !teste ? (
                <Espera texto={t("O Asaas está analisando o pagamento com o banco. Esta tela segue sozinha quando confirmar.")} />
              ) : (
                <form ref={formCartao} className="space-y-3" onSubmit={(ev) => void enviarCartao(ev)} autoComplete="on" data-pagamento="cartao">
                  {passo.situacao === "recusado" ? (
                    <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                      {teste
                        ? t("O banco recusou o cartão. Confira os dados, tente outro cartão ou escolha o Pix.")
                        : t("O banco recusou o cartão. Confira os dados, tente outro cartão ou pague por Pix, que libera na hora.")}
                    </p>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="cartao-numero">{t("Número do cartão")}</Label>
                    <Input id="cartao-numero" name="numero" inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cartao-nome">{t("Nome impresso no cartão")}</Label>
                    <Input id="cartao-nome" name="nome" autoComplete="cc-name" required />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="cartao-validade">{t("Validade")}</Label>
                      <Input id="cartao-validade" name="validade" inputMode="numeric" autoComplete="cc-exp" placeholder={t("MM/AA")} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cartao-cvv">{t("Código de segurança")}</Label>
                      <Input id="cartao-cvv" name="cvv" inputMode="numeric" autoComplete="cc-csc" maxLength={4} placeholder={t("3 ou 4 números")} required />
                    </div>
                  </div>
                  <Button type="submit" disabled={ocupado}>
                    {ocupado
                      ? t("Enviando ao Asaas...")
                      : teste
                        ? t("Cadastrar o cartão")
                        : valor !== null
                          ? t("Pagar {valor}").replace("{valor}", brl.format(valor / 100))
                          : t("Pagar")}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {teste
                      ? t("Nada é cobrado hoje. A primeira mensalidade, de {valor}, é debitada neste cartão em {data}, no fim do teste. Os dados do cartão vão direto para o Asaas e não ficam guardados.")
                          .replace("{valor}", valor !== null ? brl.format(valor / 100) : "-")
                          .replace("{data}", dia(passo.primeira_cobranca_em))
                      : t("Os dados do cartão vão direto para o Asaas na hora do pagamento e não ficam guardados. As próximas mensalidades caem no mesmo cartão, e você troca de cartão quando quiser em Configurações › Plano e cobrança.")}
                  </p>
                  {passo.situacao === "recusado" && passo.formas.includes("pix") && !teste ? (
                    <Button type="button" variant="outline" onClick={() => setForma("pix")}>
                      {t("Pagar por Pix")}
                    </Button>
                  ) : null}
                </form>
              )
            ) : null}

            {forma === "boleto" && !teste ? (
              passo.boleto ? (
                <div className="space-y-2" data-pagamento="boleto">
                  <p className="break-all rounded-md border bg-muted/40 p-3 font-mono text-sm">{passo.boleto.linha}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => void copiar(passo.boleto?.linha ?? "", t("Linha digitável copiada."))}>
                      {t("Copiar a linha digitável")}
                    </Button>
                    {passo.boleto.url ? (
                      <Button asChild variant="outline" size="sm">
                        <a href={passo.boleto.url} target="_blank" rel="noopener noreferrer">
                          {t("Abrir o boleto")}
                        </a>
                      </Button>
                    ) : null}
                  </div>
                  <p className="rounded-md border border-warning-fg/30 bg-warning-bg px-3 py-2 text-sm text-warning-fg">
                    {t("O boleto vence em {data} e compensa em 1 a 3 dias úteis. Pode fechar esta tela: quando compensar, mandamos um e-mail e a sua conta libera. Quer começar agora? Pague por Pix.").replace(
                      "{data}",
                      dia(passo.vence_em),
                    )}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={ocupado}
                    onClick={() => {
                      setForma("pix");
                      void executar(() => chamar("/api/v1/cobranca/pagamento-inicial/gerar", { forma: "pix" }));
                    }}
                  >
                    {t("Pagar por Pix em vez do boleto")}
                  </Button>
                </div>
              ) : (
                <Button disabled={ocupado} onClick={() => void executar(() => chamar("/api/v1/cobranca/pagamento-inicial/gerar", { forma: "boleto" }))}>
                  {t("Gerar o boleto")}
                </Button>
              )
            ) : null}
          </div>
        ) : null}

        {erro ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {erro}
          </p>
        ) : null}
        {aviso ? (
          <p className="text-xs text-muted-foreground" role="status">
            {aviso}
          </p>
        ) : null}
      </Card>
      <p className="text-center text-xs text-muted-foreground">{t("Pagamento processado pelo Asaas.")}</p>
    </div>
  );
}

function Espera({ texto }: { texto: string }) {
  return (
    <p className="flex items-center gap-2 rounded-md border border-info-fg/30 bg-info-bg px-3 py-2 text-sm text-info-fg" role="status">
      <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" aria-hidden />
      {texto}
    </p>
  );
}

function detalhesDoPlano(p: PlanoDoPasso | null, t: (s: string) => string): string {
  if (!p) return "";
  return [
    p.numeros === null ? t("números sem limite") : p.numeros === 1 ? t("1 número") : t("{n} números").replace("{n}", String(p.numeros)),
    p.pessoas === null ? t("pessoas sem limite") : t("até {n} pessoas").replace("{n}", String(p.pessoas)),
  ].join(" · ");
}
