"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { copyToClipboard } from "@/lib/clipboard";
import { FRASE_SEM_COMPRA, fraseSemCompra } from "@/lib/carteira/frases-da-compra";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";

/**
 * FORK MIA (.90) — comprar créditos por Pix (protótipo, tela 4, bloco Créditos).
 *
 * O cliente escolhe um pacote, o sistema gera o Pix no Asaas da instalação, e o
 * valor entra na carteira quando o Asaas confirma (o aviso dele, a rodada de
 * hora em hora ou o "Já paguei", que relê). Nada aqui marca como pago.
 */
interface Compra {
  id: string;
  valor_cents: number;
  status: "criando" | "aguardando" | "paga" | "cancelada" | "expirada";
  link: string | null;
  pix_copia_e_cola: string | null;
  modo: "teste" | "producao" | null;
  criada_em: string;
}
interface Leitura {
  pacotes: Array<{ valor_cents: number }>;
  pode_comprar: boolean;
  motivo: string | null;
  compras: Compra[];
}

export function ComprarCreditos({ precoPorMensagemCents }: { precoPorMensagemCents: number | null }) {
  const t = useT();
  const idioma = useIdioma();
  const brl = new Intl.NumberFormat(idioma, { style: "currency", currency: "BRL" });
  const numero = new Intl.NumberFormat(idioma);
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const [aberta, setAberta] = useState<Compra | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);

  const ler = useCallback(async () => {
    try {
      const r = await apiClient.get<{ data: Leitura }>("/api/v1/carteira/compras");
      setLeitura(r.data);
      setEscolhido((atual) => atual ?? r.data.pacotes[0]?.valor_cents ?? null);
      setAberta(r.data.compras.find((c) => c.status === "aguardando") ?? null);
    } catch {
      setErro(t("Não consegui carregar a compra de créditos agora."));
    }
  }, [t]);

  useEffect(() => {
    void ler();
  }, [ler]);

  async function gerar() {
    if (escolhido === null) return;
    setOcupado(true);
    setRecado(null);
    try {
      const r = await apiClient.post<{ data: { compra: Compra } }>("/api/v1/carteira/compras", { valor_cents: escolhido });
      setAberta(r.data.compra);
    } catch (e) {
      setRecado(e instanceof ApiError ? e.message : t("Não foi possível gerar o Pix. Tente de novo."));
    } finally {
      setOcupado(false);
    }
  }

  async function conferir(compra: Compra) {
    setOcupado(true);
    setRecado(null);
    try {
      const r = await apiClient.post<{ data: { status: Compra["status"] } }>(`/api/v1/carteira/compras/${compra.id}/conferir`, {});
      if (r.data.status === "paga") {
        setRecado(t("Pagamento confirmado. Os créditos já estão na carteira."));
        setAberta(null);
        await ler();
      } else if (r.data.status === "cancelada" || r.data.status === "expirada") {
        setRecado(t("Este Pix não vale mais. Gere outro."));
        setAberta(null);
      } else {
        setRecado(t("Ainda não identificamos o pagamento. Pix confirma em minutos; tente de novo daqui a pouco."));
      }
    } catch {
      setRecado(t("Não foi possível conferir o pagamento agora."));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card className="max-w-xl space-y-3 p-6" data-creditos-por-pix>
      <h2 className="text-sm font-semibold">{t("Créditos")}</h2>
      <p className="text-sm text-muted-foreground">
        {precoPorMensagemCents === null
          ? t("O preço por mensagem do Broadcast ainda não foi definido para a sua empresa.")
          : t("Mensagem do Broadcast a {preco} no seu plano. Mensagem que falha não é cobrada.").replace(
              "{preco}",
              brl.format(precoPorMensagemCents / 100),
            )}
      </p>
      {erro && <p className="text-sm text-error-fg">{erro}</p>}
      {leitura && !leitura.pode_comprar && (
        <p className="text-sm">{t(fraseSemCompra(leitura.motivo) ?? FRASE_SEM_COMPRA.sem_pacotes)}</p>
      )}
      {leitura && leitura.pode_comprar && !aberta && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("Pacote")}</legend>
          {leitura.pacotes.map((p) => (
            <label key={p.valor_cents} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="pacote-de-creditos"
                value={p.valor_cents}
                checked={escolhido === p.valor_cents}
                onChange={() => setEscolhido(p.valor_cents)}
              />
              <span className="font-medium">{brl.format(p.valor_cents / 100)}</span>
              {precoPorMensagemCents !== null && precoPorMensagemCents > 0 && (
                <span className="text-muted-foreground">
                  {t("cerca de {n} mensagens do Broadcast").replace(
                    "{n}",
                    numero.format(Math.floor(p.valor_cents / precoPorMensagemCents)),
                  )}
                </span>
              )}
            </label>
          ))}
          <p className="text-xs text-muted-foreground">
            {t("Pix pelo Asaas. Entra na carteira quando o Asaas confirma; a nota sai pelo Asaas.")}
          </p>
          <Button type="button" onClick={() => void gerar()} disabled={ocupado || escolhido === null}>
            {t("Gerar o Pix")}
          </Button>
        </fieldset>
      )}
      {aberta && (
        <div className="space-y-2 rounded-md border p-3" data-compra-aberta={aberta.id}>
          <p className="text-sm font-medium">
            {t("Pix de {valor} gerado.").replace("{valor}", brl.format(aberta.valor_cents / 100))}
          </p>
          {aberta.modo === "teste" && <p className="text-xs text-warning-fg">{t("Modo de teste: nenhum pagamento aqui é real.")}</p>}
          {aberta.pix_copia_e_cola && (
            <div className="space-y-1">
              <p className="break-all rounded-md bg-muted p-2 font-mono text-xs">{aberta.pix_copia_e_cola}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => setRecado((await copyToClipboard(aberta.pix_copia_e_cola ?? "")) ? t("Pix copiado.") : t("Não deu para copiar."))}
              >
                {t("Copiar o Pix")}
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {aberta.link && (
              <Button asChild size="sm">
                <a href={aberta.link} target="_blank" rel="noopener noreferrer">
                  {t("Abrir a fatura")}
                </a>
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => void conferir(aberta)} disabled={ocupado}>
              {t("Já paguei")}
            </Button>
          </div>
        </div>
      )}
      {recado && (
        <p className="text-sm" role="status">
          {recado}
        </p>
      )}
    </Card>
  );
}
