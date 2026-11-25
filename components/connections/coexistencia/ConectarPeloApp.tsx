"use client";
/**
 * FORK MIA · coexistência (S3; docs/fork/coexistencia.md): "Conectar pelo app
 * WhatsApp Business" na tela do canal oficial, igual às telas 1, 2 e 3 do
 * protótipo v3 aprovado pelo Gabriel em 17/11/2026.
 *
 *  - chave desligada e sem número pelo app: o cartão sem botão, com o recado;
 *  - chave ligada: o cartão com o "Antes de começar", os passos e o botão,
 *    que abre o aviso de limites e custos e, dele, a janela da Meta;
 *  - número conectado pelo app: o resumo (número, origem, no ar) e a
 *    sincronização em "Ver a sincronização";
 *  - S4: número fora do ar ou de volta (tela 4): `ForaDoArEVolta`, com o
 *    "Conectar de novo" pela mesma janela.
 *
 * Encaixe único em `components/connections/CanalOficialClient.tsx` (FORK MIA).
 * As outras formas de conectar (link do cadastro e manual) seguem como estão.
 */
import { useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCoexistencia, useConectarPeloApp } from "@/hooks/channels/useCoexistencia";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";

import { AvisoDeLimitesECustos } from "./AvisoDeLimitesECustos";
import { ForaDoArEVolta } from "./ForaDoArEVolta";
import { CartaoDaSincronizacao, SeloDaSincronizacao, estadoGeralDaSincronizacao } from "./CartaoDaSincronizacao";
import { JanelaDaMetaNaoTerminou } from "./sdk-da-meta";

/** O idioma do SDK da Meta, pelo idioma da tela. */
function localeDoSdk(tag: string): string {
  return tag.toLowerCase().startsWith("es") ? "es_LA" : "pt_BR";
}

