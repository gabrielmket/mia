import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { ROTULO_DO_MODULO_DO_PLANO, type ModuloDoPlano } from "@/lib/planos-mia/catalogo";

/**
 * FORK MIA (.90) — a tela de um módulo que o plano da empresa não tem.
 *
 * O menu já esconde a porta; esta tela recebe quem chega por link salvo ou
 * favorito e diz por quê, em vez de mostrar uma lista vazia. Os dados ficam
 * guardados: voltar ao plano devolve tudo. Desenhada pelo servidor, no idioma
 * de quem abriu; o botão de trocar de plano só para quem administra.
 */
export function ForaDoPlano({
  modulo,
  idioma,
  administra,
}: {
  modulo: ModuloDoPlano;
  idioma: Idioma;
  administra: boolean;
}) {
  const t = (s: string) => traduzir(s, idioma);
  const nome = t(ROTULO_DO_MODULO_DO_PLANO[modulo].rotulo);
  return (
    <div className="p-6">
      <Card className="max-w-xl space-y-3 p-6" data-fora-do-plano={modulo}>
        <h1 className="text-lg font-semibold">
          {t("{modulo} não está no plano da sua empresa").replace("{modulo}", nome)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(ROTULO_DO_MODULO_DO_PLANO[modulo].descricao)}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("O que já foi feito aqui continua guardado e volta quando o módulo voltar.")}
        </p>
        {administra ? (
          <Button asChild>
            <Link href="/app/settings/billing">{t("Ver os planos em Plano e cobrança")}</Link>
          </Button>
        ) : (
          <p className="text-sm">{t("Para usar, fale com quem administra a empresa.")}</p>
        )}
      </Card>
    </div>
  );
}
