"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { decideRegistrationRequest } from "@/app/actions/registration/decide";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { MENSAGEM_DA_RECUSA_DE_ESCRITA } from "@/lib/auth/recusa-de-escrita-de-admin";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import type { PedidoDeCadastro } from "@/lib/planos-mia/empresas-do-cadastro";

const ERROS: Record<string, string> = {
  ...MENSAGEM_DA_RECUSA_DE_ESCRITA,
  not_found: "Este pedido já foi decidido.",
  account_unavailable: "A conta deste pedido não existe mais ou ainda não confirmou o e-mail.",
};

/**
 * FORK MIA (.90) — os pedidos esperando aprovação, com o plano e o que a
 * empresa faz na linha. A decisão é a MESMA ação do upstream
 * (`decideRegistrationRequest`, a fila de `/admin/cadastro`): aprovar cria a
 * empresa no plano escolhido e o teste começa; recusar é final. O motivo por
 * e-mail sai pelo MCP (`plataforma_decidir_pedido_de_cadastro`).
 */
export function PedidosDoCadastro({
  pedidos,
  modoComAprovacao,
}: {
  pedidos: readonly PedidoDeCadastro[];
  modoComAprovacao: boolean;
}) {
  const t = useT();
  const idioma = useIdioma();
  const [erro, setErro] = useState<string | null>(null);
  const [emCurso, startTransition] = useTransition();
  const router = useRouter();
  const quando = new Intl.DateTimeFormat(idioma, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });

  function decidir(requestId: string, decision: "approve" | "reject") {
    setErro(null);
    startTransition(async () => {
      const r = await decideRegistrationRequest({ requestId, decision });
      if (!r.ok) setErro(t(ERROS[r.error] ?? "Não deu para salvar. Tente de novo em instantes."));
      // A ação revalida /admin/cadastro; esta tela relê por conta própria.
      else router.refresh();
    });
  }

  return (
    <Card className="space-y-3 p-4" data-jornada="pedidos">
      <h2 className="text-sm font-semibold">{t("Pedidos aguardando aprovação")}</h2>
      {!modoComAprovacao && (
        <p className="text-xs text-muted-foreground">
          {t(
            "O cadastro desta instalação não está no modo com aprovação: pedido novo não entra nesta fila.",
          )}
        </p>
      )}
      {pedidos.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("Nenhum pedido aguardando.")}</p>
      ) : (
        <ul className="space-y-2">
          {pedidos.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              data-pedido={p.id}
            >
              <div className="min-w-0 space-y-0.5 text-sm">
                <p className="font-medium">{p.empresa}</p>
                <p className="text-xs text-muted-foreground">
                  {[
                    p.email ?? "—",
                    p.plano ? t("plano {plano}").replace("{plano}", p.plano) : t("plano padrão"),
                  ].join(" · ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    p.o_que_faz ?? t("não disse o que a empresa faz"),
                    quando.format(new Date(p.criado_em)),
                  ].join(" · ")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={emCurso}
                  onClick={() => decidir(p.id, "reject")}
                >
                  {t("Recusar")}
                </Button>
                <Button size="sm" disabled={emCurso} onClick={() => decidir(p.id, "approve")}>
                  {t("Aprovar")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {erro && (
        <p className="text-sm text-destructive" role="alert">
          {erro}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {t(
          "Aprovar cria a empresa no plano escolhido e o teste começa; recusar é final para aquela conta.",
        )}
      </p>
    </Card>
  );
}