export function ConectarPeloApp({ canalConectado = false }: { canalConectado?: boolean } = {}) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const { data, isPending } = useCoexistencia();
  const conectar = useConectarPeloApp();
  const [avisoAberto, setAvisoAberto] = useState(false);
  const [verSincronizacao, setVerSincronizacao] = useState(false);

  if (isPending || !data) return null;
  const estado = data.data;
  const empresa = estado.empresa;
  const numero = estado.numero && estado.numero.estado !== "encerrada" ? estado.numero : null;

  const janela = estado.janela;
  async function abrirJanela() {
    if (!janela.pronta || !janela.appId || !janela.configId || !janela.graphVersion) return;
    try {
      const r = await conectar.mutateAsync({
        appId: janela.appId,
        configId: janela.configId,
        graphVersion: janela.graphVersion,
        locale: localeDoSdk(idioma),
      });
      setAvisoAberto(false);
      toast.success(`${t("Conectado:")} ${r.data.displayName} ${r.data.phoneNumber ?? ""}`.trim());
    } catch (err) {
      if (err instanceof JanelaDaMetaNaoTerminou) {
        toast.error(
          err.motivo === "sem_sdk"
            ? t("Não foi possível abrir a janela da Meta. Confira se o navegador bloqueia janelas e tente de novo.")
            : err.motivo === "tempo_esgotado"
              ? t("A janela da Meta ficou aberta tempo demais. Abra de novo quando estiver com o celular na mão.")
              : t("A janela da Meta foi fechada antes do fim. Nada foi conectado."),
        );
        return;
      }
      showApiError(err);
    }
  }

  if (numero) {
    const geral = estadoGeralDaSincronizacao(numero.pedidos);
    return (
      <div className="flex flex-col gap-4" data-testid="coexistencia-conectado">
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-medium">
                {[empresa, numero.phoneNumber].filter(Boolean).join(" · ")}
              </h2>
              <p className="text-xs text-text-muted">
                {t("Conectado pelo app WhatsApp Business · origem: cadastro incorporado")}
              </p>
            </div>
            {numero.estado === "no_ar" ? (
              <Badge variant="success">{t("no ar")}</Badge>
            ) : (
              <Badge variant="error">{t("fora do ar")}</Badge>
            )}
          </div>
          {/* S4: o número fora do ar e o de volta (tela 4 do protótipo). */}
          <ForaDoArEVolta
            numero={numero}
            podeConectar={estado.ligada && janela.pronta && !conectar.isPending}
            aoConectar={() => setAvisoAberto(true)}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span>{t("Sincronização:")}</span>
            <SeloDaSincronizacao estado={geral} />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setVerSincronizacao((v) => !v)}
              data-testid="coexistencia-ver-sincronizacao"
            >
              {verSincronizacao ? t("Esconder a sincronização") : t("Ver a sincronização")}
            </Button>
          </div>
        </Card>
        {verSincronizacao ? <CartaoDaSincronizacao numero={numero} empresa={empresa} /> : null}
        {numero.estado === "fora_do_ar" ? (
          <AvisoDeLimitesECustos
            aberto={avisoAberto}
            aoFechar={() => setAvisoAberto(false)}
            aoContinuar={abrirJanela}
            continuando={conectar.isPending}
          />
        ) : null}
      </div>
    );
  }

  // O canal oficial já conectado por outra porta (link ou manual): o cartão some,
  // como no protótipo. Trocar o número é excluir o canal em Conexões primeiro.
  if (canalConectado) return null;

  if (!estado.ligada) {
    return (
      <Card className="p-4" data-testid="coexistencia-sem-chave">
        <h2 className="font-medium">{t("Conectar pelo app WhatsApp Business")}</h2>
        <p className="mt-1 text-sm text-text-muted">
          {t("Esta opção ainda não está liberada para a sua empresa. Fale com o suporte da MIA.")}
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4" data-testid="coexistencia-com-chave">
      <div className="flex items-center gap-2">
        <h2 className="font-medium">{t("Conectar pelo app WhatsApp Business")}</h2>
        <Badge variant="default">{t("novo")}</Badge>
      </div>
      <p className="mt-1 text-sm text-text-muted">
        {t(
          "Use o MESMO número que a empresa já usa no app do celular. A IA e a equipe atendem pela MIA, e quem quiser segue respondendo pelo app.",
        )}
      </p>
      <div className="mt-3 grid gap-4 text-sm md:grid-cols-2">
        <div>
          <h3 className="mb-1 font-medium">{t("Antes de começar")}</h3>
          <ul className="list-disc space-y-1 pl-4">
            <li>
              {t("App WhatsApp Business 2.24.17 ou mais novo no celular do número")}{" "}
              <Badge variant="success" className="font-normal">
                {t("conferido")}
              </Badge>
            </li>
            <li>{t("O celular na mão: a janela da Meta mostra um QR para ler com ele")}</li>
            <li>{t("Login no Facebook de quem administra o portfólio da empresa")}</li>
          </ul>
        </div>
        <div>
          <h3 className="mb-1 font-medium">{t("Os passos na janela da Meta")}</h3>
          <ol className="list-decimal space-y-1 pl-4">
            <li>{t("Entrar com o Facebook e escolher o portfólio da empresa")}</li>
            <li>{t("Escolher \"conectar o app WhatsApp Business\" e informar o número")}</li>
            <li>{t("No celular, abrir o app e ler o QR que a janela mostra")}</li>
            <li>{t("Escolher se compartilha o histórico das conversas")}</li>
            <li>
              {t("Concluir. O número volta para cá já amarrado à {empresa}").replace("{empresa}", empresa ?? t("sua empresa"))}
            </li>
          </ol>
        </div>
      </div>
      <Button
        className="mt-4"
        disabled={!janela.pronta || conectar.isPending}
        onClick={() => setAvisoAberto(true)}
        data-testid="coexistencia-conectar"
      >
        {t("Conectar pelo app WhatsApp Business")}
      </Button>
      <p className="mt-1 text-xs text-text-muted">
        {janela.pronta
          ? t("Abre primeiro o aviso de limites e custos.")
          : t("A instalação ainda não tem o app da Meta configurado para esta conexão. Fale com o suporte da MIA.")}
      </p>
      <AvisoDeLimitesECustos
        aberto={avisoAberto}
        aoFechar={() => setAvisoAberto(false)}
        aoContinuar={abrirJanela}
        continuando={conectar.isPending}
      />
    </Card>
  );
}
