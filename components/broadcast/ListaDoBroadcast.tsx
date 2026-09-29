"use client";
/**
 * FORK MIA — a LISTA do Broadcast unificado (1.21.0-mia.58).
 *
 * No molde da lista de Campanhas do upstream (`app/app/campaigns/_client.tsx`),
 * que é a experiência que o dono do produto escolheu: título, o que decide o
 * próximo clique em cada linha (em que pé está, para quantas pessoas, quando) e
 * um estado vazio que explica o produto. A diferença é que aqui a lista junta os
 * dois caminhos, e por isso cada linha diz POR ONDE saiu.
 *
 * ── Os dois quadros do topo ────────────────────────────────────────────────
 *
 * Existem para a pessoa saber o preço de cada caminho ANTES de clicar em
 * "Novo disparo": o oficial custa dinheiro por mensagem; o por QR não custa,
 * mas arrisca o número. É a única diferença que muda a decisão, e escondê-la
 * dentro do formulário faria a pessoa descobri-la depois de montar a lista.
 *
 * Desenho: docs/fork/broadcast-unificado.md.
 */
import Link from "next/link";
import { useMemo, useState } from "react";

import { EstadoDaCampanha } from "@/components/campanhas/EstadoDaCampanha";
import { EmptyState } from "@/components/empty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCampanhas } from "@/hooks/campanhas/useCampanhas";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useBroadcasts } from "@/hooks/useBroadcasts";
import { useCarteira } from "@/hooks/useCarteira";
import type { CanaisLiberados } from "@/lib/broadcast/canais-do-disparo";
import {
  mesclarDisparos,
  type CanalDoDisparo,
  type DisparoNaLista,
} from "@/lib/broadcast/lista-unificada";
import { STATUS_DA_CAMPANHA, type StatusDaCampanha } from "@/lib/campanhas/tipos";
import { formatCentsBRL } from "@/lib/money";
import { Megaphone, Plus, QrCode, ShieldCheck, Warning } from "@/lib/ui/icons";

import { rotuloDaSituacao } from "./textos";

