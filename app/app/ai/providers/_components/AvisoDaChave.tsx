"use client";

/**
 * FORK MIA (MIA-218) · o aviso da chave na tela Provedores de IA
 * (docs/fork/ia-da-plataforma.md).
 *
 * O do upstream dizia "Você ainda não cadastrou a chave da sua IA principal"
 * a toda empresa sem chave própria. Aqui a chave é da plataforma
 * (`lib/ai/custo-e-da-plataforma.ts`): a empresa não precisa cadastrar nada, e
 * a frase fez o próprio dono da instalação achar que precisava.
 *
 * O aviso segue `ia.chave` do GET de Provedores (`iaDaEmpresa`, MIA-217), a
 * mesma régua do turno, da `/health` e do MCP:
 *
 *   - `"instalacao"`: "Usando a chave da <marca>. Nenhuma chave precisa ser
 *     cadastrada." Só o admin da plataforma vê, como opção avançada, o caminho
 *     para uma chave própria desta empresa;
 *   - `null`: o padrão desta empresa está num provedor sem chave nenhuma, e
 *     ela não responde com IA (o buraco da MIA-215). Quem escolhe a IA é
 *     mandado ao padrão logo abaixo; a empresa é mandada ao suporte;
 *   - `"propria"`: nada (igual ao upstream);
 *   - `ia === null` (a leitura falhou): nada. Um aviso de "sem chave" chutado
 *     seria pior que nenhum.
 */
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { useMarcaDaInstalacao } from "@/lib/branding/contexto";

export function AvisoDaChave({
  ia,
  provedorNome,
  podeEditar,
  podeCadastrarChave,
}: {
  ia: { origem: "plataforma" | "propria"; chave: "propria" | "instalacao" | null } | null;
  /** O nome do provedor do padrão desta empresa ("OpenAI (GPT)"). */
  provedorNome: string;
  /** Quem vê pode trocar o padrão (`podeEditar` do GET). */
  podeEditar: boolean;
  /** `podeConfigurarChaveDeIa`: admin da plataforma fora de suporte. */
  podeCadastrarChave: boolean;
}) {
  const t = useT();
  const marca = useMarcaDaInstalacao();
  if (ia === null || ia.chave === "propria") return null;

  if (ia.chave === "instalacao") {
    return (
      <Card className="mb-6 p-4" data-testid="aviso-chave-da-plataforma">
        <p className="text-sm">
          {t("Usando a chave da {marca}. Nenhuma chave precisa ser cadastrada.").replace("{marca}", () => marca.name)}
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

  if (!podeEditar && !podeCadastrarChave) {
    return (
      <Card className="mb-6 border-amber-500/40 bg-amber-500/5 p-4" data-testid="aviso-sem-chave">
        <p className="text-sm">{t("A IA desta conta está sem chave para funcionar. Fale com o suporte.")}</p>
      </Card>
    );
  }

  return (
    <Card className="mb-6 border-amber-500/40 bg-amber-500/5 p-4" data-testid="aviso-sem-chave">
      <p className="text-sm">
        {t("A IA principal desta empresa ({provedor}) está sem chave e não responde aos clientes.").replace(
          "{provedor}",
          () => provedorNome,
        )}{" "}
        {podeEditar && t("Escolha no padrão abaixo um provedor com chave.")}
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
