"use client";
/**
 * FORK MIA · coexistência (S3; docs/fork/coexistencia.md): "Coexistência por
 * empresa" em /admin/meta, a tela 5 do protótipo v3 aprovado pelo Gabriel em
 * 17/11/2026. Liga, por empresa, o botão "Conectar pelo app WhatsApp
 * Business". Nasce desligada. Desligar não derruba quem já está conectado.
 *
 * Mudar exige acesso de escrita e MFA em dia, como o resto da tela
 * (`app/api/v1/admin/coexistencia`). O MCP de plataforma faz o mesmo
 * (`plataforma_ligar_coexistencia`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { estadoGeralDaSincronizacao, SeloDaSincronizacao } from "@/components/connections/coexistencia/CartaoDaSincronizacao";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import type { NumeroPeloAppNaTela } from "@/hooks/channels/useCoexistencia";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

interface EmpresaDaCoexistencia {
  organization_id: string;
  nome: string | null;
  status: string | null;
  demonstracao: boolean;
  ligada: boolean;
  mudada_em: string | null;
  numeros: NumeroPeloAppNaTela[];
}

const CHAVE = ["admin-coexistencia"] as const;

export function CoexistenciaPorEmpresa() {
  const t = useT();
  const tag = useTagDeIdioma();
  const qc = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: CHAVE,
    queryFn: async () => apiClient.get<{ data: { empresas: EmpresaDaCoexistencia[] } }>("/api/v1/admin/coexistencia"),
  });
  const mudar = useMutation({
    mutationFn: async (v: { organization_id: string; ligada: boolean }) =>
      apiClient.put<{ data: { ligada: boolean; numeros_que_continuam: string[] } }>("/api/v1/admin/coexistencia", v),
    onError: showApiError,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: CHAVE });
      toast.success(r.data.ligada ? t("Coexistência ligada.") : t("Coexistência desligada."));
    },
  });
  const [pedido, setPedido] = useState<EmpresaDaCoexistencia | null>(null);

  const quando = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(tag, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : t("nunca");

  return (
    <Card className="p-4" data-testid="coexistencia-por-empresa">
      <h2 className="font-medium">{t("Coexistência por empresa")}</h2>
      <p className="mt-1 text-sm text-text-muted">
        {t(
          "Liga, por empresa, o botão \"Conectar pelo app WhatsApp Business\". Nasce desligada. Desligar não derruba quem já está conectado: só esconde o botão.",
        )}
      </p>
      {isPending ? <p className="mt-3 text-sm text-text-muted">{t("Carregando…")}</p> : null}
      {error ? <p className="mt-3 text-sm text-error-fg">{t("Não foi possível ler a coexistência das empresas.")}</p> : null}
      {data ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted">
                <th className="py-2 pr-3">{t("Empresa")}</th>
                <th className="py-2 pr-3">{t("Coexistência")}</th>
                <th className="py-2 pr-3">{t("Número pelo app")}</th>
                <th className="py-2 pr-3">{t("Sincronização")}</th>
                <th className="py-2">{t("Última mudança")}</th>
              </tr>
            </thead>
            <tbody>
              {data.data.empresas.map((e) => {
                const numero = e.numeros.find((n) => n.estado !== "encerrada") ?? null;
                const historico = numero?.pedidos.find((p) => p.tipo === "historico");
                const contatos = numero?.pedidos.find((p) => p.tipo === "contatos");
                return (
                  <tr key={e.organization_id} className="border-t border-border" data-testid={`coexistencia-empresa-${e.organization_id}`}>
                    <td className="py-2 pr-3 font-medium">{e.nome ?? e.organization_id}</td>
                    <td className="py-2 pr-3">
                      <Switch
                        checked={e.ligada}
                        onCheckedChange={() => setPedido(e)}
                        aria-label={t("Coexistência")}
                        disabled={mudar.isPending}
                      />
                      <div className="text-xs text-text-muted">{e.ligada ? t("ligada") : t("desligada")}</div>
                    </td>
                    <td className="py-2 pr-3">
                      {numero ? (
                        <>
                          <span className="font-mono">{numero.phoneNumber ?? numero.phoneNumberId}</span>
                          <div className="text-xs text-text-muted">{numero.estado === "no_ar" ? t("no ar") : t("fora do ar")}</div>
                        </>
                      ) : (
                        <span className="text-text-muted">{t("nenhum")}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {numero ? (
                        <>
                          <SeloDaSincronizacao estado={estadoGeralDaSincronizacao(numero.pedidos)} />
                          <div className="text-xs text-text-muted">
                            {(contatos?.contatosRecebidos ?? 0).toLocaleString(tag)} {t("contatos")} ·{" "}
                            {(historico?.conversasRecebidas ?? 0).toLocaleString(tag)} {t("conversas")}
                          </div>
                        </>
                      ) : (
                        <span className="text-text-muted">{t("nenhuma")}</span>
                      )}
                    </td>
                    <td className="py-2 text-xs text-text-muted">{quando(e.mudada_em)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-text-muted">
        {t("Pelo MCP de plataforma (mesmo efeito):")} <code>plataforma_ver_coexistencia</code>,{" "}
        <code>plataforma_ligar_coexistencia</code>, <code>plataforma_ver_sincronizacao_do_app</code>
      </p>

      <Dialog open={pedido !== null} onOpenChange={(abrir) => (!abrir ? setPedido(null) : undefined)}>
        <DialogContent data-testid="coexistencia-confirmar-troca">
          {pedido ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {(pedido.ligada ? t("Desligar a coexistência da {empresa}?") : t("Ligar a coexistência da {empresa}?")).replace(
                    "{empresa}",
                    pedido.nome ?? pedido.organization_id,
                  )}
                </DialogTitle>
                <DialogDescription>
                  {pedido.ligada
                    ? t("O botão \"Conectar pelo app WhatsApp Business\" some da tela dela.")
                    : t("Aparece para ela o botão \"Conectar pelo app WhatsApp Business\", com o aviso de limites e custos. Fica registrado quem ligou e quando.")}{" "}
                  {pedido.ligada && pedido.numeros.some((n) => n.estado !== "encerrada")
                    ? t("O número continua conectado: para tirá-lo, é pelo app ou pelo canal.")
                    : ""}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPedido(null)}>
                  {t("Cancelar")}
                </Button>
                <Button
                  variant={pedido.ligada ? "destructive" : "default"}
                  disabled={mudar.isPending}
                  onClick={() => {
                    mudar.mutate({ organization_id: pedido.organization_id, ligada: !pedido.ligada });
                    setPedido(null);
                  }}
                  data-testid="coexistencia-confirmar"
                >
                  {pedido.ligada ? t("Desligar") : t("Ligar")}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
