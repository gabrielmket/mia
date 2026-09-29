"use client";
/**
 * FORK MIA — o que a tela do Broadcast diz quando não pode abrir.
 *
 * Tela vazia é o pior jeito de recusar: a pessoa conclui que o produto não tem
 * disparo nenhum, ou que o dela sumiu. Cada estado diz o motivo e a quem pedir.
 */
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import type { AcessoAoBroadcast } from "@/lib/broadcast/canais-do-disparo";

export function AvisoDeAcesso({ acesso }: { acesso: Exclude<AcessoAoBroadcast, { estado: "liberado" }> }) {
  const t = useT();
  return (
    <div className="space-y-4 p-6">
      <header className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Broadcast")}</h1>
      </header>
      <Card className="p-6" data-acesso={acesso.estado}>
        <p className="text-sm text-muted-foreground">
          {acesso.estado === "nao_contratado"
            ? t("O Broadcast não está contratado para esta empresa. Fale com quem cuida da sua conta.")
            : acesso.estado === "sem_papel"
              ? t("Esta tela é de quem gerencia a empresa.")
              : t("Sem organização ativa.")}
        </p>
      </Card>
    </div>
  );
}
