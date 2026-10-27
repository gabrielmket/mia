"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { MENSAGEM_DA_RECUSA_DE_ESCRITA, ehRecusaDeEscrita } from "@/lib/auth/recusa-de-escrita-de-admin";

/**
 * FORK MIA (.96, segunda frente) · "Apagar o cadastro" em Empresas do cadastro
 * (protótipo "Pagamento no início", tela 4 e decisão 5). O botão só existe na
 * empresa sem nenhum pagamento há mais de 30 dias, e nada é apagado sozinho.
 * Quem apaga digita o nome curto da empresa; o servidor pede a verificação em
 * duas etapas da sessão, como as outras escritas desta tela, cancela a cobrança
 * no Asaas e chama a exclusão do upstream.
 */
export function ApagarCadastro({ orgId, nome, slug, dias }: { orgId: string; nome: string; slug: string; dias: number }) {
  const t = useT();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [confirmacao, setConfirmacao] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const confere = confirmacao.trim() === slug;

  function fechar() {
    if (ocupado) return;
    setAberto(false);
    setConfirmacao("");
    setErro(null);
  }

  async function apagar() {
    setErro(null);
    setOcupado(true);
    try {
      const r = await fetch(`/api/v1/admin/empresas-do-cadastro/${orgId}/apagar`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmacao: confirmacao.trim() }),
      });
      const corpo = (await r.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      if (!r.ok) {
        const codigo = corpo.error?.code;
        setErro(
          ehRecusaDeEscrita(codigo)
            ? t(MENSAGEM_DA_RECUSA_DE_ESCRITA[codigo])
            : (corpo.error?.message ?? t("Não deu para apagar agora. Tente de novo em instantes.")),
        );
        return;
      }
      setAberto(false);
      setConfirmacao("");
      router.replace("/admin/empresas-do-cadastro");
      router.refresh();
    } catch {
      setErro(t("Não deu para falar com o servidor. Confira a conexão e tente de novo."));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="mt-1" onClick={() => setAberto(true)} data-jornada="apagar-cadastro">
        {t("Apagar o cadastro")}
      </Button>
      <AlertDialog
        open={aberto}
        onOpenChange={(v) => {
          if (!v) fechar();
        }}
      >
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Apagar o cadastro de {nome}").replace("{nome}", nome)}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {t("A empresa se cadastrou há {dias} dias e nunca pagou. Apagar tira a empresa, os dados dela e o login de quem se cadastrou, que pode se cadastrar de novo.").replace(
                    "{dias}",
                    String(dias),
                  )}
                </p>
                <p>
                  {t("Antes, a cobrança em aberto é cancelada no Asaas, para nada ficar cobrando. Fica o registro da exclusão na auditoria.")}
                </p>
                <p className="font-medium text-destructive">{t("Não há como desfazer.")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor={`apagar-${orgId}`}>
              {t("Para confirmar, digite o nome curto da empresa")}:{" "}
              <code className="rounded-md bg-muted px-1 py-0.5 text-xs">{slug}</code>
            </Label>
            <Input
              id={`apagar-${orgId}`}
              value={confirmacao}
              onChange={(ev) => setConfirmacao(ev.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={confirmacao.length > 0 && !confere}
            />
            {erro ? (
              <p className="text-sm text-destructive" role="alert">
                {erro}
              </p>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={fechar} disabled={ocupado}>
              {t("Cancelar")}
            </AlertDialogCancel>
            <Button variant="destructive" disabled={!confere || ocupado} onClick={() => void apagar()}>
              {ocupado ? t("Apagando...") : t("Apagar o cadastro")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