export function ListaDoBroadcast({ canais }: { canais: CanaisLiberados }) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const [status, setStatus] = useState<StatusDaCampanha | "">("");
  const [canal, setCanal] = useState<CanalDoDisparo | "">("");

  // O caminho por QR está SEMPRE liberado quando esta lista aparece
  // (`decidirAcesso`: sem o QR não sobra canal, e a página diz "não
  // contratado"). Por isso a consulta das campanhas não tem interruptor.
  const filtrosQr = useMemo(() => ({ status: status || undefined, limit: 30 }), [status]);
  const qr = useCampanhas(filtrosQr);
  const oficiais = useBroadcasts({ habilitado: canais.oficial });
  const carteira = useCarteira({ habilitado: canais.oficial });

  const campanhasQr = useMemo(() => qr.data?.pages.flatMap((p) => p.data) ?? [], [qr.data]);
  const disparos = useMemo(
    () =>
      mesclarDisparos(campanhasQr, canais.oficial ? (oficiais.data ?? []) : [], {
        qrTemMais: !!qr.hasNextPage,
        filtros: { status, canal },
      }),
    [campanhasQr, oficiais.data, canais.oficial, qr.hasNextPage, status, canal],
  );

  const carregando = qr.isLoading || (canais.oficial && oficiais.isLoading);

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Broadcast")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Fale com uma lista de contatos que você escolhe e acompanhe quem recebeu.")}
          </p>
        </div>
        <Button asChild className="shrink-0">
          <Link href="/app/broadcast/novo">
            <Plus size={16} weight="bold" aria-hidden />
            <span>{t("Novo disparo")}</span>
          </Link>
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="space-y-2 p-4" data-canal="oficial">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} aria-hidden />
            <h2 className="font-medium">{t("Número oficial (Meta)")}</h2>
          </div>
          {canais.oficial ? (
            <>
              <p className="text-sm text-muted-foreground">
                {t("Só modelo aprovado pela Meta. Cada mensagem é cobrada do seu crédito.")}
              </p>
              <p className="text-sm">
                {carteira.data?.preco_por_mensagem_cents == null
                  ? t("Sem preço por mensagem acordado — fale com quem cuida da sua conta antes de montar.")
                  : `${t("Saldo:")} ${formatCentsBRL(carteira.data.saldo_cents)} · ${formatCentsBRL(
                      carteira.data.preco_por_mensagem_cents,
                    )} ${t("por mensagem")}`}
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link href="/app/settings/carteira">{t("Créditos")}</Link>
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("Não contratado para esta empresa. Fale com quem cuida da sua conta.")}
            </p>
          )}
        </Card>
        <Card className="space-y-2 p-4" data-canal="qr">
          <div className="flex items-center gap-2">
            <QrCode size={18} aria-hidden />
            <h2 className="font-medium">{t("Número por QR")}</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("Texto livre, sem custo por mensagem, no ritmo do número.")}
          </p>
          <p className="flex items-start gap-1.5 text-sm text-warning-fg">
            <Warning size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>{t("Risco de bloqueio: o WhatsApp pode bloquear o número se a lista reclamar.")}</span>
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/app/campaigns/settings">{t("Configuração")}</Link>
          </Button>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2">
        <label className="text-sm text-muted-foreground" htmlFor="filtro-status">
          {t("Situação")}
        </label>
        <select
          id="filtro-status"
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusDaCampanha | "")}
        >
          <option value="">{t("Todas")}</option>
          {STATUS_DA_CAMPANHA.map((s) => (
            <option key={s} value={s}>
              {rotuloDaSituacao(s, t)}
            </option>
          ))}
        </select>
        <label className="text-sm text-muted-foreground" htmlFor="filtro-canal">
          {t("Canal")}
        </label>
        <select
          id="filtro-canal"
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          value={canal}
          onChange={(e) => setCanal(e.target.value as CanalDoDisparo | "")}
        >
          <option value="">{t("Todos")}</option>
          {canais.oficial ? <option value="oficial">{t("Número oficial (Meta)")}</option> : null}
          <option value="qr">{t("Número por QR")}</option>
        </select>
      </div>

      {qr.isError || (canais.oficial && oficiais.isError) ? (
        <Card className="space-y-2 p-4">
          <p className="text-sm text-error-fg">
            {qr.isError
              ? t("Não consegui carregar os disparos pelo número por QR.")
              : t("Não consegui carregar os disparos pelo número oficial.")}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void qr.refetch();
              if (canais.oficial) void oficiais.refetch();
            }}
          >
            {t("Tentar novamente")}
          </Button>
        </Card>
      ) : null}

      {carregando ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : disparos.length === 0 ? (
        <Card className="p-2">
          <EmptyState
            icon={Megaphone}
            headline={status || canal ? t("Nenhum disparo com este filtro.") : t("Nenhum disparo ainda.")}
            subcopy={t(
              "Um disparo fala com uma lista de contatos que você escolhe: pelo número oficial, com custo por mensagem, ou pelo número por QR, no ritmo do número.",
            )}
            primary={{ label: t("Novo disparo"), href: "/app/broadcast/novo" }}
          />
        </Card>
      ) : (
        <>
          <Card className="divide-y divide-border">
            {disparos.map((d) => (
              <LinhaDoDisparo key={`${d.canal}:${d.id}`} disparo={d} t={t} idioma={idioma} />
            ))}
          </Card>
          {qr.hasNextPage && canal !== "oficial" ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => qr.fetchNextPage()}
                disabled={qr.isFetchingNextPage}
              >
                {qr.isFetchingNextPage ? t("Carregando…") : t("Carregar mais")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function LinhaDoDisparo({
  disparo: d,
  t,
  idioma,
}: {
  disparo: DisparoNaLista;
  t: (texto: string) => string;
  idioma: string;
}) {
  return (
    <Link
      href={d.href}
      data-disparo={d.canal}
      className="flex flex-col gap-2 p-4 transition-colors hover:bg-surface-elevated sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate font-medium">{d.nome}</p>
          <Badge variant="neutral" className="shrink-0">
            {d.canal === "oficial" ? (
              <>
                <ShieldCheck size={12} weight="bold" aria-hidden />
                {t("Oficial")}
              </>
            ) : (
              <>
                <QrCode size={12} weight="bold" aria-hidden />
                {t("QR")}
              </>
            )}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{resumo(d, t)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-sm text-muted-foreground">{quando(d, t, idioma)}</span>
        <EstadoDaCampanha status={d.status} />
      </div>
    </Link>
  );
}

/** O que decide o próximo clique: quantos, e — no oficial — quanto custa. */
function resumo(d: DisparoNaLista, t: (texto: string) => string): string {
  const r = d.resumo;
  if (r.canal === "qr") {
    const base = r.naLista > 0 ? `${r.naLista} ${t("contatos na lista")}` : t("lista ainda não preparada");
    return r.fora > 0 ? `${base} · ${r.fora} ${t("fora")}` : base;
  }
  const partes = [
    `${r.naLista} ${t("na lista")}`,
    `${r.saiu} ${t("enviadas")}`,
    ...(r.falhou > 0 ? [`${r.falhou} ${t("falhas")}`] : []),
    r.modelo,
    ...(r.custoCents !== null ? [formatCentsBRL(r.custoCents)] : []),
  ];
  return partes.join(" · ");
}

function quando(d: DisparoNaLista, t: (texto: string) => string, idioma: string): string {
  const data = new Date(d.quando.em).toLocaleString(idioma, { dateStyle: "short", timeStyle: "short" });
  switch (d.quando.tipo) {
    case "comeca":
      return `${t("começa")} ${data}`;
    case "terminou":
      return `${t("terminou")} ${data}`;
    case "comecou":
      return `${t("começou")} ${data}`;
    case "criada":
      return `${t("criada")} ${data}`;
  }
}
