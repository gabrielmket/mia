"use client";
/**
 * FORK MIA (.85) — os SELOS do horário de atendimento da IA, para a equipe
 * saber na hora se é a IA ou ela quem responde.
 *
 *   - na lista de agentes: "Ativa até 17:30" ou "Inativa · volta às 17:30"
 *     ("amanhã às 10:00" quando a troca não é hoje);
 *   - no cabeçalho da conversa aberta: "IA inativa agora · conversa da equipe"
 *     ou "IA ativa · responde até 17:30".
 *
 * Só aparecem para agente PUBLICADO com horário: sem horário a IA responde a
 * qualquer hora, como sempre, e um selo a mais seria ruído. O relógio é o de
 * quem lê, recalculado a cada 30 s (o mesmo ritmo do `JanelaSelo`).
 */
import { useContext, useEffect, useState } from "react";
import { QueryClientContext } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { useT } from "@/hooks/i18n/useT";
import { useHorarioDaIaDaConversa, useHorariosDosAgentes } from "@/hooks/ai/useHorarioDaIa";
import {
  ativaEm,
  lerHorarioDaIa,
  proximaTroca,
  type HorarioDaIa,
  type HorarioDaIaGravado,
  type TrocaDeEstado,
} from "@/lib/agent-engine/agent/horario-da-ia";
import { cn } from "@/lib/utils";

type Traduz = (texto: string) => string;

/** O relógio de quem lê, a cada 30 s. */
export function useRelogioDoSelo(intervaloMs = 30_000): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);
  return agora;
}

/** "amanhã às 10:00", "na segunda às 10:00" (sem o "hoje": hoje é só a hora). */
export function quandoDaTroca(troca: Pick<TrocaDeEstado, "diasAdiante" | "dia" | "hora">, t: Traduz): string {
  if (troca.diasAdiante === 0) return troca.hora;
  if (troca.diasAdiante === 1) return `${t("amanhã às")} ${troca.hora}`;
  // Literais de propósito: o gate de espanhol enxerga cada chave usada.
  const dia = [
    t("no domingo às"),
    t("na segunda às"),
    t("na terça às"),
    t("na quarta às"),
    t("na quinta às"),
    t("na sexta às"),
    t("no sábado às"),
  ][troca.dia];
  return `${dia} ${troca.hora}`;
}

export interface EstadoDoSelo {
  ativa: boolean;
  texto: string;
}

/** O selo da LISTA de agentes. */
export function seloDaLista(horario: HorarioDaIa, agora: Date, t: Traduz): EstadoDoSelo {
  const ativa = ativaEm(horario, agora);
  const troca = proximaTroca(horario, agora);
  if (ativa) return { ativa, texto: troca ? `${t("Ativa até")} ${quandoDaTroca(troca, t)}` : t("Ativa a qualquer hora") };
  if (!troca) return { ativa, texto: t("Inativa") };
  return {
    ativa,
    texto: troca.diasAdiante === 0 ? `${t("Inativa · volta às")} ${troca.hora}` : `${t("Inativa · volta")} ${quandoDaTroca(troca, t)}`,
  };
}

/** O selo do CABEÇALHO da conversa. */
export function seloDaConversa(horario: HorarioDaIa, agora: Date, t: Traduz): EstadoDoSelo {
  const ativa = ativaEm(horario, agora);
  if (!ativa) return { ativa, texto: t("IA inativa agora · conversa da equipe") };
  const troca = proximaTroca(horario, agora);
  return { ativa, texto: troca ? `${t("IA ativa · responde até")} ${quandoDaTroca(troca, t)}` : t("IA ativa a qualquer hora") };
}

function SeloBase({ estado, titulo, testId, compacto }: { estado: EstadoDoSelo; titulo: string; testId: string; compacto?: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "min-w-0 max-w-full truncate",
        compacto && "h-4 max-w-[16rem] px-1.5 text-[10px]",
        estado.ativa
          ? "border-emerald-400 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300"
          : "border-amber-400 text-amber-700 dark:border-amber-700 dark:text-amber-300",
      )}
      title={titulo}
      data-testid={testId}
    >
      <span className="truncate">{estado.texto}</span>
    </Badge>
  );
}

/**
 * Sem o `QueryClient` do app (componente montado isolado, como nos testes do
 * cabeçalho e do cartão), não há de onde ler o horário: sem selo, e o resto da
 * tela segue igual.
 */
function useTemQueryClient(): boolean {
  return useContext(QueryClientContext) !== undefined;
}

/** O selo no cartão do agente. Nada quando o agente não tem horário publicado. */
export function SeloDoHorarioNaLista({ agentId }: { agentId: string }) {
  return useTemQueryClient() ? <SeloNaLista agentId={agentId} /> : null;
}

function SeloNaLista({ agentId }: { agentId: string }) {
  const t = useT();
  const agora = useRelogioDoSelo();
  const { data } = useHorariosDosAgentes();
  const gravado = data?.find((a) => a.id === agentId)?.horario ?? null;
  const horario = gravado ? lerHorarioDaIa({ filters: { horario_da_ia: gravado } }) : null;
  if (!horario) return null;
  return (
    <SeloBase
      estado={seloDaLista(horario, agora, t)}
      titulo={t("Horário de atendimento da IA da versão publicada. Fora dele a IA não responde e a conversa fica com a equipe.")}
      testId="selo-horario-da-ia"
    />
  );
}

/** O selo no cabeçalho da conversa aberta. Nada quando quem responde não tem horário. */
export function SeloDoHorarioNaConversa({ conversationId }: { conversationId: string }) {
  return useTemQueryClient() ? <SeloNaConversa conversationId={conversationId} /> : null;
}

function SeloNaConversa({ conversationId }: { conversationId: string }) {
  const t = useT();
  const agora = useRelogioDoSelo();
  const { data } = useHorarioDaIaDaConversa(conversationId);
  const gravado: HorarioDaIaGravado | null = data?.horario ?? null;
  const horario = gravado ? lerHorarioDaIa({ filters: { horario_da_ia: gravado } }) : null;
  if (!horario) return null;
  const estado = seloDaConversa(horario, agora, t);
  return (
    <SeloBase
      estado={estado}
      titulo={
        estado.ativa
          ? t("A IA responde as mensagens novas desta conversa até o fim do horário dela. Conversa assumida por alguém continua com a pessoa.")
          : t("A IA está fora do horário de atendimento: não responde o que chegar agora, nem depois. Quem responde é a equipe.")
      }
      testId="selo-horario-da-ia-na-conversa"
      compacto
    />
  );
}
