"use client";

/**
 * FORK MIA (.79, empresa única) — o campo Empresa do negócio novo.
 *
 * Decisão do protótipo aprovado em 15/10/2026 (tela 4): o negócio pode ou não
 * ter empresa. Ao escolher o contato, a empresa DELE (a que aparece no cartão)
 * entra sozinha, e pode ser trocada ou tirada. Quem grava é o banco
 * (`trg_mia_negocio_e_a_empresa`, 9034), para todo caminho que cria negócio;
 * este campo MOSTRA o que vai acontecer e diz por quê.
 *
 * Mora fora do `NewLeadDialog` (do upstream) porque lê a ficha do contato
 * (react-query): o diálogo do upstream é montado sozinho nos testes dele, sem
 * provedor de consultas, e só renderiza este campo quando a organização mostra
 * empresa.
 */
import { SeletorDeEmpresa } from "@/components/empresas/SeletorDeEmpresa";
import { useFichaDoContato } from "@/hooks/cartoes/useFichas";
import { useT } from "@/hooks/i18n/useT";

export function CampoDaEmpresaDoNegocio({
  id,
  contatoId,
  empresaDoContato,
  valor,
  tocada,
  aoMudar,
}: {
  id: string;
  contatoId: string | null;
  /** A empresa do cartão que o seletor de contato já trouxe (sem esperar a ficha). */
  empresaDoContato: string | null;
  valor: string | null;
  /** A pessoa já mexeu no campo: vale o `valor`, e a dica some. */
  tocada: boolean;
  aoMudar: (empresaId: string | null) => void;
}) {
  const t = useT();
  const ficha = useFichaDoContato(contatoId);
  const empresas = ficha.data?.empresas ?? [];
  const doCartao = ficha.data?.empresa?.id ?? empresaDoContato;
  const mostrada = tocada ? valor : doCartao;

  const dica =
    tocada || !contatoId
      ? null
      : !doCartao
        ? t("Este contato não tem empresa: o negócio nasce sem empresa, e está tudo certo.")
        : empresas.length > 1
          ? t("Este contato está em {n} empresas. Entrou a que aparece no cartão dele; troque se o negócio for da outra.").replace(
              "{n}",
              String(empresas.length),
            )
          : t("A empresa do contato entrou sozinha. Pode trocar ou tirar.");

  return (
    <>
      <SeletorDeEmpresa id={id} valor={mostrada} aoMudar={aoMudar} />
      {dica ? <p className="text-xs text-muted-foreground">{dica}</p> : null}
    </>
  );
}
