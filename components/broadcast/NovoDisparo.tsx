"use client";
/**
 * FORK MIA — NOVO DISPARO: a primeira pergunta é POR ONDE a mensagem sai.
 *
 * Decisão do dono do produto na .58 (docs/fork/broadcast-unificado.md): um
 * Broadcast só, com dois caminhos que custam coisas diferentes.
 *
 *   - Número oficial (Meta): modelo aprovado, cobrado por mensagem do crédito.
 *     O formulário é o nosso (`FormularioDoOficial`), aqui mesmo.
 *   - Número por QR: texto livre, sem custo por mensagem, no ritmo do número —
 *     e com o risco de o WhatsApp bloquear o número. O formulário é o das
 *     Campanhas do upstream (`/app/campaigns/new`), intacto, para que toda
 *     melhoria dele chegue aqui sem uma linha nossa.
 *
 * ── Por que o custo e o risco ficam NA ESCOLHA ─────────────────────────────
 *
 * São a única diferença que muda a decisão. Mostrá-los só dentro de cada
 * formulário faria a pessoa descobrir o preço (ou o risco) depois de ter
 * montado a lista pelo caminho errado.
 *
 * ── Por que o cartão do QR diz os números pelo nome ────────────────────────
 *
 * O formulário do upstream oferece TODOS os números da empresa, inclusive o
 * oficial, que não entrega texto livre fora da janela de 24h (a recusa chega
 * depois, pelo webhook). Enquanto esse filtro não volta do upstream, o cartão
 * diz quais são os números por QR para a pessoa escolher o certo lá.
 */
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { channelLabel, useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { useT } from "@/hooks/i18n/useT";
import { useCarteira } from "@/hooks/useCarteira";
import { ehNumeroPorQr, type CanaisLiberados } from "@/lib/broadcast/canais-do-disparo";
import type { CanalDoDisparo } from "@/lib/broadcast/lista-unificada";
import { formatCentsBRL } from "@/lib/money";
import { ArrowBendUpLeft, QrCode, ShieldCheck, Warning } from "@/lib/ui/icons";

import { FormularioDoOficial } from "./FormularioDoOficial";

export function NovoDisparo({
  canais,
  inicial,
}: {
  canais: CanaisLiberados;
  /** `?por=oficial` abre com o formulário oficial à vista (link direto). */
  inicial: CanalDoDisparo | null;
}) {
  const t = useT();
  const [escolhido, setEscolhido] = useState<CanalDoDisparo | null>(
    inicial === "oficial" && canais.oficial ? "oficial" : null,
  );
  const carteira = useCarteira({ habilitado: canais.oficial });
  const numeros = useChannelSessions();
  const porQr = (numeros.data ?? []).filter((n) => ehNumeroPorQr(n.provider));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <Link
          href="/app/broadcast"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-text"
        >
          <ArrowBendUpLeft size={14} aria-hidden />
          {t("Broadcast")}
        </Link>
      </div>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Novo disparo")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Primeiro, por onde a mensagem sai. Nada é enviado antes de você conferir a lista.")}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label={t("Por onde sai")}>
        <Card
          className={`flex flex-col gap-3 p-4 ${escolhido === "oficial" ? "border-accent ring-1 ring-accent" : ""}`}
          data-canal="oficial"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} aria-hidden />
            <h2 className="font-medium">{t("Número oficial (Meta)")}</h2>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{t("Só modelo aprovado pela Meta, com o nome de cada contato.")}</li>
            <li>{t("Sem risco de bloqueio por volume: quem limita é a Meta.")}</li>
          </ul>
          <p className="text-sm font-medium" data-custo>
            {!canais.oficial
              ? t("Não contratado para esta empresa. Fale com quem cuida da sua conta.")
              : carteira.data?.preco_por_mensagem_cents == null
                ? t("Custo: sem preço por mensagem acordado ainda — o disparo recusa até alguém definir.")
                : `${t("Custo:")} ${formatCentsBRL(carteira.data.preco_por_mensagem_cents)} ${t(
                    "por mensagem, do seu crédito",
                  )} (${t("saldo")} ${formatCentsBRL(carteira.data.saldo_cents)}).`}
          </p>
          <Button
            className="mt-auto"
            variant={escolhido === "oficial" ? "default" : "outline"}
            disabled={!canais.oficial}
            onClick={() => setEscolhido("oficial")}
          >
            {t("Usar o número oficial")}
          </Button>
        </Card>

        <Card className="flex flex-col gap-3 p-4" data-canal="qr">
          <div className="flex items-center gap-2">
            <QrCode size={20} aria-hidden />
            <h2 className="font-medium">{t("Número por QR")}</h2>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{t("Texto livre, com o nome e os dados de cada contato.")}</li>
            <li>{t("Sem custo por mensagem.")}</li>
            <li>{t("Sai no ritmo do número: intervalo, teto por hora e por dia.")}</li>
          </ul>
          <p className="flex items-start gap-1.5 rounded-md bg-warning-bg p-2 text-sm text-warning-fg" data-risco>
            <Warning size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {t(
                "Risco de bloqueio: se muita gente denunciar, ou se o ritmo passar do que o número aguenta, o WhatsApp pode bloquear o número — e ele leva semanas para voltar.",
              )}
            </span>
          </p>
          <p className="text-sm">
            {porQr.length === 0
              ? t("Nenhum número por QR conectado. Conecte um em Conexões.")
              : `${t("No formulário, escolha um destes números:")} ${porQr.map((n) => channelLabel(n, t)).join(", ")}`}
          </p>
          {/* Sempre liberado quando esta tela abre (`decidirAcesso`): sem o QR
              não sobra canal, e a página diz "não contratado" antes. */}
          <Button className="mt-auto" variant="outline" asChild>
            <Link href="/app/campaigns/new">{t("Usar o número por QR")}</Link>
          </Button>
        </Card>
      </div>

      {escolhido === "oficial" ? <FormularioDoOficial /> : null}
    </div>
  );
}
