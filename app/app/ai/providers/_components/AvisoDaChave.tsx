"use client";

/**
 * FORK MIA (MIA-218) · o aviso da chave na tela Provedores de IA.
 *
 * O do upstream dizia "Você ainda não cadastrou a chave da sua IA principal"
 * a toda empresa sem chave própria. Aqui a chave é da plataforma
 * (`lib/ai/custo-e-da-plataforma.ts`): a empresa não precisa cadastrar nada, e
 * a frase fez o próprio dono da instalação achar que precisava. Agora:
 *
 *   - com a chave da instalação: "Usando a chave da <marca>. Nenhuma chave
 *     precisa ser cadastrada." Só o admin da plataforma vê, como opção
 *     avançada, o caminho para uma chave própria desta empresa;
 *   - sem chave nenhuma: o admin da plataforma vê o aviso do upstream (é ele
 *     quem cadastra); a empresa vê que é com o suporte, sem link para um beco.
 *
 * Com chave própria cadastrada, nada aparece (igual ao upstream).
 */
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { useMarcaDaInstalacao } from "@/lib/branding/contexto";

export function AvisoDaChave({
  semChavePropria,
  instalacaoTemChave,
  podeCadastrarChave,
}: {
  semChavePropria: boolean;
  instalacaoTemChave: boolean;
  /** `podeConfigurarChaveDeIa`: admin da plataforma fora de suporte. */
  podeCadastrarChave: boolean;
}) {
  const t = useT();
  const marca = useMarcaDaInstalacao();
  if (!semChavePropria) return null;

  if (instalacaoTemChave) {
    return (
      <Card className="mb-6 p-4" data-testid="aviso-chave-da-plataforma">
        <p className="text-sm">
          {t("Usando a chave da {marca}. Nenhuma chave precisa ser cadastrada.").replace("{marca}", () => marca.nome)}
        </p>
        {podeCadastrarChave && (
          <p className="mt-2 text-xs text-muted-foreground" data-testid="chave-propria-avancado">
            {t("Opção avançada:")}{" "}
            <Link className="underline underline-offset-4" href="/app/ai/credentials">
              {t("cadastrar uma chave própria desta empresa")}
            </Link>
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card className="mb-6 border-amber-500/40 bg-amber-500/5 p-4" data-testid="aviso-sem-chave">
      {podeCadastrarChave ? (
        <p className="text-sm">
          {t("Você ainda não cadastrou a chave da sua IA principal, a que conversa com os clientes.")}{" "}
          <Link className="underline underline-offset-4" href="/app/ai/credentials">
            {t("Cadastrar uma chave")}
          </Link>
        </p>
      ) : (
        <p className="text-sm">{t("A IA desta conta está sem chave para funcionar. Fale com o suporte.")}</p>
      )}
    </Card>
  );
}
