"use client";

/**
 * FORK MIA — o que as linhas do cartão precisam saber e o card não carrega:
 * QUEM está olhando (para "Você há 4 dias"), o NOME de cada pessoa da equipe
 * (para "Juliana há 2 h") e o RELÓGIO do quadro (para "há 12 min" andar).
 *
 * Contexto, e não prop, porque quem desenha a bola é a linha da conversa
 * (`ConversaSlot`, do upstream), que recebe só `lead.conversa` — e o contrato
 * dela (vigiado em tests/unit/kanban-atalho-conversa.test.tsx) é continuar
 * recebendo só isso. Sem provedor (teste de componente, outra tela), o valor
 * padrão vale: ninguém é "Você", a pessoa vira "Equipe" — nunca um id — e o
 * relógio é o da montagem.
 *
 * UM relógio para o quadro inteiro, e não um por cartão: duzentos cartões com
 * um `setInterval` cada seriam duzentos timers para dizer a mesma hora.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface ContextoDoCartao {
  usuarioAtualId: string | null;
  nomeDoUsuario: (id: string) => string | null | undefined;
  agora: Date | null;
}

const PADRAO: ContextoDoCartao = { usuarioAtualId: null, nomeDoUsuario: () => null, agora: null };

const Contexto = createContext<ContextoDoCartao>(PADRAO);

/** De quanto em quanto o "há X min" do quadro anda. */
const TIQUE_MS = 60_000;

export function ProvedorDoCartao({
  usuarioAtualId,
  nomes,
  children,
}: {
  usuarioAtualId: string | null;
  nomes: Map<string, string | null> | undefined;
  children: ReactNode;
}) {
  const [agora, setAgora] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), TIQUE_MS);
    return () => clearInterval(id);
  }, []);
  return (
    <Contexto.Provider
      value={{ usuarioAtualId, nomeDoUsuario: (id) => nomes?.get(id) ?? null, agora }}
    >
      {children}
    </Contexto.Provider>
  );
}

export function useContextoDoCartao(): ContextoDoCartao {
  return useContext(Contexto);
}

/** O relógio do quadro; fora dele, o instante da montagem. */
export function useAgoraDoCartao(): Date {
  const { agora } = useContext(Contexto);
  const [daMontagem] = useState<Date>(() => new Date());
  return agora ?? daMontagem;
}
