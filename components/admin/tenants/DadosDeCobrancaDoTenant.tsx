"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";

/**
 * FORK MIA (.99) · A CÓPIA DOS DADOS DE COBRANÇA NA FICHA DA EMPRESA (LGPD, o acesso
 * do titular). Quem assina a MIA não é um contato, então o pedido dele chega à Time, e
 * a Time baixa aqui o JSON com os dados fiscais inteiros, o passo do pagamento e o final
 * do cartão (`GET /api/v1/admin/tenants/[id]/dados-de-cobranca`). É o par da
 * anonimização da empresa inteira, que apaga esses mesmos dados. Só com a cobrança
 * ligada; a rota pede a verificação em duas etapas e grava no Audit Log.
 */
export function DadosDeCobrancaDoTenant({ orgId }: { orgId: string }) {
  const t = useT();
  return (
    <Card className="space-y-3 p-6" data-lgpd="dados-de-cobranca">
      <h2 className="text-sm font-semibold">{t("Dados de cobrança (LGPD)")}</h2>
      <p className="text-sm text-muted-foreground">
        {t(
          "A cópia do que a empresa guarda para a cobrança e a nota fiscal, para atender o pedido do titular: os dados fiscais inteiros (na pessoa física, o CPF, o endereço e o WhatsApp de quem assina), o passo do pagamento e o final do cartão.",
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <a href={`/api/v1/admin/tenants/${orgId}/dados-de-cobranca`}>{t("Baixar os dados de cobrança")}</a>
        </Button>
        <span className="text-xs text-muted-foreground">{t("Pede a verificação em duas etapas e fica no Audit Log.")}</span>
      </div>
    </Card>
  );
}
