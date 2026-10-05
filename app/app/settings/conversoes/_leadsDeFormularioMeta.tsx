"use client";

/**
 * FORK MIA — a chave "leads de formulário da Meta voltam para a Meta"
 * (migration 9017). Os eventos de etapa seguem a régua do upstream (0524), o
 * quadro "O que cada etapa do funil informa à Meta" logo acima. Salva no clique, como a chave vizinha da venda pelo canal:
 * é uma chave só, sem formulário em volta.
 *
 * Desligada por padrão. Ligar não envia o passado: só o que acontecer depois.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { definirLeadsDeFormularioDaMeta } from "@/app/actions/settings/conversoesDaMeta";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

const ERRO: Record<string, string> = {
  validation_failed: "Confira os campos: algum valor não está no formato esperado.",
  unauthenticated: "Sua sessão expirou. Entre de novo.",
  forbidden_tenant: "Você não está em nenhuma organização ativa.",
  forbidden_role: "Só um administrador da organização pode mudar esta conexão.",
  mfa_required: "Confirme o segundo fator para salvar esta mudança.",
  erro_ao_gravar: "Não consegui gravar agora. Tente de novo em instantes.",
};

export function LeadsDeFormularioDaMeta({
  ligada,
  desde,
  idioma,
}: {
  ligada: boolean;
  /** Desde quando a chave está ligada: é a partir daí que os eventos voltam. */
  desde: string | null;
  idioma: Idioma;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const router = useRouter();
  const [valor, setValor] = useState(ligada);
  const [isPending, startTransition] = useTransition();

  function mudar(novo: boolean) {
    setValor(novo);
    startTransition(async () => {
      const r = await definirLeadsDeFormularioDaMeta(novo);
      if (r.ok) {
        toast.success(
          t(
            novo
              ? "Ligada. Vale para o que acontecer com os leads de formulário a partir de agora."
              : "Desligada. Lead de formulário não volta mais para a Meta.",
          ),
        );
        router.refresh();
        return;
      }
      setValor(!novo);
      toast.error(t(ERRO[r.error] ?? "Não consegui salvar agora."));
    });
  }

  return (
    <Card className="p-6" data-testid="leads-de-formulario-da-meta">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="meta_leads_de_formulario">{t("Leads de formulário da Meta voltam para a Meta")}</Label>
          <p className="max-w-2xl text-xs text-muted-foreground">
            {t(
              "O sistema recebe os leads dos formulários da Meta e guarda o identificador de cada um, mas a Meta não fica sabendo quais viraram venda. Ligada, cada etapa com regra ligada no quadro acima e a venda também são informadas para o lead que veio de formulário, mesmo sem clique em anúncio de WhatsApp.",
            )}
          </p>
          <p className="max-w-2xl text-xs text-muted-foreground">
            {t(
              "Saem para a Meta o identificador do lead, o evento, o valor da venda e o telefone e o e-mail do contato em forma embaralhada. Vem desligada: ligue só se a sua política de privacidade cobre esse uso. Ligar não envia o passado.",
            )}
          </p>
          <p className="text-xs font-medium" data-testid="leads-de-formulario-estado">
            {valor
              ? t("Ligada: a Meta fica sabendo o que aconteceu com cada lead de formulário.")
              : t("Desligada: lead de formulário não volta para a Meta.")}
            {valor && desde ? ` ${t("Desde")} ${new Date(desde).toLocaleDateString(idioma)}.` : ""}
          </p>
        </div>
        <Switch id="meta_leads_de_formulario" checked={valor} disabled={isPending} onCheckedChange={mudar} />
      </div>
    </Card>
  );
}
