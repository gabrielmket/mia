"use client";

/**
 * FORK MIA (.89) — o TERCEIRO CAMINHO do novo disparo: E-MAIL, ao lado do
 * "Número oficial" e do "Número por QR" (protótipo, tela 2 "Público", bloco
 * "Por onde sai"). O custo e a regra que muda a decisão ficam NA ESCOLHA:
 * pelo domínio da empresa, cobrado por e-mail, só para quem tem base legal.
 *
 * "Usar o e-mail" cria um RASCUNHO (de um modelo ou de um segmento, se a pessoa
 * quiser) e abre a campanha. Criar não dispara.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { useCarteira } from "@/hooks/useCarteira";
import { useCriarCampanhaDeEmail, useSegmentos } from "@/hooks/useEmailMarketing";
import { formatCentsBRL } from "@/lib/money";
import { EnvelopeSimple } from "@/lib/ui/icons";
import { PRECO_PADRAO_POR_EMAIL_CENTS } from "@/lib/email-marketing/regras";

export function CartaoDoEmail({ liberado }: { liberado: boolean }) {
  const t = useT();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const carteira = useCarteira({ habilitado: liberado });
  const segmentos = useSegmentos(liberado && aberto);
  const criar = useCriarCampanhaDeEmail();
  const [nome, setNome] = useState("");
  const [segmento, setSegmento] = useState("");
  const preco = carteira.data?.preco_por_email_cents ?? PRECO_PADRAO_POR_EMAIL_CENTS;

  return (
    // .93: o marcador do "Me mostra como" (lib/assistente/trilhas/catalogo.ts).
    <Card className="flex flex-col gap-3 p-4" data-canal="email" data-testid="cartao-do-email">
      <div className="flex items-center gap-2">
        <EnvelopeSimple size={20} aria-hidden />
        <h2 className="font-medium">{t("E-mail")}</h2>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>{t("Pelo domínio da empresa, com descadastro de um clique.")}</li>
        <li>
          {t(
            "Só para quem tem base legal: consentimento registrado, ou cliente dos últimos 24 meses.",
          )}
        </li>
        <li>{t("Sai no ritmo e no aquecimento do domínio, com plano dia a dia.")}</li>
      </ul>
      <p className="text-sm font-medium" data-custo>
        {!liberado
          ? t("Não contratado para esta empresa. Fale com quem cuida da sua conta.")
          : `${t("Custo:")} ${formatCentsBRL(preco)} ${t("por e-mail aceito, do seu crédito")}${
              carteira.data ? ` (${t("saldo")} ${formatCentsBRL(carteira.data.saldo_cents)})` : ""
            }.`}
      </p>
      {aberto && liberado ? (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="email-nome">{t("Nome da campanha")}</Label>
            <Input
              id="email-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={t("Novidades de novembro")}
            />
          </div>
          {(segmentos.data ?? []).length > 0 ? (
            <div className="space-y-1">
              <Label htmlFor="email-segmento">{t("Começar de um segmento salvo (opcional)")}</Label>
              <select
                id="email-segmento"
                className="h-9 min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm lg:min-h-0"
                value={segmento}
                onChange={(e) => setSegmento(e.target.value)}
              >
                <option value="">{t("Nenhum")}</option>
                {(segmentos.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <Button
            className="w-full"
            disabled={!nome.trim() || criar.isPending}
            onClick={() =>
              criar.mutate(
                { nome: nome.trim(), ...(segmento ? { segmento_id: segmento } : {}) },
                { onSuccess: (r) => router.push(`/app/broadcast/email/${r.campanha.id}`) },
              )
            }
          >
            {criar.isPending ? t("Criando…") : t("Criar o rascunho")}
          </Button>
        </div>
      ) : (
        <Button
          className="mt-auto"
          variant="outline"
          disabled={!liberado}
          onClick={() => setAberto(true)}
        >
          {liberado ? t("Usar o e-mail") : t("Não contratado")}
        </Button>
      )}
    </Card>
  );
}
