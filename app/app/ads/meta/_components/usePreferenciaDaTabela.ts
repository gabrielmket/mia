"use client";

/**
 * FORK MIA — a ordem e o filtro da tabela de campanhas, lembrados por pessoa.
 *
 * Começa SEMPRE no padrão (ordem da plataforma, filtro desligado) — no servidor,
 * na primeira pintura e nos testes — e só depois da montagem lê o que a pessoa
 * deixou salvo. Ler o `localStorage` no estado inicial daria um HTML de servidor
 * diferente do primeiro render do cliente, que o React acusa como erro de
 * hidratação.
 *
 * A gravação acontece no CLIQUE, não num efeito que observa o estado: um efeito
 * gravaria o padrão por cima da preferência salva antes de ela ser lida.
 */
import { useCallback, useEffect, useState } from "react";

import {
  PREFERENCIA_PADRAO,
  chaveDaPreferencia,
  gravarPreferencia,
  lerPreferencia,
  proximaOrdem,
  type ColunaDaTabela,
  type PreferenciaDaTabela,
} from "@/lib/plataformas-de-anuncio/meta/ordem-da-tabela";

function armazenamento(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Acessar `localStorage` LANÇA quando o navegador bloqueia dados do site.
    return null;
  }
}

export function usePreferenciaDaTabela(usuarioId?: string | null) {
  const chave = chaveDaPreferencia(usuarioId);
  const [preferencia, setPreferencia] = useState<PreferenciaDaTabela>(PREFERENCIA_PADRAO);

  useEffect(() => {
    // Leitura de um sistema externo (o armazenamento do navegador) depois da
    // montagem, pelo motivo do cabeçalho. `useSyncExternalStore` não serve: com o
    // armazenamento bloqueado a escolha tem de valer em memória, e o estado
    // local é quem guarda isso.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreferencia(lerPreferencia(armazenamento(), chave));
  }, [chave]);

  const mudar = useCallback(
    (proxima: (atual: PreferenciaDaTabela) => PreferenciaDaTabela) => {
      setPreferencia((atual) => {
        const nova = proxima(atual);
        gravarPreferencia(armazenamento(), chave, nova);
        return nova;
      });
    },
    [chave],
  );

  const ordenarPor = useCallback(
    (coluna: ColunaDaTabela) =>
      mudar((atual) => ({ ...atual, ordem: proximaOrdem(atual.ordem, coluna) })),
    [mudar],
  );

  const voltarOrdemDaPlataforma = useCallback(
    () => mudar((atual) => ({ ...atual, ordem: null })),
    [mudar],
  );

  const definirSoComImpressao = useCallback(
    (ligado: boolean) => mudar((atual) => ({ ...atual, soComImpressao: ligado })),
    [mudar],
  );

  return { preferencia, ordenarPor, voltarOrdemDaPlataforma, definirSoComImpressao };
}
