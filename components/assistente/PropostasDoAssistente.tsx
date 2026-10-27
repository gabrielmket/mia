"use client";

/**
 * FORK MIA (.94) · A ABA "PROPOSTAS" da página do assistente (protótipo
 * "ensina e faz", telas 3 e 5).
 *
 *   Pedidos esperando você   (quem aprova) os cartões que alguém pediu, prontos
 *                            para aprovar, ajustar ou recusar; o aviso do sino
 *                            traz para cá
 *   Seus pedidos             (quem pediu e não aprova) o que foi pedido a quem
 *                            aprova; o resultado volta no mesmo cartão
 *   O que o assistente fez   o que foi aplicado e desfeito, com quem aprovou e
 *                            o "Desfazer"; fica também no Audit Log, como "via
 *                            assistente"
 *
 * Os cartões são os mesmos da conversa (`CartaoDaPropostaLida`).
 */
import { CartaoDaPropostaLida } from "@/components/assistente/CartaoDaProposta";
import { useListaDePropostas } from "@/hooks/assistente/usePropostasDoAssistente";
import { useT } from "@/hooks/i18n/useT";
import { roleAtLeast, type Role } from "@/lib/auth/types";

function Bloco({ titulo, vazio, lista }: { titulo: string; vazio: string; lista: ReturnType<typeof useListaDePropostas> }) {
  const t = useT();
  const itens = lista.data ?? [];
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-surface p-4" aria-label={titulo}>
      <h2 className="text-sm font-semibold">
        {titulo} · {lista.isLoading ? "…" : itens.length}
      </h2>
      {lista.isError ? (
        <p className="text-xs text-text-muted">{t("Não deu para ler as propostas agora.")}</p>
      ) : itens.length === 0 && !lista.isLoading ? (
        <p className="text-xs text-text-muted">{vazio}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {itens.map((p) => (
            <CartaoDaPropostaLida key={p.id} proposta={p} />
          ))}
        </div>
      )}
    </section>
  );
}

export function PropostasDoAssistente({ papel }: { papel: Role | null | undefined }) {
  const t = useT();
  const aprova = roleAtLeast(papel ?? null, "manager");
  const pedidos = useListaDePropostas("pedidos", aprova);
  const meus = useListaDePropostas("meus_pedidos");
  const feitas = useListaDePropostas("feitas");

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="propostas-do-assistente">
      <div className="flex flex-col gap-4">
        {aprova ? (
          <Bloco
            titulo={t("Pedidos esperando você")}
            vazio={t("Nenhum pedido agora. Quando alguém da equipe pedir algo que você aprova, o cartão pronto chega aqui e no sino.")}
            lista={pedidos}
          />
        ) : null}
        <Bloco
          titulo={t("Seus pedidos")}
          vazio={t("Quando você pede algo que não aprova, o cartão vai pronto para quem aprova, e o resultado volta para você aqui.")}
          lista={meus}
        />
        <section className="rounded-lg border bg-surface p-4 text-xs text-text-muted">
          <h2 className="mb-2 text-sm font-semibold text-text">{t("Como o cartão funciona")}</h2>
          <ul className="list-disc space-y-1 pl-4">
            <li>{t("Nada muda antes do \"Aprovar e aplicar\". O assistente só lê e prepara.")}</li>
            <li>{t("Um cartão é uma peça. Pedir de novo a mesma coisa devolve o mesmo cartão.")}</li>
            <li>{t("Aprova quem pode fazer a mesma coisa na tela. A meta do mês e as peças do modelo são só do administrador.")}</li>
            <li>{t("Desfazer não é apagar: tira só o que a proposta fez, e só enquanto nada depende disso.")}</li>
            <li>{t("Número, cobrança, convite, papéis, chaves, apagar, publicar agente e mensagem a cliente o assistente nunca faz: ele explica e leva até a tela.")}</li>
            <li>{t("Proposta que ninguém decide vence em 30 dias e não muda nada.")}</li>
          </ul>
        </section>
      </div>
      <Bloco
        titulo={t("O que o assistente fez")}
        vazio={t("Tudo o que for aplicado aparece aqui, com quem aprovou e o \"Desfazer\". Fica também no Audit Log, como \"via assistente\".")}
        lista={feitas}
      />
    </div>
  );
}
